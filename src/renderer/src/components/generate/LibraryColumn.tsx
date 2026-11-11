import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
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

interface CardProps {
  testId: string
  name: string
  /** The look to show: the chosen one, else the default one. */
  shown: Look | undefined
  selected: boolean
  /** Nothing to cast: the entry has no look at all. */
  disabled: boolean
  onToggle(): void
}

/** A compact card the three kinds share: the picture, the name under it, and a tick while it is chosen. A click chooses or drops it. */
function AssetCard({ testId, name, shown, selected, disabled, onToggle }: CardProps) {
  const projectId = useAppStore((s) => s.projectId)
  const image = shown !== undefined && hasReadyImage(shown) && projectId !== null ? assetUrl(projectId, shown.imagePath as string) : null
  return (
    <div className="asset-card" data-testid={testId} data-selected={String(selected)}>
      <button type="button" className="asset-card-button" aria-pressed={selected} disabled={disabled} title={name} onClick={onToggle}>
        <span className="asset-card-thumb">
          {image === null ? (
            <span className="asset-card-blank" aria-hidden="true">
              {name.trim().charAt(0).toUpperCase()}
            </span>
          ) : (
            <img src={image} alt="" draggable={false} />
          )}
          {selected && (
            <span className="asset-card-tick" aria-hidden="true">
              <Check size={12} strokeWidth={3} />
            </span>
          )}
        </span>
        <span className="asset-card-name">{name}</span>
      </button>
    </div>
  )
}

interface Picker {
  label: string
  value: string
  looks: Look[]
  onChange(id: string): void
}

/** The look a chosen entry is drawn in, under its section: its name, the picker, and any more controls (a location's camera). */
function ChosenRow({ name, picker, more }: { name: string; picker: Picker; more?: ReactNode }) {
  return (
    <div className="library-chosen-row">
      <span className="library-chosen-name" title={name}>
        {name}
      </span>
      <select aria-label={`${picker.label} of ${name}`} value={picker.value} onChange={(e) => picker.onChange(e.target.value)}>
        {picker.looks.map((look) => (
          <option key={look.id} value={look.id}>
            {hasReadyImage(look) ? look.name : `${look.name} (not ready)`}
          </option>
        ))}
      </select>
      {more}
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

type AssetKind = 'characters' | 'items' | 'locations'
/** A place the bar jumps to: a kind of asset, or the panel's details under them. */
type Kind = AssetKind | 'details'

/** Top to bottom, as the sections stand. */
const ORDER: Kind[] = ['characters', 'items', 'locations', 'details']

interface KindInfo {
  id: AssetKind
  title: string
  empty: string
}

const KINDS: KindInfo[] = [
  { id: 'characters', title: 'Characters', empty: 'No characters yet' },
  { id: 'items', title: 'Items', empty: 'No items yet' },
  { id: 'locations', title: 'Locations', empty: 'No locations yet' }
]

interface SectionProps {
  kind: KindInfo
  sectionRef(el: HTMLElement | null): void
  cards: ReactNode[]
  chosen: ReactNode[]
}

/** One kind's heading, its cards in wrapping rows, and the chosen entries' looks under them. */
function Section({ kind, sectionRef, cards, chosen }: SectionProps) {
  return (
    <section ref={sectionRef} className="library-section" aria-label={kind.title} data-kind={kind.id}>
      <h3 className="library-heading">
        <span>{kind.title}</span>
        <span className="library-count">{cards.length}</span>
      </h3>
      {cards.length === 0 ? <p className="hint">{kind.empty}</p> : <div className="library-grid">{cards}</div>}
      {chosen.length > 0 && (
        <div className="library-chosen" role="group" aria-label={`Chosen ${kind.title.toLowerCase()}`}>
          {chosen}
        </div>
      )}
    </section>
  )
}

export interface LibraryColumnProps {
  characters: Character[]
  items: Item[]
  locations: Location[]
  /** The panel's own fields (description, setting, shot, style, prompt), as a last section the bar jumps to as Details. */
  details?: ReactNode
}

/**
 * Everything the project has to draw with, as an asset browser: a bar of the three kinds (and Details, when given) that
 * jumps to each and marks the one in view, then a section per kind of compact cards in wrapping rows, then the panel's
 * details. Archived entries are left out. A click on a card chooses or drops it; a chosen entry's look (a character's
 * variation, an item's usage, a location's state and camera) is picked in the rows under its section, so every card
 * keeps one size.
 */
export function LibraryColumn({ characters, items, locations, details }: LibraryColumnProps) {
  const draft = useGenerateStore((s) => s.draft)
  const { toggleCharacter, toggleItem, patch } = useGenerateStore.getState()
  const [active, setActive] = useState<Kind>('characters')
  const root = useRef<HTMLDivElement>(null)
  const nav = useRef<HTMLElement>(null)
  const sections = useRef<Partial<Record<Kind, HTMLElement | null>>>({})

  // Until then, the scrolling a jump causes is not the user's: the bar keeps the kind they chose.
  const jumpingUntil = useRef(0)

  // The kind in view is the last section whose top has passed under the bar, in whatever scrolls the library; at the
  // very bottom it is the last kind, whose top may never reach the bar.
  useEffect(() => {
    const scroller = root.current?.closest<HTMLElement>('.generate-column') ?? null
    if (scroller === null) return
    const track = (): void => {
      if (Date.now() < jumpingUntil.current) return
      const line = scroller.getBoundingClientRect().top + (nav.current?.offsetHeight ?? 0) + 8
      const present = ORDER.filter((id) => sections.current[id])
      let current: Kind = 'characters'
      for (const id of present) {
        if ((sections.current[id] as HTMLElement).getBoundingClientRect().top <= line) current = id
      }
      if (present.length > 0 && scroller.scrollTop > 0 && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) current = present[present.length - 1]
      setActive(current)
    }
    scroller.addEventListener('scroll', track, { passive: true })
    return () => scroller.removeEventListener('scroll', track)
  }, [])

  function jump(kind: Kind): void {
    setActive(kind)
    jumpingUntil.current = Date.now() + 800
    // jsdom has no scrollIntoView.
    sections.current[kind]?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }

  const liveCharacters = characters.filter((c) => !c.archived)
  const liveItems = items.filter((i) => !i.archived)
  const liveLocations = locations.filter((l) => !l.archived)

  const characterCards = liveCharacters.map((c) => {
    const cast = draft.characters.find((m) => m.characterId === c.id)
    const shown = c.variations.find((v) => v.id === (cast?.variationId ?? defaultVariationId(c)))
    return <AssetCard key={c.id} testId="library-character" name={c.name} shown={shown} selected={cast !== undefined} disabled={c.variations.length === 0} onToggle={() => toggleCharacter(c)} />
  })
  const characterRows = liveCharacters.flatMap((c) => {
    const cast = draft.characters.find((m) => m.characterId === c.id)
    if (cast === undefined) return []
    const setVariation = (variationId: string): void => patch({ characters: draft.characters.map((m) => (m.characterId === c.id ? { ...m, variationId } : m)) })
    return [<ChosenRow key={c.id} name={c.name} picker={{ label: 'Variation', value: cast.variationId, looks: c.variations, onChange: setVariation }} />]
  })

  const itemCards = liveItems.map((i) => {
    const use = draft.items.find((u) => u.itemId === i.id)
    const shown = i.usages.find((u) => u.id === (use?.usageId ?? defaultUsageId(i)))
    return <AssetCard key={i.id} testId="library-item" name={i.name} shown={shown} selected={use !== undefined} disabled={i.usages.length === 0} onToggle={() => toggleItem(i)} />
  })
  const itemRows = liveItems.flatMap((i) => {
    const use = draft.items.find((u) => u.itemId === i.id)
    if (use === undefined) return []
    const setUsage = (usageId: string): void => patch({ items: draft.items.map((u) => (u.itemId === i.id ? { ...u, usageId } : u)) })
    return [<ChosenRow key={i.id} name={i.name} picker={{ label: 'Usage', value: use.usageId, looks: i.usages, onChange: setUsage }} />]
  })

  // One location at most: choosing another replaces it, choosing it again drops it.
  const locationCards = liveLocations.map((l) => {
    const chosen = draft.location?.locationId === l.id
    const shown = l.states.find((st) => st.id === (chosen ? draft.location?.stateId : defaultLocation(l).stateId))
    return (
      <AssetCard
        key={l.id}
        testId="library-location"
        name={l.name}
        shown={shown}
        selected={chosen}
        disabled={l.states.length === 0}
        onToggle={() => patch({ location: chosen ? null : defaultLocation(l) })}
      />
    )
  })
  const here = draft.location
  const place = here === null ? undefined : liveLocations.find((l) => l.id === here.locationId)
  const locationRows =
    here === null || place === undefined
      ? []
      : [
          <ChosenRow
            key={place.id}
            name={place.name}
            picker={{ label: 'State', value: here.stateId, looks: place.states, onChange: (stateId) => patch({ location: { ...here, stateId } }) }}
            more={<CameraChoice name={place.name} value={here} onChange={(location) => patch({ location })} />}
          />
        ]

  const content: Record<AssetKind, { cards: ReactNode[]; chosen: ReactNode[] }> = {
    characters: { cards: characterCards, chosen: characterRows },
    items: { cards: itemCards, chosen: itemRows },
    locations: { cards: locationCards, chosen: locationRows }
  }

  return (
    <div className="library-column" ref={root}>
      <nav className="library-nav" ref={nav} aria-label="Library sections">
        {KINDS.map((kind) => (
          <button key={kind.id} type="button" className="library-nav-tab" aria-current={active === kind.id ? 'true' : undefined} onClick={() => jump(kind.id)}>
            <span>{kind.title}</span>
            {content[kind.id].chosen.length > 0 && (
              <span className="library-nav-badge" aria-label={`${content[kind.id].chosen.length} chosen`}>
                {content[kind.id].chosen.length}
              </span>
            )}
          </button>
        ))}
        {details !== undefined && (
          <button type="button" className="library-nav-tab" aria-current={active === 'details' ? 'true' : undefined} onClick={() => jump('details')}>
            <span>Details</span>
          </button>
        )}
      </nav>
      {KINDS.map((kind) => (
        <Section
          key={kind.id}
          kind={kind}
          sectionRef={(el) => {
            sections.current[kind.id] = el
          }}
          cards={content[kind.id].cards}
          chosen={content[kind.id].chosen}
        />
      ))}
      {details !== undefined && (
        <section
          ref={(el) => {
            sections.current.details = el
          }}
          className="library-section library-details"
          aria-label="Panel details"
          data-kind="details"
        >
          {details}
        </section>
      )}
    </div>
  )
}
