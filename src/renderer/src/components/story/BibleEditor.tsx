import { useState } from 'react'
import { useStoryStore } from '../../stores/story-store'

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * The story bible as one markdown text box. `edit` holds the unsaved text and the bible it was started from;
 * without one the box shows the stored bible, so a change the agent makes shows up at once. An agent change that
 * lands while the user has unsaved text never replaces it: it is flagged, and saving then overwrites it.
 */
export function BibleEditor() {
  const bible = useStoryStore((s) => s.bible)
  const saveBible = useStoryStore((s) => s.saveBible)
  const [edit, setEdit] = useState<{ text: string; base: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const text = edit?.text ?? bible
  const dirty = edit !== null && edit.text !== bible
  const conflict = edit !== null && edit.base !== bible

  function save(): void {
    if (edit === null) return
    setError(null)
    setSaving(true)
    saveBible(edit.text)
      .then(() => setEdit(null))
      .catch((e: unknown) => setError(errorText(e)))
      .finally(() => setSaving(false))
  }

  return (
    <section className="bible-editor-section">
      <h3>Story bible</h3>
      <textarea
        className="bible-editor"
        data-testid="bible-editor"
        aria-label="Story bible"
        spellCheck={false}
        value={text}
        onChange={(e) => setEdit({ text: e.target.value, base: edit?.base ?? bible })}
      />
      {conflict && (
        <p role="status" className="hint" data-testid="bible-conflict">
          The bible changed while you were editing. Saving replaces those changes; Discard shows them.
        </p>
      )}
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" data-testid="bible-save" disabled={!dirty || saving} onClick={save}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {edit !== null && (
          <button type="button" data-testid="bible-discard" disabled={saving} onClick={() => setEdit(null)}>
            Discard changes
          </button>
        )}
      </div>
    </section>
  )
}
