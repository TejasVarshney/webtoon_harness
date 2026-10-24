import { useEffect, useRef, useState, type FormEvent } from 'react'
import { VariationInputSchema } from '@shared/schemas'
import type { VariationInput } from '@shared/types'
import { Field, errorText } from './controls'

/** Every kind a user can add: the schema's kinds without `base`, which each character already has. */
const KINDS = VariationInputSchema.shape.kind.options

export interface VariationFormProps {
  /** Resolves when the variation was added; a rejection is shown and keeps the form open. */
  onSubmit(input: VariationInput): Promise<void>
  onCancel(): void
}

export function VariationForm({ onSubmit, onCancel }: VariationFormProps) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<VariationInput['kind']>('outfit')
  const [delta, setDelta] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  // The form opens below a long character form, so bring it into view. (jsdom has no scrollIntoView.)
  useEffect(() => {
    formRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (busy || name.trim() === '') return
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ name: name.trim(), kind, delta: delta.trim() })
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <form ref={formRef} className="variation-form" data-testid="variation-form" onSubmit={(e) => void submit(e)}>
      <Field label="Name">{(id) => <input id={id} autoFocus value={name} placeholder="Outfit: School uniform" onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="Kind">
        {(id) => (
          <select id={id} value={kind} onChange={(e) => setKind(e.target.value as VariationInput['kind'])}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Delta">
        {(id) => <textarea id={id} rows={2} value={delta} placeholder="What differs from the base look" onChange={(e) => setDelta(e.target.value)} />}
      </Field>
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" disabled={busy || name.trim() === ''}>
          Create variation
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
