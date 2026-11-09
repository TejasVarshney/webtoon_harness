import { useEffect, useState, type FormEvent } from 'react'
import type { StyleEntry } from '@shared/ipc'
import { api } from '../../api'

export interface NewProjectDialogProps {
  /** `stylePreset`: the chosen style's words; left out when the styles could not be read, which gives the default. */
  onCreate(title: string, stylePreset?: string): Promise<void>
  onCancel(): void
}

export function NewProjectDialog({ onCreate, onCancel }: NewProjectDialogProps) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [styles, setStyles] = useState<StyleEntry[]>([])
  const [styleId, setStyleId] = useState<string | null>(null)

  useEffect(() => {
    let current = true
    api
      .invoke('styles:list', {})
      .then((result) => {
        if (current) setStyles(result.styles)
      })
      // A project can be made without the list: it gets the default style.
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [])

  const chosen = styles.find((s) => s.id === styleId) ?? styles[0]

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    const trimmed = title.trim()
    if (trimmed === '' || busy) return
    setBusy(true)
    setError(null)
    try {
      await onCreate(trimmed, chosen?.text)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop">
      <form className="modal" role="dialog" aria-label="New project" onSubmit={(e) => void submit(e)}>
        <h2>New project</h2>
        <label>
          Title
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        {chosen !== undefined && (
          <label>
            Style
            <select value={chosen.id} onChange={(e) => setStyleId(e.target.value)}>
              {styles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {error !== null && <p role="alert" className="error">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={busy || title.trim() === ''}>
            Create
          </button>
        </div>
      </form>
    </div>
  )
}
