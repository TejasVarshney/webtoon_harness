import { useEffect, useState, type FormEvent } from 'react'
import { CharacterRoleSchema } from '@shared/schemas'
import type { Character, CharacterInput, CharacterPatch } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { useCharactersStore } from '../../stores/characters-store'
import { useChatStore } from '../../stores/chat-store'
import { Field, errorText } from './controls'

const ROLES = CharacterRoleSchema.options
const CHARACTERIZATION = [
  ['personality', 'Personality'],
  ['backstory', 'Backstory'],
  ['motivation', 'Motivation'],
  ['speechStyle', 'Speech style'],
  ['notes', 'Notes']
] as const
const APPEARANCE = [
  ['age', 'Age'],
  ['gender', 'Gender'],
  ['build', 'Build'],
  ['height', 'Height'],
  ['hair', 'Hair'],
  ['eyes', 'Eyes'],
  ['skin', 'Skin'],
  ['distinguishingFeatures', 'Distinguishing features'],
  ['defaultOutfit', 'Default outfit'],
  ['palette', 'Palette']
] as const

type CharacterizationKey = (typeof CHARACTERIZATION)[number][0]
type AppearanceKey = (typeof APPEARANCE)[number][0]
type Relationship = Character['characterization']['relationships'][number]

const LOCK_HINT = { min: 40, max: 90 }

// --- the "Draft with AI" prompt ------------------------------------------------------------------

export function characterDraftPrompt(name: string): string {
  const who = name.trim() === '' ? 'a new character' : name.trim()
  return `Help me design the character "${who}": interview me briefly if needed, then fill characterization, appearance and appearanceLock, create the character and generate its base reference image.`
}

/** Prefills the main chat composer; the agent then interviews the user and creates the character. */
export function DraftWithAiButton({ name }: { name: string }) {
  const sessionId = useAppStore((s) => s.sessionId)
  return (
    <span className="draft-with-ai">
      <button type="button" onClick={() => useChatStore.getState().setDraft(characterDraftPrompt(name))}>
        Draft with AI
      </button>
      {sessionId === null && <span className="hint">Select or create a session to send it.</span>}
    </span>
  )
}

// --- form state ------------------------------------------------------------------------------------
//
// The form edits a copy of the character. While it is open the character can change underneath it
// (the AI updates a field, a generation finishes), so the form tracks the `baseline` it started from:
// a field the user has not touched follows the stored value, a touched one keeps the user's text, and
// Save sends only the touched fields. Otherwise Save would write the stale copy over the AI's change.

interface Values {
  name: string
  role: Character['role']
  /** Comma separated, as typed. */
  aliases: string
  appearanceLock: string
  characterization: Record<CharacterizationKey, string>
  appearance: Record<AppearanceKey, string>
  relationships: Relationship[]
}

type Path =
  | { field: 'name' | 'role' | 'aliases' | 'appearanceLock' | 'relationships' }
  | { field: 'characterization'; key: CharacterizationKey }
  | { field: 'appearance'; key: AppearanceKey }

const PATHS: Path[] = [
  { field: 'name' },
  { field: 'role' },
  { field: 'aliases' },
  { field: 'appearanceLock' },
  { field: 'relationships' },
  ...CHARACTERIZATION.map(([key]): Path => ({ field: 'characterization', key })),
  ...APPEARANCE.map(([key]): Path => ({ field: 'appearance', key }))
]

function emptyValues(): Values {
  return {
    name: '',
    role: 'supporting',
    aliases: '',
    appearanceLock: '',
    characterization: Object.fromEntries(CHARACTERIZATION.map(([k]) => [k, ''])) as Values['characterization'],
    appearance: Object.fromEntries(APPEARANCE.map(([k]) => [k, ''])) as Values['appearance'],
    relationships: []
  }
}

function toValues(c: Character | undefined): Values {
  if (c === undefined) return emptyValues()
  return {
    name: c.name,
    role: c.role,
    aliases: c.aliases.join(', '),
    appearanceLock: c.appearanceLock,
    characterization: Object.fromEntries(CHARACTERIZATION.map(([k]) => [k, c.characterization[k]])) as Values['characterization'],
    appearance: Object.fromEntries(APPEARANCE.map(([k]) => [k, c.appearance[k]])) as Values['appearance'],
    relationships: c.characterization.relationships
  }
}

function read(v: Values, p: Path): unknown {
  if (p.field === 'characterization') return v.characterization[p.key]
  if (p.field === 'appearance') return v.appearance[p.key]
  return v[p.field]
}

function write(v: Values, p: Path, value: unknown): Values {
  if (p.field === 'characterization') return { ...v, characterization: { ...v.characterization, [p.key]: value as string } }
  if (p.field === 'appearance') return { ...v, appearance: { ...v.appearance, [p.key]: value as string } }
  return { ...v, [p.field]: value }
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const changedPaths = (baseline: Values, v: Values): Path[] => PATHS.filter((p) => !same(read(baseline, p), read(v, p)))

/** Keeps every field the user touched; takes the stored value for the rest. */
function merge(baseline: Values, current: Values, incoming: Values): Values {
  let out = current
  for (const p of PATHS) if (same(read(current, p), read(baseline, p))) out = write(out, p, read(incoming, p))
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

function toPatch(paths: Path[], v: Values): CharacterPatch {
  const patch: CharacterPatch = {}
  for (const p of paths) {
    if (p.field === 'name') patch.name = v.name.trim()
    else if (p.field === 'role') patch.role = v.role
    else if (p.field === 'aliases') patch.aliases = splitAliases(v.aliases)
    else if (p.field === 'appearanceLock') patch.appearanceLock = v.appearanceLock
    else if (p.field === 'relationships') patch.characterization = { ...patch.characterization, relationships: v.relationships }
    else if (p.field === 'characterization') patch.characterization = { ...patch.characterization, [p.key]: v.characterization[p.key] }
    else if (p.field === 'appearance') patch.appearance = { ...patch.appearance, [p.key]: v.appearance[p.key] }
  }
  return patch
}

function toInput(v: Values): CharacterInput {
  return {
    name: v.name.trim(),
    role: v.role,
    aliases: splitAliases(v.aliases),
    characterization: { ...v.characterization, relationships: v.relationships },
    appearance: { ...v.appearance },
    appearanceLock: v.appearanceLock
  }
}

// --- the form ----------------------------------------------------------------------------------------

export interface CharacterFormProps {
  /** Absent for a new character. */
  character?: Character
  /** Every character of the project, to pick relationships from. */
  characters: Character[]
  onCreated?(created: Character): void
  onCancel?(): void
}

export function CharacterForm({ character, characters, onCreated, onCancel }: CharacterFormProps) {
  const [form, setForm] = useState(() => ({ baseline: toValues(character), values: toValues(character) }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { baseline, values } = form
  const editing = character !== undefined

  useEffect(() => {
    if (character === undefined) return
    const incoming = toValues(character)
    setForm((f) => (same(f.baseline, incoming) ? f : { baseline: incoming, values: merge(f.baseline, f.values, incoming) }))
  }, [character])

  const dirty = changedPaths(baseline, values).length > 0
  const lockWords = countWords(values.appearanceLock)
  const lockInRange = lockWords >= LOCK_HINT.min && lockWords <= LOCK_HINT.max
  const canSubmit = !busy && values.name.trim() !== '' && (editing ? dirty : values.appearanceLock.trim() !== '')
  const others = characters.filter((c) => c.id !== character?.id)

  /** Props that bind a text control to one field. */
  const bind = (path: Path) => ({
    value: read(values, path) as string,
    onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, values: write(f.values, path, e.target.value) }))
  })
  const setRelationships = (next: Relationship[]): void => setForm((f) => ({ ...f, values: { ...f.values, relationships: next } }))

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    const submitted = values
    try {
      if (character === undefined) {
        const created = await useCharactersStore.getState().create(toInput(submitted))
        onCreated?.(created)
      } else {
        await useCharactersStore.getState().update(character.id, toPatch(changedPaths(baseline, submitted), submitted))
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
    <form className="character-form" data-testid="character-form" onSubmit={(e) => void submit(e)}>
      <div className="field-row">
        <Field label="Name">{(id) => <input id={id} {...bind({ field: 'name' })} />}</Field>
        <Field label="Role">
          {(id) => (
            <select id={id} {...bind({ field: 'role' })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Field label="Aliases">{(id) => <input id={id} placeholder="Comma separated" {...bind({ field: 'aliases' })} />}</Field>

      <fieldset>
        <legend>Characterization</legend>
        {CHARACTERIZATION.map(([key, label]) => (
          <Field key={key} label={label}>
            {(id) => <textarea id={id} rows={2} {...bind({ field: 'characterization', key })} />}
          </Field>
        ))}
        <div className="relationships">
          {values.relationships.map((rel, i) => (
            <div className="relationship-row" key={i}>
              <select
                aria-label="Relationship with"
                value={rel.characterId}
                onChange={(e) => setRelationships(values.relationships.map((r, j) => (j === i ? { ...r, characterId: e.target.value } : r)))}
              >
                {others.some((c) => c.id === rel.characterId) ? null : <option value={rel.characterId}>{rel.characterId}</option>}
                {others.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                aria-label="Relation"
                placeholder="e.g. older brother"
                value={rel.relation}
                onChange={(e) => setRelationships(values.relationships.map((r, j) => (j === i ? { ...r, relation: e.target.value } : r)))}
              />
              <button type="button" onClick={() => setRelationships(values.relationships.filter((_, j) => j !== i))}>
                Remove relationship
              </button>
            </div>
          ))}
          <button type="button" disabled={others.length === 0} onClick={() => setRelationships([...values.relationships, { characterId: others[0].id, relation: '' }])}>
            Add relationship
          </button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Appearance</legend>
        <div className="appearance-fields">
          {APPEARANCE.map(([key, label]) => (
            <Field key={key} label={label}>
              {(id) => <input id={id} {...bind({ field: 'appearance', key })} />}
            </Field>
          ))}
        </div>
      </fieldset>

      <Field label="Appearance lock">
        {(id) => (
          <>
            <textarea id={id} rows={5} aria-describedby={`${id}-count`} {...bind({ field: 'appearanceLock' })} />
            <p className="hint lock-count" id={`${id}-count`} data-testid="lock-word-count" data-in-range={String(lockInRange)}>
              {lockWords} {lockWords === 1 ? 'word' : 'words'} · aim for {LOCK_HINT.min}-{LOCK_HINT.max}
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
        <button type="submit" disabled={!canSubmit}>
          {editing ? 'Save' : 'Create character'}
        </button>
        <DraftWithAiButton name={values.name} />
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
