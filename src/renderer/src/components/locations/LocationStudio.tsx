import { useEffect, useState } from 'react'
import type { Location } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { useLocationsStore } from '../../stores/locations-store'
import { ConfirmButton, errorText } from '../characters/controls'
import { LocationCard } from './LocationCard'
import { LocationForm } from './LocationForm'
import { StateGrid } from './StateGrid'

// The twin of ItemStudio.

interface DetailProps {
  location: Location
  projectId: string
  onBack(): void
}

function LocationDetail({ location, projectId, onBack }: DetailProps) {
  const [error, setError] = useState<string | null>(null)

  function run(task: Promise<unknown>): void {
    setError(null)
    task.catch((e: unknown) => setError(errorText(e)))
  }

  const { archive, unarchive, remove } = useLocationsStore.getState()
  return (
    <div className="character-detail">
      <div className="detail-header">
        <button type="button" onClick={onBack}>
          Back to locations
        </button>
        <h3>{location.name}</h3>
        {location.archived && <span className="badge">Archived</span>}
        <span className="detail-actions">
          {location.archived ? (
            <button type="button" onClick={() => run(unarchive(location.id))}>
              Unarchive
            </button>
          ) : (
            <button type="button" onClick={() => run(archive(location.id))}>
              Archive
            </button>
          )}
          <ConfirmButton label="Delete location" onConfirm={() => run(remove(location.id))} />
        </span>
      </div>
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {/* Keyed by id so another location starts from its own values; edits survive the reloads a generation causes. */}
      <LocationForm key={location.id} location={location} />
      <StateGrid location={location} projectId={projectId} />
    </div>
  )
}

/** The Locations tab: a grid of cards, and a detail view with the form and the states. */
export function LocationStudio() {
  const projectId = useAppStore((s) => s.projectId)
  const locations = useLocationsStore((s) => s.locations)
  const selectedId = useLocationsStore((s) => s.selectedId)
  const error = useLocationsStore((s) => s.error)
  const [creating, setCreating] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  useEffect(() => {
    void useLocationsStore.getState().load()
  }, [projectId])

  if (projectId === null) return <p className="placeholder">Create a project to add locations.</p>

  const { select } = useLocationsStore.getState()
  const selected = locations.find((l) => l.id === selectedId)
  const visible = locations.filter((l) => showArchived || !l.archived)

  return (
    <div className="character-studio">
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {creating ? (
        <>
          <div className="detail-header">
            <h3>New location</h3>
          </div>
          <LocationForm
            onCancel={() => setCreating(false)}
            onCreated={(created) => {
              setCreating(false)
              select(created.id)
            }}
          />
        </>
      ) : selected ? (
        <LocationDetail location={selected} projectId={projectId} onBack={() => select(null)} />
      ) : (
        <>
          <div className="section-header">
            <h3>Locations</h3>
            <span className="detail-actions">
              <label className="inline-label">
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                Show archived
              </label>
              <button type="button" onClick={() => setCreating(true)}>
                New location
              </button>
            </span>
          </div>
          {visible.length === 0 ? (
            <p className="placeholder">No locations yet. Create one, or ask the agent to.</p>
          ) : (
            <div className="character-grid">
              {visible.map((l) => (
                <LocationCard key={l.id} location={l} projectId={projectId} onOpen={() => select(l.id)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
