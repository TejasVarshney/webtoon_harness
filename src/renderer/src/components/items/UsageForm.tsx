import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ItemUsageInputSchema } from '@shared/schemas'
import type { ItemUsageInput } from '@shared/types'
import { Field, errorText } from '../characters/controls'

/** Every kind a user can add: the schema's kinds without `base`, which each item already has. */
const KINDS = ItemUsageInputSchema.shape.kind.options
const KIND_LABEL: Record<ItemUsageInput['kind'], string> = { state: 'State', action: 'Action' }

export interface UsageFormProps {
  /** Resolves when the usage was added; a rejection is shown and keeps the form open. */
  onSubmit(input: ItemUsageInput): Promise<void>
  onCancel(): void
}

export function UsageForm({ onSubmit, onCancel }: UsageFormProps) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<ItemUsageInput['kind']>('action')
  const [delta, setDelta] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  // The form opens below a long item form, so bring it into view. (jsdom has no scrollIntoView.)
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
    <form ref={formRef} className="variation-form" data-testid="usage-form" onSubmit={(e) => void submit(e)}>
      <Field label="Name">{(id) => <input id={id} autoFocus value={name} placeholder="Firing" onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="Kind">
        {(id) => (
          <select id={id} value={kind} onChange={(e) => setKind(e.target.value as ItemUsageInput['kind'])}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="How it is used / what changes">
        {(id) => <textarea id={id} rows={3} value={delta} placeholder="Both hands, right index finger on the trigger, thin cyan beam from the barrel tip" onChange={(e) => setDelta(e.target.value)} />}
      </Field>
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" data-testid="usage-submit" disabled={busy || name.trim() === ''}>
          Create usage
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  )
}
