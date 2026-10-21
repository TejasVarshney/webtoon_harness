import { useId, useState, type ReactNode } from 'react'

/** A visible label tied to its control by id, so a select inside it never leaks its options into the label text. */
export function Field({ label, children }: { label: string; children(id: string): ReactNode }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
    </div>
  )
}

export interface ConfirmButtonProps {
  label: string
  disabled?: boolean
  onConfirm(): void
}

/** A destructive action behind a second click, so one stray click cannot delete anything. */
export function ConfirmButton({ label, disabled, onConfirm }: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false)
  if (!armed) {
    return (
      <button type="button" disabled={disabled} onClick={() => setArmed(true)}>
        {label}
      </button>
    )
  }
  return (
    <span className="confirm-actions">
      <button
        type="button"
        onClick={() => {
          setArmed(false)
          onConfirm()
        }}
      >
        Confirm delete
      </button>
      <button type="button" onClick={() => setArmed(false)}>
        Cancel
      </button>
    </span>
  )
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
