import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft } from 'lucide-react'
import { useCharactersStore } from '../../stores/characters-store'
import { useGenerateStore } from '../../stores/generate-store'
import { useItemsStore } from '../../stores/items-store'
import { useLocationsStore } from '../../stores/locations-store'
import { usePanelsStore } from '../../stores/panels-store'
import { errorText } from '../characters/controls'
import { canDraw, pruneDraft } from './generate-draft'
import { GenerateSketch } from './GenerateSketch'
import { LibraryColumn } from './LibraryColumn'
import { ReferenceRow } from './ReferenceRow'

/**
 * Where a new panel is set up: the panels it draws from, everything the project has to draw with, and the buttons
 * that make it. It replaces the whole workspace while it is open, so the AI chat is not on screen at all.
 */
export function GeneratePage() {
  const request = useGenerateStore((s) => s.request)
  const draft = useGenerateStore((s) => s.draft)
  const submitting = useGenerateStore((s) => s.submitting)
  const characters = useCharactersStore((s) => s.characters)
  const items = useItemsStore((s) => s.items)
  const locations = useLocationsStore((s) => s.locations)
  const charactersLoaded = useCharactersStore((s) => s.loaded)
  const itemsLoaded = useItemsStore((s) => s.loaded)
  const locationsLoaded = useLocationsStore((s) => s.loaded)
  const panels = usePanelsStore((s) => (request === null ? undefined : s.panelsByEpisode[request.episodeId]))
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    // Each records its own failures. The chat may never have been opened, so nothing else has loaded these.
    void useCharactersStore.getState().load()
    void useItemsStore.getState().load()
    void useLocationsStore.getState().load()
  }, [])

  // An entry archived or deleted since it was chosen has no tile to deselect and main would refuse it: drop it.
  useEffect(() => {
    const { draft: current, patch } = useGenerateStore.getState()
    const pruned = pruneDraft(current, { characters: charactersLoaded ? characters : null, items: itemsLoaded ? items : null, locations: locationsLoaded ? locations : null })
    if (pruned !== current) patch({ characters: pruned.characters, items: pruned.items, location: pruned.location })
  }, [characters, items, locations, charactersLoaded, itemsLoaded, locationsLoaded, draft.characters, draft.items, draft.location])

  if (request === null) return null

  async function submit(draw: boolean): Promise<void> {
    setError(null)
    try {
      await useGenerateStore.getState().submit(draw)
    } catch (e) {
      setError(errorText(e))
    }
  }

  function back(): void {
    if (useGenerateStore.getState().isDirty()) setConfirming(true)
    else useGenerateStore.getState().close()
  }

  const chosen = request.referencePanelIds.flatMap((id) => {
    const index = (panels ?? []).findIndex((p) => p.id === id)
    const panel = panels?.[index]
    return panel === undefined ? [] : [{ panel, number: index + 1 }]
  })
  const castNames = draft.characters.flatMap((m) => characters.find((c) => c.id === m.characterId)?.name ?? [])
  const itemNames = draft.items.flatMap((u) => items.find((i) => i.id === u.itemId)?.name ?? [])
  const locationName = locations.find((l) => l.id === draft.location?.locationId)?.name

  return (
    <div className="generate-page" data-testid="generate-page">
      <header className="generate-header">
        <button type="button" className="generate-back" onClick={back}>
          <ArrowLeft size={16} aria-hidden="true" /> Back
        </button>
        <h2>Generate panel</h2>
        <div className="generate-actions">
          <button type="button" data-testid="generate-blank" disabled={submitting} onClick={() => void submit(false)}>
            Add blank panel
          </button>
          <button type="button" className="btn-primary" data-testid="generate-submit" disabled={submitting || !canDraw(draft)} onClick={() => void submit(true)}>
            Generate
          </button>
        </div>
      </header>
      {error !== null && (
        <p role="alert" className="error generate-error">
          {error}
        </p>
      )}
      <div className="generate-columns">
        <aside className="generate-column" aria-label="Library">
          <LibraryColumn characters={characters} items={items} locations={locations} />
        </aside>
        <section className="generate-column" aria-label="Panels to draw from">
          <h3>Drawn from</h3>
          {chosen.length === 0 ? (
            <p className="hint">No panels chosen. Shift-click panels on the strip to draw from them.</p>
          ) : (
            <ul className="reference-list">
              {chosen.map(({ panel, number }) => (
                <ReferenceRow key={panel.id} panel={panel} number={number} onRemove={() => useGenerateStore.getState().removeReference(panel.id)} />
              ))}
            </ul>
          )}
          <GenerateSketch />
        </section>
        <section className="generate-column" aria-label="This panel">
          <h3>This panel</h3>
          <p className="hint">{castNames.length === 0 ? 'No characters' : castNames.join(', ')}</p>
          <p className="hint">{itemNames.length === 0 ? 'No items' : itemNames.join(', ')}</p>
          <p className="hint">{locationName ?? 'No location'}</p>
        </section>
      </div>
      {confirming &&
        createPortal(
          <div className="modal-backdrop">
            <div className="modal" role="dialog" aria-label="Discard this panel?">
              <p>Discard this panel?</p>
              <div className="modal-actions">
                <button type="button" onClick={() => setConfirming(false)}>
                  Keep editing
                </button>
                <button type="button" className="btn-danger" onClick={() => useGenerateStore.getState().close()}>
                  Discard
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}
