import { useState } from 'react'
import { assetUrl } from '@shared/asset-url'
import type { Character, Item, Location, PanelLocation } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { useGenerateStore } from '../../stores/generate-store'
import { cameraKind } from '../panel-editor/camera-kind'
import { defaultLocation, defaultUsageId, defaultVariationId, hasReadyImage } from './generate-draft'

/** One look of a library entry (a character's variation, an item's usage, a location's state). */
interface Look {
  id: string
  name: string
  status: string
  imagePath: string | null
}

interface TileProps {
  testId: string
  name: string
  /** The look to show: the chosen one, else the default one. */
  shown: Look | undefined
  selected: boolean
  /** Nothing to cast: the entry has no look at all. */
  disabled: boolean
  onToggle(): void
  /** The picker for the look, shown while the entry is selected. */
  picker?: { label: string; value: string; looks: Look[]; onChange(id: string): void }
  /** More controls under the picker, shown while the entry is selected (a location's camera). */
  more?: React.ReactNode
}

/** The tile the three kinds share: a picture and a name that toggle the entry, and a look picker once it is chosen. */
function LibraryTile({ testId, name, shown, selected, disabled, onToggle, picker, more }: TileProps) {
  const projectId = useAppStore((s) => s.projectId)
  const image = shown !== undefined && hasReadyImage(shown) && projectId !== null ? assetUrl(projectId, shown.imagePath as string) : null
  return (
    <div className="library-tile" data-testid={testId} data-selected={String(selected)}>
      <button type="button" className="library-tile-button" aria-pressed={selected} disabled={disabled} onClick={onToggle}>
        {image === null ? <span className="library-tile-blank" aria-hidden="true" /> : <img src={image} alt="" draggable={false} />}
        <span className="library-tile-name">{name}</span>
      </button>
      {selected && picker !== undefined && (
        <select aria-label={`${picker.label} of ${name}`} value={picker.value} onChange={(e) => picker.onChange(e.target.value)}>
          {picker.looks.map((look) => (
            <option key={look.id} value={look.id}>
              {hasReadyImage(look) ? look.name : `${look.name} (not ready)`}
            </option>
          ))}
        </select>
      )}
      {selected && more}
    </div>
  )
}

/** Where the camera is for a chosen location: its main angle, the reverse, or the user's own words, the choices the Scene tab offers. */
function CameraChoice({ name, value, onChange }: { name: string; value: PanelLocation; onChange(location: PanelLocation): void }) {
  // "Other" shows the text box before anything is typed in it.
  const [typing, setTyping] = useState(false)
  const kind = typing ? 'other' : cameraKind(value.camera)
  const aim = (next: string): void => {
    setTyping(next === 'other')
    if (next !== 'other') onChange({ ...value, camera: next })
  }
  return (
    <>
      <select aria-label={`Camera of ${name}`} value={kind} onChange={(e) => aim(e.target.value)}>
        <option value="main">Main angle</option>
        <option value="reverse">Reverse angle</option>
        <option value="other">Other</option>
      </select>
      {kind === 'other' && (
        <input
          aria-label={`Camera angle of ${name}`}
          value={cameraKind(value.camera) === 'other' ? value.camera : ''}
          placeholder="Where the camera is, e.g. low"
          onChange={(e) => onChange({ ...value, camera: e.target.value })}
        />
      )}
    </>
  )
}

function Section({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <section className="library-section" aria-label={title}>
      <h3>{title}</h3>
      {children.length === 0 ? <p className="hint">{empty}</p> : <div className="library-grid">{children}</div>}
    </section>
  )
}

export interface LibraryColumnProps {
  characters: Character[]
  items: Item[]
  locations: Location[]
}

/**
 * Everything the project has to draw with: every character, item and location that is not archived. A click chooses
 * or drops one; a chosen entry shows a picker for the look it is drawn in (a location's state), and a chosen location a camera.
 */
export function LibraryColumn({ characters, items, locations }: LibraryColumnProps) {
  const draft = useGenerateStore((s) => s.draft)
  const { toggleCharacter, toggleItem, patch } = useGenerateStore.getState()

  return (
    <div className="library-column">
      <Section title="Characters" empty="No characters yet">
        {characters
          .filter((c) => !c.archived)
          .map((c) => {
            const cast = draft.characters.find((m) => m.characterId === c.id)
            const shown = c.variations.find((v) => v.id === (cast?.variationId ?? defaultVariationId(c)))
            const setVariation = (variationId: string): void => patch({ characters: draft.characters.map((m) => (m.characterId === c.id ? { ...m, variationId } : m)) })
            return (
              <LibraryTile
                key={c.id}
                testId="library-character"
                name={c.name}
                shown={shown}
                selected={cast !== undefined}
                disabled={c.variations.length === 0}
                onToggle={() => toggleCharacter(c)}
                picker={{ label: 'Variation', value: cast?.variationId ?? '', looks: c.variations, onChange: setVariation }}
              />
            )
          })}
      </Section>
      <Section title="Items" empty="No items yet">
        {items
          .filter((i) => !i.archived)
          .map((i) => {
            const use = draft.items.find((u) => u.itemId === i.id)
            const shown = i.usages.find((u) => u.id === (use?.usageId ?? defaultUsageId(i)))
            const setUsage = (usageId: string): void => patch({ items: draft.items.map((u) => (u.itemId === i.id ? { ...u, usageId } : u)) })
            return (
              <LibraryTile
                key={i.id}
                testId="library-item"
                name={i.name}
                shown={shown}
                selected={use !== undefined}
                disabled={i.usages.length === 0}
                onToggle={() => toggleItem(i)}
                picker={{ label: 'Usage', value: use?.usageId ?? '', looks: i.usages, onChange: setUsage }}
              />
            )
          })}
      </Section>
      <Section title="Locations" empty="No locations yet">
        {locations
          .filter((l) => !l.archived)
          .map((l) => {
            const chosen = draft.location?.locationId === l.id
            const shown = l.states.find((s) => s.id === (chosen ? draft.location?.stateId : defaultLocation(l).stateId))
            const here = chosen ? draft.location : null
            // One location at most: choosing another replaces it, choosing it again drops it.
            return (
              <LibraryTile
                key={l.id}
                testId="library-location"
                name={l.name}
                shown={shown}
                selected={chosen}
                disabled={l.states.length === 0}
                onToggle={() => patch({ location: chosen ? null : defaultLocation(l) })}
                picker={{ label: 'State', value: here?.stateId ?? '', looks: l.states, onChange: (stateId) => here && patch({ location: { ...here, stateId } }) }}
                more={here === null ? undefined : <CameraChoice name={l.name} value={here} onChange={(location) => patch({ location })} />}
              />
            )
          })}
      </Section>
    </div>
  )
}
