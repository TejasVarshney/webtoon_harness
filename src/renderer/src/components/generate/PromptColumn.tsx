import { useEffect, useRef, useState } from 'react'
import type { StyleEntry } from '@shared/ipc'
import { ShotTypeSchema } from '@shared/schemas'
import type { Panel, PanelAspect, PromptPreview } from '@shared/types'
import { api } from '../../api'
import { useGenerateStore } from '../../stores/generate-store'
import { usePanelsStore } from '../../stores/panels-store'
import { Field, errorText } from '../characters/controls'
import { ShapePicker } from '../panel-editor/ShapePicker'
import { toPanelDraft } from './generate-draft'

/** Waits for typing to pause, so a preview is not asked for on every keystroke. */
const PREVIEW_DELAY_MS = 300
const PROJECT_STYLE = 'project'
const CUSTOM_STYLE = 'custom'

/**
 * What the new panel is made of and the prompt it will be drawn with. The prompt shows the app's own text until the
 * user edits it; from then on their words are kept, whatever else changes.
 */
export function PromptColumn() {
  const request = useGenerateStore((s) => s.request)
  const draft = useGenerateStore((s) => s.draft)
  const patch = useGenerateStore((s) => s.patch)
  const [styles, setStyles] = useState<StyleEntry[]>([])
  // "Custom" stays chosen while its text is typed, even when the words happen to equal a library style.
  const [customStyle, setCustomStyle] = useState(false)
  const [preview, setPreview] = useState<PromptPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  // What the user typed as a custom style, kept while another choice is selected.
  const [customText, setCustomText] = useState('')
  // The selections the user's edit was made against: different ones now mean the references have moved on.
  const [editedAt, setEditedAt] = useState<string | null>(null)
  const requestSeq = useRef(0)

  useEffect(() => {
    let current = true
    api
      .invoke('styles:list', {})
      .then((result) => {
        if (current) setStyles(result.styles)
      })
      // The library only adds choices: Project style and Custom still work without it.
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [])

  // The edit is left out: the preview is always the automatic text, and the page keeps the user's words itself.
  const previewKey = JSON.stringify([
    request?.referencePanelIds,
    request?.afterPanelId,
    draft.description,
    draft.setting,
    draft.shot,
    draft.aspect,
    draft.styleOverride,
    draft.location,
    draft.characters,
    draft.items,
    draft.sketchPng !== null
  ])
  useEffect(() => {
    const { request: current, draft: latest } = useGenerateStore.getState()
    if (current === null) return
    const seq = ++requestSeq.current
    const timer = setTimeout(() => {
      usePanelsStore
        .getState()
        .previewPrompt(toPanelDraft(current, latest), latest.sketchPng !== null)
        .then((result) => {
          if (seq !== requestSeq.current) return
          setPreview(result)
          setPreviewError(null)
        })
        .catch((e: unknown) => {
          if (seq !== requestSeq.current) return
          setPreview(null)
          setPreviewError(errorText(e))
        })
    }, PREVIEW_DELAY_MS)
    return () => clearTimeout(timer)
  }, [previewKey])

  // A response to a request made before the page closed must not land afterwards.
  useEffect(
    () => () => {
      requestSeq.current++
    },
    []
  )

  const styleValue = draft.styleOverride === null ? PROJECT_STYLE : customStyle ? CUSTOM_STYLE : (styles.find((s) => s.text === draft.styleOverride)?.id ?? CUSTOM_STYLE)
  const chooseStyle = (value: string): void => {
    setCustomStyle(value === CUSTOM_STYLE)
    if (value === PROJECT_STYLE) patch({ styleOverride: null })
    else if (value === CUSTOM_STYLE) patch({ styleOverride: customText })
    else patch({ styleOverride: styles.find((s) => s.id === value)?.text ?? null })
  }

  const dropped = preview?.droppedPanelIds.length ?? 0
  const edited = draft.promptOverride !== null
  const editNote = edited && editedAt !== null && editedAt !== previewKey

  return (
    <div className="prompt-column">
      <h3 className="library-heading">Panel details</h3>
      <Field label="Description">{(id) => <textarea id={id} rows={3} value={draft.description} placeholder="What happens in this panel" onChange={(e) => patch({ description: e.target.value })} />}</Field>
      <Field label="Setting">{(id) => <input id={id} value={draft.setting} placeholder="Where and when" onChange={(e) => patch({ setting: e.target.value })} />}</Field>
      <Field label="Shot">
        {(id) => (
          <select id={id} value={draft.shot} onChange={(e) => patch({ shot: e.target.value as Panel['shot'] })}>
            {ShotTypeSchema.options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="field">
        <span className="field-label" aria-hidden="true">
          Shape
        </span>
        <ShapePicker label="Shape" value={draft.aspect} onChange={(aspect: PanelAspect) => patch({ aspect })} />
      </div>
      <Field label="Style">
        {(id) => (
          <select id={id} value={styleValue} onChange={(e) => chooseStyle(e.target.value)}>
            <option value={PROJECT_STYLE}>Project style</option>
            {styles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value={CUSTOM_STYLE}>Custom</option>
          </select>
        )}
      </Field>
      {styleValue === CUSTOM_STYLE && (
        <textarea
          aria-label="Custom style"
          rows={2}
          value={draft.styleOverride ?? ''}
          placeholder="Describe the look of this panel"
          onChange={(e) => {
            setCustomText(e.target.value)
            patch({ styleOverride: e.target.value })
          }}
        />
      )}
      <Field label="Prompt">
        {(id) => (
          <textarea
            id={id}
            className="prompt-text"
            rows={10}
            value={draft.promptOverride ?? preview?.prompt ?? ''}
            placeholder={previewError === null ? 'The prompt appears here' : ''}
            onChange={(e) => {
              // An empty box is no prompt of the user's own: the automatic one shows again.
              if (e.target.value === '') {
                patch({ promptOverride: null })
                setEditedAt(null)
                return
              }
              if (!edited) setEditedAt(previewKey)
              patch({ promptOverride: e.target.value })
            }}
          />
        )}
      </Field>
      {edited && (
        <p className="hint">
          Using your own prompt{' '}
          <button
            type="button"
            onClick={() => {
              patch({ promptOverride: null })
              setEditedAt(null)
            }}
          >
            Reset to automatic
          </button>
        </p>
      )}
      {editNote && <p className="hint">Your selections changed. Reset to automatic to renumber the references.</p>}
      {dropped > 0 && (
        <p className="hint">
          {dropped} chosen {dropped === 1 ? 'panel' : 'panels'} won&apos;t be sent: this image model takes fewer references.
        </p>
      )}
      {previewError !== null && <p className="error">Could not preview the prompt: {previewError}</p>}
    </div>
  )
}
