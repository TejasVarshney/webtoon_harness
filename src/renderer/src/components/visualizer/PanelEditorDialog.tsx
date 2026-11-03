import { useId, useRef, useState } from 'react'
import { isTallAspect } from '@shared/draw-aspect'
import { PanelAspectSchema, PanelFrameSchema, PanelGapSchema, PanelGutterSchema, ShotTypeSchema } from '@shared/schemas'
import type { Panel, PanelCharacter, PanelDraft, PanelItem } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { usePanelsStore } from '../../stores/panels-store'
import { Field, errorText } from '../characters/controls'
import { CastPicker } from './CastPicker'
import { DialogueEditor, type DialogueDraftLine } from './DialogueEditor'
import { ItemPicker } from './ItemPicker'
import { useItemRoster } from './use-item-roster'
import { useRoster } from './use-roster'

const SHOTS = ShotTypeSchema.options
const ASPECTS = PanelAspectSchema.options
const FRAMES = PanelFrameSchema.options
const GAPS = PanelGapSchema.options
const GUTTERS = PanelGutterSchema.options

export interface PanelEditorDialogProps {
  episodeId: string
  /** The panel the new one goes after. Absent appends; `null` inserts at the start. */
  afterPanelId?: string | null
  /** Called when the dialog is done, after a clean create or from Cancel / Close. */
  onClose?(): void
}

/** What the form edits: the fields of a panel the user can type in. */
interface Values {
  description: string
  setting: string
  shot: Panel['shot']
  aspect: Panel['aspect']
  frame: Panel['frame']
  beside: boolean
  gapAfter: Panel['gapAfter']
  gutter: Panel['gutter']
  characters: PanelCharacter[]
  items: PanelItem[]
  dialogue: DialogueDraftLine[]
}

/** The values as they are stored: text trimmed, lines without text dropped. */
function normalize(v: Values): Values {
  return {
    description: v.description.trim(),
    setting: v.setting.trim(),
    shot: v.shot,
    aspect: v.aspect,
    frame: v.frame,
    beside: v.beside,
    gapAfter: v.gapAfter,
    gutter: v.gutter,
    characters: v.characters.map((c) => ({ characterId: c.characterId, variationId: c.variationId, action: c.action.trim(), expression: c.expression.trim(), position: c.position })),
    items: v.items.map((i) => ({ itemId: i.itemId, usageId: i.usageId, heldBy: i.heldBy, action: i.action.trim() })),
    dialogue: v.dialogue.filter((l) => l.text.trim() !== '').map((l) => ({ speakerId: l.speakerId, kind: l.kind, text: l.text.trim(), placement: l.placement }))
  }
}

/** What a new panel looks like until the user changes it; a draft carries only the layout fields that differ. */
const LAYOUT_DEFAULTS = { frame: 'bordered', beside: false, gapAfter: 'normal', gutter: 'white' } as const satisfies Pick<Values, 'frame' | 'beside' | 'gapAfter' | 'gutter'>

/** The layout fields that differ from a new panel's. */
function layoutChanges(v: Values): Pick<PanelDraft, 'frame' | 'beside' | 'gapAfter' | 'gutter'> {
  return {
    ...(v.frame !== LAYOUT_DEFAULTS.frame ? { frame: v.frame } : {}),
    ...(v.beside !== LAYOUT_DEFAULTS.beside ? { beside: v.beside } : {}),
    ...(v.gapAfter !== LAYOUT_DEFAULTS.gapAfter ? { gapAfter: v.gapAfter } : {}),
    ...(v.gutter !== LAYOUT_DEFAULTS.gutter ? { gutter: v.gutter } : {})
  }
}

/** What the primary buttons ask for, besides the save itself. */
interface Intent {
  generate: boolean
  upload: boolean
}

interface Outcome {
  /** From the service: the panel was saved, but something deserves a look. */
  warnings: string[]
  /** A step after the save failed, or `null`. The panel itself is saved. */
  notice: string | null
}

/**
 * The new-panel dialog: creates a panel (here, after `afterPanelId`) through the same service the agent uses, so it gets
 * the same validation. An existing panel is edited in the editing mode instead (PanelWorkspace). A validation failure is
 * shown and the form stays editable; once the panel exists, the buttons that would make it again are gone and only Close
 * is left, so a second click cannot duplicate it. Warnings (a character named in the description but not attached) are
 * shown, and the dialog waits for Close.
 */
export function PanelEditorDialog({ episodeId, afterPanelId, onClose }: PanelEditorDialogProps) {
  const defaultAspect = useAppStore((s) => s.projects.find((p) => p.id === s.projectId)?.defaultAspect)
  const roster = useRoster()
  const itemRoster = useItemRoster()
  const [values, setValues] = useState<Values>(() => ({
    description: '',
    setting: '',
    shot: 'medium',
    aspect: defaultAspect ?? '2:3',
    ...LAYOUT_DEFAULTS,
    characters: [],
    items: [],
    dialogue: []
  }))
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const tallNoteId = useId()

  if (!open) return null

  // An item cannot be held by someone who left the cast, whichever control changed the cast.
  const set = <K extends keyof Values>(key: K, value: Values[K]): void =>
    setValues((v) => {
      const next = { ...v, [key]: value }
      if (key === 'characters') {
        const cast = new Set(next.characters.map((c) => c.characterId))
        next.items = next.items.map((i) => (i.heldBy !== null && !cast.has(i.heldBy) ? { ...i, heldBy: null } : i))
      }
      return next
    })
  // A tall panel fades at its edges instead of having a frame, whatever its frame says.
  const tall = isTallAspect(values.aspect)
  // A cast row with no ready variation could only come back as a server error; say so before it is sent.
  const castReady = values.characters.every((c) => c.variationId !== '')
  // Likewise an item row with no ready usage.
  const itemsReady = values.items.every((i) => i.usageId !== '')
  const locked = busy || !castReady || !itemsReady

  function close(): void {
    setOpen(false)
    onClose?.()
  }

  async function run(intent: Intent): Promise<void> {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    const { createPanel, uploadPanelImage } = usePanelsStore.getState()
    let panelId: string
    let warnings: string[]
    try {
      const v = normalize(values)
      const draft: PanelDraft = {
        episodeId,
        ...(afterPanelId !== undefined ? { afterPanelId } : {}),
        description: v.description,
        setting: v.setting,
        shot: v.shot,
        aspect: v.aspect,
        ...layoutChanges(v),
        characters: v.characters,
        items: v.items,
        dialogue: v.dialogue
      }
      const created = await createPanel(draft, intent.generate)
      panelId = created.panel.id
      warnings = created.warnings
    } catch (e) {
      // Nothing was saved: the form stays as it is, ready for another try.
      setError(errorText(e))
      inFlight.current = false
      setBusy(false)
      return
    }
    // The panel is saved from here on, so a failure below is reported next to it and never re-runs the step above.
    let notice: string | null = null
    try {
      if (intent.upload) await uploadPanelImage(panelId)
    } catch (e) {
      notice = `Panel created, but the image step failed: ${errorText(e)}`
    }
    inFlight.current = false
    setBusy(false)
    if (warnings.length === 0 && notice === null) close()
    else setOutcome({ warnings, notice })
  }

  return (
    <div className="modal-backdrop">
      <div className="modal panel-editor" role="dialog" aria-modal="true" aria-label="New panel" data-testid="panel-editor">
        <h2>New panel</h2>
        <form className="panel-editor-form" onSubmit={(e) => e.preventDefault()}>
          <fieldset disabled={busy || outcome !== null}>
            <Field label="Description">
              {(id) => (
                <textarea id={id} rows={3} autoFocus value={values.description} placeholder="What happens in this panel" onChange={(e) => set('description', e.target.value)} />
              )}
            </Field>
            <Field label="Setting">{(id) => <input id={id} value={values.setting} placeholder="Where and when" onChange={(e) => set('setting', e.target.value)} />}</Field>
            <div className="field-row">
              <Field label="Shot">
                {(id) => (
                  <select id={id} value={values.shot} onChange={(e) => set('shot', e.target.value as Values['shot'])}>
                    {SHOTS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Aspect">
                {(id) => (
                  <select id={id} value={values.aspect} onChange={(e) => set('aspect', e.target.value as Values['aspect'])}>
                    {ASPECTS.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            <fieldset className="layout-group">
              <legend>Layout</legend>
              <div className="field-row">
                <Field label="Frame">
                  {(id) => (
                    <select id={id} value={values.frame} disabled={tall} aria-describedby={tall ? tallNoteId : undefined} onChange={(e) => set('frame', e.target.value as Values['frame'])}>
                      {FRAMES.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="Gap after">
                  {(id) => (
                    <select id={id} value={values.gapAfter} onChange={(e) => set('gapAfter', e.target.value as Values['gapAfter'])}>
                      {GAPS.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="Gutter">
                  {(id) => (
                    <select id={id} value={values.gutter} onChange={(e) => set('gutter', e.target.value as Values['gutter'])}>
                      {GUTTERS.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </div>
              {tall && <p id={tallNoteId} className="hint">Tall panels fade instead of a frame</p>}
              <label className="inline-label">
                <input type="checkbox" checked={values.beside} onChange={(e) => set('beside', e.target.checked)} />
                Beside the previous panel
              </label>
            </fieldset>
            <CastPicker characters={roster} value={values.characters} onChange={(next) => set('characters', next)} />
            <ItemPicker items={itemRoster} cast={values.characters} characters={roster} value={values.items} onChange={(next) => set('items', next)} />
            <DialogueEditor characters={roster} cast={values.characters} value={values.dialogue} onChange={(next) => set('dialogue', next)} />
          </fieldset>
        </form>

        {error !== null && (
          <div role="alert" className="error panel-editor-error">
            {error.split('\n').map((issue, i) => (
              <p key={i}>{issue}</p>
            ))}
          </div>
        )}
        {outcome !== null && (
          <div className="panel-editor-outcome" role="status">
            <p>Panel created.</p>
            {outcome.warnings.length > 0 && (
              <ul className="panel-editor-warnings">
                {outcome.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            {outcome.notice !== null && <p className="error">{outcome.notice}</p>}
          </div>
        )}

        <div className="modal-actions">
          {outcome !== null ? (
            <button type="button" onClick={close}>
              Close
            </button>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={close}>
                Cancel
              </button>
              <button type="button" disabled={locked} onClick={() => void run({ generate: false, upload: true })}>
                Upload image…
              </button>
              <button type="button" disabled={locked} onClick={() => void run({ generate: false, upload: false })}>
                Create without image
              </button>
              <button type="button" disabled={locked} onClick={() => void run({ generate: true, upload: false })}>
                Create &amp; generate
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
