import { useEffect, useId, useRef, useState } from 'react'
import type { Panel, PanelCharacter, PanelItem } from '@shared/types'
import { CastPicker } from '../visualizer/CastPicker'
import { ItemPicker } from '../visualizer/ItemPicker'
import { useItemRoster } from '../visualizer/use-item-roster'
import { useRoster } from '../visualizer/use-roster'
import { LinesTab } from './LinesTab'
import { SceneTab, type SceneFields } from './SceneTab'
import { useDialogueSaver } from './use-dialogue-saver'
import { useFieldAutosave, type FieldAutosave } from './use-field-autosave'

type Tab = 'lines' | 'cast' | 'items' | 'scene'

const TABS: { id: Tab; label: string }[] = [
  { id: 'lines', label: 'Lines' },
  { id: 'cast', label: 'Cast' },
  { id: 'items', label: 'Items' },
  { id: 'scene', label: 'Scene' }
]

export interface PanelInspectorProps {
  panel: Panel
  /** The line selected on the stage (or by a row of Lines), which Lines marks and scrolls to. */
  selectedLine: number | null
  /** Selects a line from a row of Lines, so the stage selects its bubble. */
  onSelectLine(i: number | null): void
}

/** A tab's refused saves, each with "Undo my change", then the warnings of its last save as a quiet list. */
function SaveStatus({ fields, warnings }: { fields: FieldAutosave<unknown>[]; warnings: string[] }) {
  return (
    <>
      {fields.map(
        (f, i) =>
          f.error !== null && (
            <div key={i} role="alert" className="error inspector-alert">
              <p>{f.error}</p>
              <button type="button" onClick={f.undo}>
                Undo my change
              </button>
            </div>
          )
      )}
      {warnings.length > 0 && (
        <ul className="inspector-warnings">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </>
  )
}

/**
 * The open panel's controls under the stage, in tabs: Lines (the default), Cast, Items and Scene. Every change saves
 * on its own, sending only the field that changed, and the agent's edits show as they land (spec §6). The fields'
 * drafts live here, not in the tabs, so switching tabs keeps them, and the cast can let go of what a leaving member
 * held. Selecting a bubble on the stage opens Lines; so does a line that changed under an edit, or a refused dialogue
 * save, so its message is seen. Keyed by panel in the workspace: stepping to another panel or going Back saves what
 * is still waiting.
 */
export function PanelInspector({ panel, selectedLine, onSelectLine }: PanelInspectorProps) {
  const [tab, setTab] = useState<Tab>('lines')
  const id = useId()
  const roster = useRoster()
  const itemRoster = useItemRoster()
  const { reported } = useDialogueSaver(panel.id)
  // The tabs' own scroll area: Lines scrolls the selected row inside it, so the stage above never moves.
  const scrollArea = useRef<HTMLDivElement>(null)
  // The cast before the items: on unmount it saves first, so no item is saved with a holder the stored cast lacks.
  const characters = useFieldAutosave(panel, 'characters')
  const items = useFieldAutosave(panel, 'items')
  const scene: SceneFields = {
    description: useFieldAutosave(panel, 'description'),
    setting: useFieldAutosave(panel, 'setting'),
    shot: useFieldAutosave(panel, 'shot'),
    aspect: useFieldAutosave(panel, 'aspect'),
    frame: useFieldAutosave(panel, 'frame'),
    beside: useFieldAutosave(panel, 'beside'),
    gapAfter: useFieldAutosave(panel, 'gapAfter'),
    gutter: useFieldAutosave(panel, 'gutter')
  }

  useEffect(() => {
    if (selectedLine !== null) setTab('lines')
  }, [selectedLine])
  useEffect(() => {
    if (reported > 0) setTab('lines')
  }, [reported])

  /** Whoever leaves the cast lets go of what they held, first: the service refuses an item held by someone not in the cast. */
  function setCast(next: PanelCharacter[]): void {
    const cast = new Set(next.map((c) => c.characterId))
    if (items.value.some((i) => i.heldBy !== null && !cast.has(i.heldBy))) {
      items.set(items.value.map((i): PanelItem => (i.heldBy !== null && !cast.has(i.heldBy) ? { ...i, heldBy: null } : i)))
    }
    characters.set(next)
  }

  /** A holder can be someone just added to the cast: the cast is saved first. */
  function setItems(next: PanelItem[]): void {
    characters.flush()
    items.set(next)
  }

  function flushPickers(): void {
    characters.flush()
    items.flush()
  }

  return (
    <section className="panel-inspector" aria-label="Panel details">
      <div className="tab-bar inspector-tabs" role="tablist" aria-label="Panel">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`${id}-${t.id}`} aria-selected={tab === t.id} aria-controls={`${id}-panel`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div ref={scrollArea} className="inspector-panel" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${tab}`}>
        {tab === 'lines' && <LinesTab panel={panel} characters={roster} selectedLine={selectedLine} onSelectLine={onSelectLine} scrollArea={scrollArea} />}
        {tab === 'cast' && (
          // The pickers' inputs have no blur of their own: leaving any of them saves at once.
          <div className="inspector-fields" onBlur={flushPickers}>
            <SaveStatus fields={[characters, items]} warnings={characters.warnings} />
            <CastPicker characters={roster} value={characters.value} onChange={setCast} />
          </div>
        )}
        {tab === 'items' && (
          <div className="inspector-fields" onBlur={flushPickers}>
            <SaveStatus fields={[items, characters]} warnings={items.warnings} />
            <ItemPicker items={itemRoster} cast={characters.value} characters={roster} value={items.value} onChange={setItems} />
          </div>
        )}
        {tab === 'scene' && (
          <div className="inspector-fields">
            <SaveStatus fields={Object.values(scene)} warnings={Object.values(scene).flatMap((f) => f.warnings)} />
            <SceneTab fields={scene} />
          </div>
        )}
      </div>
    </section>
  )
}
