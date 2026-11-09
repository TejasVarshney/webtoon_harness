import { useEffect, useState, type FormEvent } from 'react'
import type { Location, LocationInput, LocationPatch } from '@shared/types'
import { useLocationsStore } from '../../stores/locations-store'
import { Field, errorText } from '../characters/controls'

// The twin of ItemForm. The form edits a copy of the location. While it is open the location can change underneath
// it (the agent updates a field, a picture finishes), so it tracks the `baseline` it started from: a field the user
// has not touched follows the stored value, a touched one keeps the user's text, and Save sends only the touched fields.

interface Values {
  name: string
  /** Comma separated, as typed. */
  aliases: string
  notes: string
  layout: string
}

const FIELDS: (keyof Values)[] = ['name', 'aliases', 'notes', 'layout']

function toValues(l: Location | undefined): Values {
  if (l === undefined) return { name: '', aliases: '', notes: '', layout: '' }
  return { name: l.name, aliases: l.aliases.join(', '), notes: l.notes, layout: l.layout }
}

const changedFields = (baseline: Values, v: Values): (keyof Values)[] => FIELDS.filter((f) => baseline[f] !== v[f])

/** Keeps every field the user touched; takes the stored value for the rest. */
function merge(baseline: Values, current: Values, incoming: Values): Values {
  const out = { ...current }
  for (const f of FIELDS) if (current[f] === baseline[f]) out[f] = incoming[f]
  return out
}

function splitAliases(text: string): string[] {
  return text
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a !== '')
}

function toPatch(fields: (keyof Values)[], v: Values): LocationPatch {
  const patch: LocationPatch = {}
  for (const f of fields) {
    if (f === 'name') patch.name = v.name.trim()
    else if (f === 'aliases') patch.aliases = splitAliases(v.aliases)
    else if (f === 'notes') patch.notes = v.notes
    else patch.layout = v.layout
  }
  return patch
}

function toInput(v: Values): LocationInput {
  return { name: v.name.trim(), aliases: splitAliases(v.aliases), notes: v.notes, layout: v.layout }
}

/** What the layout is for, under its box. */
export const LAYOUT_HINT = 'Seen from the main camera angle: what the camera faces, then each landmark and its side of the frame (frame-left, center, frame-right, foreground, background).'

/** Shown after a saved layout change: the pictures still show the old one. */
export const LAYOUT_SAVED = 'Layout saved. Regenerate the pictures so they show it.'

export interface LocationFormProps {
  /** Absent for a new location. */
  location?: Location
  onCreated?(created: Location): void
  onCancel?(): void
}

export function LocationForm({ location, onCreated, onCancel }: LocationFormProps) {
  const [form, setForm] = useState(() => ({ baseline: toValues(location), values: toValues(location) }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [layoutSaved, setLayoutSaved] = useState(false)
  const { baseline, values } = form
  const editing = location !== undefined

  useEffect(() => {
    if (location === undefined) return
    const incoming = toValues(location)
    setForm((f) => (changedFields(f.baseline, incoming).length === 0 ? f : { baseline: incoming, values: merge(f.baseline, f.values, incoming) }))
  }, [location])

  const dirty = changedFields(baseline, values).length > 0
  const canSubmit = !busy && values.name.trim() !== '' && values.layout.trim() !== '' && (!editing || dirty)

  /** Props that bind a text control to one field. */
  const bind = (field: keyof Values) => ({
    value: values[field],
    onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, values: { ...f.values, [field]: e.target.value } }))
  })

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    const submitted = values
    try {
      if (location === undefined) {
        const created = await useLocationsStore.getState().create(toInput(submitted))
        onCreated?.(created)
      } else {
        const fields = changedFields(baseline, submitted)
        await useLocationsStore.getState().update(location.id, toPatch(fields, submitted))
        setLayoutSaved(fields.includes('layout'))
        // What was saved is the new baseline; typing done while saving stays a pending edit.
        setForm((f) => ({ ...f, baseline: submitted }))
      }
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="character-form" data-testid="location-form" onSubmit={(e) => void submit(e)}>
      <Field label="Name">{(id) => <input id={id} data-testid="location-form-name" placeholder="Supermart back stockroom" {...bind('name')} />}</Field>
      <Field label="Aliases">{(id) => <input id={id} placeholder="Comma separated" {...bind('aliases')} />}</Field>
      <Field label="Notes">{(id) => <textarea id={id} rows={2} {...bind('notes')} />}</Field>
      <Field label="Layout">
        {(id) => (
          <>
            <textarea
              id={id}
              rows={5}
              data-testid="location-form-layout"
              aria-describedby={`${id}-hint`}
              placeholder="Camera faces the back wall. Back door at frame-left; shelves along the right wall at frame-right; an oil drum in the center foreground."
              {...bind('layout')}
            />
            <p className="hint" id={`${id}-hint`}>
              {LAYOUT_HINT}
            </p>
          </>
        )}
      </Field>

      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {layoutSaved && !dirty && (
        <p role="status" className="hint">
          {LAYOUT_SAVED}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" data-testid="location-form-save" disabled={!canSubmit}>
          {editing ? 'Save' : 'Create location'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
