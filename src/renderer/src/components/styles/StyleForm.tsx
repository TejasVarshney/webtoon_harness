import { useState, type FormEvent } from 'react'

export interface StyleFormProps {
  initial?: { name: string; text: string }
  /** Rejects with the message to show; the form keeps what was typed. */
  onSave(input: { name: string; text: string }): Promise<void>
  onCancel(): void
}

/** The name and words of a style. The rules live in main, so what it refuses is shown here. */
export function StyleForm({ initial, onSave, onCancel }: StyleFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [text, setText] = useState(initial?.text ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onSave({ name, text })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <form className="style-form" onSubmit={(e) => void submit(e)}>
      <label>
        Name
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Description
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" disabled={busy}>
          Save style
        </button>
      </div>
    </form>
  )
}
