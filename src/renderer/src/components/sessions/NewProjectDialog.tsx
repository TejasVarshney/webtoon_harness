import { useState, type FormEvent } from 'react'

export interface NewProjectDialogProps {
  onCreate(title: string): Promise<void>
  onCancel(): void
}

export function NewProjectDialog({ onCreate, onCancel }: NewProjectDialogProps) {
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    const trimmed = title.trim()
    if (trimmed === '' || busy) return
    setBusy(true)
    setError(null)
    try {
      await onCreate(trimmed)
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
