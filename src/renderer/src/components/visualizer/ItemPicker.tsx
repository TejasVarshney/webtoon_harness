import type { Character, Item, ItemUsage, PanelCharacter, PanelItem } from '@shared/types'
import { Field } from '../characters/controls'

/** Only a usage with an image on disk can stand in as a reference (the same rule the server applies). */
function isReady(u: ItemUsage): boolean {
  return u.status === 'ready' && typeof u.imagePath === 'string' && u.imagePath.length > 0
}

/** The usage an item is drawn in unless the user picks another: the base if it is ready, else the first ready one. */
function defaultUsageId(i: Item): string {
  const base = i.usages.find((u) => u.kind === 'base' && isReady(u))
  return (base ?? i.usages.find(isReady))?.id ?? ''
}

export interface ItemPickerProps {
  /** The whole item list, archived ones included: an archived one stays visible on the row that already attaches it. */
  items: Item[]
  /** The panel's current cast: who can hold an item. */
  cast: PanelCharacter[]
  /** The whole roster, so a cast row can be named. */
  characters: Character[]
  value: PanelItem[]
  onChange(next: PanelItem[]): void
}

/**
 * The items in the panel. Each row picks an item (non-archived ones, plus the row's own if it was archived since),
 * one of that item's ready usages, who holds it (a cast member or nobody) and what it is doing.
 */
export function ItemPicker({ items, cast, characters, value, onChange }: ItemPickerProps) {
  const active = items.filter((i) => !i.archived)
  const attached = new Set(value.map((row) => row.itemId))
  // Only an item that can actually be drawn is worth adding; one without a ready usage would only come back as an error.
  const toAdd = active.find((i) => !attached.has(i.id) && defaultUsageId(i) !== '')
  const holders = cast.flatMap((row) => characters.find((c) => c.id === row.characterId) ?? [])

  const update = (i: number, patch: Partial<PanelItem>): void => onChange(value.map((row, j) => (j === i ? { ...row, ...patch } : row)))

  return (
    <fieldset className="cast-picker item-picker">
      <legend>Items</legend>
      {value.map((row, i) => {
        const item = items.find((it) => it.id === row.itemId)
        const itemOptions = item === undefined || !item.archived ? active : [...active, item]
        const ready = item?.usages.filter(isReady) ?? []
        // A usage that was ready when it was attached keeps its row, so a panel that uses it still opens.
        const stale = item?.usages.find((u) => u.id === row.usageId && !isReady(u))
        return (
          <div className="cast-row" key={i}>
            <div className="field-row">
              <Field label="Item">
                {(id) => (
                  <select
                    id={id}
                    value={row.itemId}
                    onChange={(e) => {
                      const chosen = items.find((it) => it.id === e.target.value)
                      update(i, { itemId: e.target.value, usageId: chosen ? defaultUsageId(chosen) : '' })
                    }}
                  >
                    {item === undefined && <option value={row.itemId}>{row.itemId}</option>}
                    {itemOptions.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.archived ? `${it.name} (archived)` : it.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Usage">
                {(id) => (
                  <select id={id} value={row.usageId} disabled={ready.length === 0 && stale === undefined} onChange={(e) => update(i, { usageId: e.target.value })}>
                    {ready.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                    {stale !== undefined && <option value={stale.id}>{`${stale.name} (not ready)`}</option>}
                  </select>
                )}
              </Field>
            </div>
            {row.usageId === '' && <p className="hint">No ready usage yet: generate one in the Items tab, or pick another item.</p>}
            <div className="field-row">
              <Field label="Held by">
                {(id) => (
                  <select id={id} value={row.heldBy ?? ''} onChange={(e) => update(i, { heldBy: e.target.value === '' ? null : e.target.value })}>
                    <option value="">Nobody</option>
                    {holders.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Item action">
                {(id) => <input id={id} value={row.action} placeholder="What it is doing in this panel" onChange={(e) => update(i, { action: e.target.value })} />}
              </Field>
            </div>
            <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))}>
              Remove item
            </button>
          </div>
        )
      })}
      <div className="form-actions">
        <button
          type="button"
          disabled={toAdd === undefined}
          onClick={() => {
            if (toAdd === undefined) return
            // An item goes to its owner when the owner is in the cast, else to nobody.
            const heldBy = toAdd.ownerId !== null && cast.some((c) => c.characterId === toAdd.ownerId) ? toAdd.ownerId : null
            onChange([...value, { itemId: toAdd.id, usageId: defaultUsageId(toAdd), heldBy, action: '' }])
          }}
        >
          Add item
        </button>
        {active.length === 0 && <span className="hint">No items yet. Create one in the Items tab, or ask the agent to.</span>}
      </div>
    </fieldset>
  )
}
