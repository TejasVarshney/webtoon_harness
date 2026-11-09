import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { LocationStateInput } from '@shared/types'
import { Field, errorText } from '../characters/controls'

// The twin of UsageForm. A state gets no picture of its own unless asked: panels use the base picture and its words.

export interface StateFormProps {
  /** Resolves when the state was added; a rejection is shown and keeps the form open. */
  onSubmit(input: LocationStateInput, generate: boolean): Promise<void>
  onCancel(): void
}

export function StateForm({ onSubmit, onCancel }: StateFormProps) {
  const [name, setName] = useState('')
  const [delta, setDelta] = useState('')
  const [generate, setGenerate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  // The form opens below a long location form, so bring it into view. (jsdom has no scrollIntoView.)
  useEffect(() => {
    formRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (busy || name.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ name: name.trim(), delta: delta.trim() }, generate)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <form ref={formRef} className="variation-form" data-testid="state-form" onSubmit={(e) => void submit(e)}>
      <Field label="Name">{(id) => <input id={id} autoFocus value={name} placeholder="Night" onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="What changes">
        {(id) => <textarea id={id} rows={3} value={delta} placeholder="Only embers glowing in the drum, cold blue light from the door" onChange={(e) => setDelta(e.target.value)} />}
      </Field>
      <label className="inline-label">
        <input type="checkbox" checked={generate} onChange={(e) => setGenerate(e.target.checked)} />
        Draw its own picture
      </label>
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" data-testid="state-submit" disabled={busy || name.trim() === ''}>
          Create state
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
