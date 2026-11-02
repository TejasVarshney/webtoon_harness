import { useEffect, useState, type FormEvent } from 'react'
import type { Character, Item, ItemInput, ItemPatch } from '@shared/types'
import { useItemsStore } from '../../stores/items-store'
import { Field, errorText } from '../characters/controls'

const LOCK_HINT = { min: 25, max: 70 }

// The form edits a copy of the item. While it is open the item can change underneath it (the AI updates a
// field, a generation finishes), so it tracks the `baseline` it started from: a field the user has not touched
// follows the stored value, a touched one keeps the user's text, and Save sends only the touched fields.

interface Values {
  name: string
  /** Comma separated, as typed. */
  aliases: string
  /** A character id; '' is "Nobody". */
  ownerId: string
  notes: string
  appearanceLock: string
}

const FIELDS: (keyof Values)[] = ['name', 'aliases', 'ownerId', 'notes', 'appearanceLock']

function emptyValues(): Values {
  return { name: '', aliases: '', ownerId: '', notes: '', appearanceLock: '' }
}

function toValues(i: Item | undefined): Values {
  if (i === undefined) return emptyValues()
  return { name: i.name, aliases: i.aliases.join(', '), ownerId: i.ownerId ?? '', notes: i.notes, appearanceLock: i.appearanceLock }
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

function countWords(text: string): number {
  const t = text.trim()
  return t === '' ? 0 : t.split(/\s+/).length
}

function toPatch(fields: (keyof Values)[], v: Values): ItemPatch {
  const patch: ItemPatch = {}
  for (const f of fields) {
    if (f === 'name') patch.name = v.name.trim()
    else if (f === 'aliases') patch.aliases = splitAliases(v.aliases)
    else if (f === 'ownerId') patch.ownerId = v.ownerId === '' ? null : v.ownerId
    else if (f === 'notes') patch.notes = v.notes
    else patch.appearanceLock = v.appearanceLock
  }
  return patch
}

function toInput(v: Values): ItemInput {
  return { name: v.name.trim(), aliases: splitAliases(v.aliases), ownerId: v.ownerId === '' ? null : v.ownerId, notes: v.notes, appearanceLock: v.appearanceLock }
}

export interface ItemFormProps {
  /** Absent for a new item. */
  item?: Item
  /** Every character of the project; the owner is picked from the active ones. */
  characters: Character[]
  onCreated?(created: Item): void
  onCancel?(): void
}

export function ItemForm({ item, characters, onCreated, onCancel }: ItemFormProps) {
  const [form, setForm] = useState(() => ({ baseline: toValues(item), values: toValues(item) }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { baseline, values } = form
  const editing = item !== undefined

  useEffect(() => {
    if (item === undefined) return
    const incoming = toValues(item)
    setForm((f) => (changedFields(f.baseline, incoming).length === 0 ? f : { baseline: incoming, values: merge(f.baseline, f.values, incoming) }))
  }, [item])

  const dirty = changedFields(baseline, values).length > 0
  const lockWords = countWords(values.appearanceLock)
  const lockInRange = lockWords >= LOCK_HINT.min && lockWords <= LOCK_HINT.max
  const canSubmit = !busy && values.name.trim() !== '' && (editing ? dirty : values.appearanceLock.trim() !== '')
  const owners = characters.filter((c) => !c.archived)
  // An owner who has since been archived (or removed) still shows, so the select never lies about the stored value.
  const missingOwner = values.ownerId !== '' && !owners.some((c) => c.id === values.ownerId) ? (characters.find((c) => c.id === values.ownerId)?.name ?? values.ownerId) : null

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
      if (item === undefined) {
        const created = await useItemsStore.getState().create(toInput(submitted))
        onCreated?.(created)
      } else {
        await useItemsStore.getState().update(item.id, toPatch(changedFields(baseline, submitted), submitted))
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
    <form className="character-form" data-testid="item-form" onSubmit={(e) => void submit(e)}>
      <Field label="Name">{(id) => <input id={id} data-testid="item-form-name" {...bind('name')} />}</Field>
      <Field label="Aliases">{(id) => <input id={id} placeholder="Comma separated" {...bind('aliases')} />}</Field>
      <Field label="Owner">
        {(id) => (
          <select id={id} {...bind('ownerId')}>
            <option value="">Nobody</option>
            {missingOwner !== null && <option value={values.ownerId}>{missingOwner}</option>}
            {owners.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label="Notes">{(id) => <textarea id={id} rows={2} {...bind('notes')} />}</Field>
      <Field label="Appearance lock">
        {(id) => (
          <>
            <textarea id={id} rows={5} data-testid="item-form-lock" aria-describedby={`${id}-count`} {...bind('appearanceLock')} />
            <p className="hint lock-count" id={`${id}-count`} data-testid="lock-word-count" data-in-range={String(lockInRange)}>
              {lockWords} {lockWords === 1 ? 'word' : 'words'} · {LOCK_HINT.min}–{LOCK_HINT.max} words
            </p>
          </>
        )}
      </Field>

      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" data-testid="item-form-save" disabled={!canSubmit}>
          {editing ? 'Save' : 'Create item'}
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
