import { PanelPositionSchema } from '@shared/schemas'
import type { Character, PanelCharacter, Variation } from '@shared/types'
import { Field } from '../characters/controls'

const POSITIONS = PanelPositionSchema.options

/** Only a variation with an image on disk can stand in as a reference (the same rule the server applies). */
function isReady(v: Variation): boolean {
  return v.status === 'ready' && typeof v.imagePath === 'string' && v.imagePath.length > 0
}

/** The look a character is cast in unless the user picks another: the base if it is ready, else the first ready one. */
function defaultVariationId(c: Character): string {
  const base = c.variations.find((v) => v.kind === 'base' && isReady(v))
  return (base ?? c.variations.find(isReady))?.id ?? ''
}

export interface CastPickerProps {
  /** The whole roster, archived characters included: an archived one stays visible on the row that already casts it. */
  characters: Character[]
  value: PanelCharacter[]
  onChange(next: PanelCharacter[]): void
}

/**
 * The panel's cast. Each row picks a character (non-archived ones, plus the row's own if it was archived since),
 * one of that character's ready variations, and what they are doing, how they look and where they stand.
 */
export function CastPicker({ characters, value, onChange }: CastPickerProps) {
  const active = characters.filter((c) => !c.archived)
  const cast = new Set(value.map((row) => row.characterId))
  // Prefer someone who can actually be drawn; a character cast twice would only come back as an error.
  const notCast = active.filter((c) => !cast.has(c.id))
  const toAdd = notCast.find((c) => defaultVariationId(c) !== '') ?? notCast[0]

  const update = (i: number, patch: Partial<PanelCharacter>): void => onChange(value.map((row, j) => (j === i ? { ...row, ...patch } : row)))

  return (
    <fieldset className="cast-picker">
      <legend>Cast</legend>
      {value.map((row, i) => {
        const character = characters.find((c) => c.id === row.characterId)
        const characterOptions = character === undefined || !character.archived ? active : [...active, character]
        const ready = character?.variations.filter(isReady) ?? []
        // A look that was ready when it was cast keeps its row, so a panel that uses it still opens.
        const stale = character?.variations.find((v) => v.id === row.variationId && !isReady(v))
        return (
          <div className="cast-row" key={i}>
            <div className="field-row">
              <Field label="Character">
                {(id) => (
                  <select
                    id={id}
                    value={row.characterId}
                    onChange={(e) => {
                      const chosen = characters.find((c) => c.id === e.target.value)
                      update(i, { characterId: e.target.value, variationId: chosen ? defaultVariationId(chosen) : '' })
                    }}
                  >
                    {character === undefined && <option value={row.characterId}>{row.characterId}</option>}
                    {characterOptions.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.archived ? `${c.name} (archived)` : c.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Variation">
                {(id) => (
                  <select id={id} value={row.variationId} disabled={ready.length === 0 && stale === undefined} onChange={(e) => update(i, { variationId: e.target.value })}>
                    {ready.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                    {stale !== undefined && <option value={stale.id}>{`${stale.name} (not ready)`}</option>}
                  </select>
                )}
              </Field>
            </div>
            {row.variationId === '' && <p className="hint">No ready variation yet: generate one in the Characters tab, or pick another character.</p>}
            <div className="field-row">
              <Field label="Action">{(id) => <input id={id} value={row.action} placeholder="e.g. turning" onChange={(e) => update(i, { action: e.target.value })} />}</Field>
              <Field label="Expression">{(id) => <input id={id} value={row.expression} placeholder="e.g. curious" onChange={(e) => update(i, { expression: e.target.value })} />}</Field>
              <Field label="Position">
                {(id) => (
                  <select id={id} value={row.position} onChange={(e) => update(i, { position: e.target.value as PanelCharacter['position'] })}>
                    {POSITIONS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))}>
              Remove cast member
            </button>
          </div>
        )
      })}
      <div className="form-actions">
        <button
          type="button"
          disabled={toAdd === undefined}
          onClick={() => {
            if (toAdd !== undefined) onChange([...value, { characterId: toAdd.id, variationId: defaultVariationId(toAdd), action: '', expression: '', position: 'center' }])
          }}
        >
          Add character
        </button>
        {active.length === 0 && <span className="hint">No characters yet. Create one in the Characters tab, or ask the agent to.</span>}
      </div>
    </fieldset>
  )
}
