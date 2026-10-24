import { useRef, useState } from 'react'
import { PanelAspectSchema, ShotTypeSchema } from '@shared/schemas'
import type { Panel, PanelCharacter, PanelDraft, PanelPatch } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { usePanelsStore } from '../../stores/panels-store'
import { Field, errorText } from '../characters/controls'
import { CastPicker } from './CastPicker'
import { DialogueEditor, type DialogueDraftLine } from './DialogueEditor'
import { useRoster } from './use-roster'

const SHOTS = ShotTypeSchema.options
const ASPECTS = PanelAspectSchema.options

export interface PanelEditorDialogProps {
  mode: 'create' | 'edit'
  episodeId: string
  /** Create mode: the panel the new one goes after. Absent appends; `null` inserts at the start. */
  afterPanelId?: string | null
  /** Edit mode: the panel being edited. */
  panel?: Panel
  /** Called when the dialog is done, after a clean save or from Cancel / Close. */
  onClose?(): void
}

/** What the form edits: the fields of a panel the user can type in. */
interface Values {
  description: string
  setting: string
  shot: Panel['shot']
  aspect: Panel['aspect']
  characters: PanelCharacter[]
  dialogue: DialogueDraftLine[]
}

function fromPanel(panel: Panel): Values {
  return {
    description: panel.description,
    setting: panel.setting,
    shot: panel.shot,
    aspect: panel.aspect,
    characters: panel.characters,
    dialogue: panel.dialogue.map(({ speakerId, kind, text }) => ({ speakerId, kind, text }))
  }
}

/** The values as they are stored: text trimmed, lines without text dropped. Comparing two of these finds what changed. */
function normalize(v: Values): Values {
  return {
    description: v.description.trim(),
    setting: v.setting.trim(),
    shot: v.shot,
    aspect: v.aspect,
    characters: v.characters.map((c) => ({ characterId: c.characterId, variationId: c.variationId, action: c.action.trim(), expression: c.expression.trim(), position: c.position })),
    dialogue: v.dialogue.filter((l) => l.text.trim() !== '').map((l) => ({ speakerId: l.speakerId, kind: l.kind, text: l.text.trim() }))
  }
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Only the fields that differ from `before`: the AI may change the rest while the dialog is open, and a save must not undo it. */
function changes(before: Values, after: Values): PanelPatch {
  const patch: PanelPatch = {}
  if (before.description !== after.description) patch.description = after.description
  if (before.setting !== after.setting) patch.setting = after.setting
  if (before.shot !== after.shot) patch.shot = after.shot
  if (before.aspect !== after.aspect) patch.aspect = after.aspect
  if (!same(before.characters, after.characters)) patch.characters = after.characters
  if (!same(before.dialogue, after.dialogue)) patch.dialogue = after.dialogue
  return patch
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
 * The manual panel editor: create a panel (here, after `afterPanelId`) or edit one. Create makes the panel through the
 * same service the agent uses, so it gets the same validation. A validation failure is shown and the form stays editable;
 * once the panel exists, the buttons that would make it again are gone and only Close is left, so a second click cannot
 * duplicate it. Warnings (a character named in the description but not attached) are shown, and the dialog waits for Close.
 */
export function PanelEditorDialog({ mode, episodeId, afterPanelId, panel, onClose }: PanelEditorDialogProps) {
  const editing = mode === 'edit' && panel !== undefined
  const defaultAspect = useAppStore((s) => s.projects.find((p) => p.id === s.projectId)?.defaultAspect)
  const roster = useRoster()
  const [initial] = useState<Values>(() =>
    editing ? fromPanel(panel) : { description: '', setting: '', shot: 'medium', aspect: defaultAspect ?? '2:3', characters: [], dialogue: [] }
  )
  const [values, setValues] = useState<Values>(initial)
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)

  if (!open) return null

  const set = <K extends keyof Values>(key: K, value: Values[K]): void => setValues((v) => ({ ...v, [key]: value }))
  const patch = editing ? changes(normalize(initial), normalize(values)) : {}
  const dirty = Object.keys(patch).length > 0
  // A cast row with no ready variation could only come back as a server error; say so before it is sent.
  const castReady = values.characters.every((c) => c.variationId !== '')
  const locked = busy || !castReady

  function close(): void {
    setOpen(false)
    onClose?.()
  }

  async function run(intent: Intent): Promise<void> {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    const { createPanel, updatePanel, generatePanel, uploadPanelImage } = usePanelsStore.getState()
    let panelId: string
    let warnings: string[] = []
    try {
      if (editing) {
        panelId = panel.id
        if (dirty) warnings = (await updatePanel(panel.id, patch)).warnings
      } else {
        const v = normalize(values)
        const draft: PanelDraft = {
          episodeId,
          ...(afterPanelId !== undefined ? { afterPanelId } : {}),
          description: v.description,
          setting: v.setting,
          shot: v.shot,
          aspect: v.aspect,
          characters: v.characters,
          dialogue: v.dialogue
        }
        const created = await createPanel(draft, intent.generate)
        panelId = created.panel.id
        warnings = created.warnings
      }
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
      if (editing && intent.generate) await generatePanel(panelId)
      if (intent.upload) await uploadPanelImage(panelId)
    } catch (e) {
      notice = `${editing ? 'Saved' : 'Panel created'}, but the image step failed: ${errorText(e)}`
    }
    inFlight.current = false
    setBusy(false)
    if (warnings.length === 0 && notice === null) close()
    else setOutcome({ warnings, notice })
  }

  return (
    <div className="modal-backdrop">
      <div className="modal panel-editor" role="dialog" aria-modal="true" aria-label={editing ? 'Edit panel' : 'New panel'} data-testid="panel-editor">
        <h2>{editing ? 'Edit panel' : 'New panel'}</h2>
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
            <CastPicker characters={roster} value={values.characters} onChange={(next) => set('characters', next)} />
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
            <p>{editing ? 'Saved.' : 'Panel created.'}</p>
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
              {editing ? (
                <>
                  <button type="button" disabled={locked} onClick={() => void run({ generate: true, upload: false })}>
                    Save &amp; regenerate
                  </button>
                  <button type="button" disabled={locked || !dirty} onClick={() => void run({ generate: false, upload: false })}>
                    Save
                  </button>
                </>
              ) : (
                <>
                  <button type="button" disabled={locked} onClick={() => void run({ generate: false, upload: false })}>
                    Create without image
                  </button>
                  <button type="button" disabled={locked} onClick={() => void run({ generate: true, upload: false })}>
                    Create &amp; generate
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
