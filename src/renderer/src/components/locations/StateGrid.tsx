import { useState } from 'react'
import { assetUrl } from '@shared/asset-url'
import type { Location, LocationState } from '@shared/types'
import { useLocationsStore } from '../../stores/locations-store'
import { ConfirmButton, errorText } from '../characters/controls'
import { SheetCheckBadge } from '../SheetCheckBadge'
import { StateForm } from './StateForm'

// The twin of UsageGrid.

const BADGE: Record<LocationState['status'], string> = { pending: 'Generating…', ready: 'Ready', failed: 'Failed' }

/** What stands in for a picture that is not there. A state without one is drawn from the base picture, so that is no failure. */
function placeholder(s: LocationState): string {
  if (s.status === 'pending') return BADGE.pending
  if (s.kind === 'state' && s.status !== 'ready') return 'Uses the base picture'
  return s.status === 'ready' ? 'No picture' : BADGE.failed
}

export interface StateGridProps {
  location: Location
  projectId: string
}

export function StateGrid({ location, projectId }: StateGridProps) {
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The state whose action is in flight; one at a time keeps the buttons honest. */
  const [busyId, setBusyId] = useState<string | null>(null)
  const { addState, generateState, uploadStateImage, deleteState } = useLocationsStore.getState()

  async function act(stateId: string, task: () => Promise<unknown>): Promise<void> {
    setBusyId(stateId)
    setError(null)
    try {
      await task()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="variation-section" aria-label="States">
      <div className="section-header">
        <h4>States</h4>
        <button type="button" data-testid="state-add" onClick={() => setAdding(true)} disabled={adding}>
          Add state
        </button>
      </div>
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <ul className="variation-grid">
        {location.states.map((s) => (
          <li key={s.id} className="variation-card" data-testid="state-card" data-status={s.status}>
            <div className="variation-media is-landscape">
              {s.imagePath !== null ? <img src={assetUrl(projectId, s.imagePath)} alt={s.name} /> : <div className="variation-placeholder">{placeholder(s)}</div>}
              {/* A kept previous picture still shows; the badge says the newest attempt did not finish. */}
              {s.imagePath !== null && s.status !== 'ready' && <span className={`badge badge-${s.status}`}>{BADGE[s.status]}</span>}
            </div>
            <div className="variation-meta">
              <strong>{s.name}</strong>
              <span className="variation-kind">{s.kind === 'base' ? 'Base' : 'State'}</span>
              {s.delta !== '' && <span className="variation-delta">{s.delta}</span>}
              {/* A state that was never drawn is not an error worth showing: it uses the base picture. */}
              {s.status === 'failed' && s.error !== null && (s.kind === 'base' || s.imagePath !== null) && <span className="error">{s.error}</span>}
              <SheetCheckBadge check={s.check} />
            </div>
            <div className="variation-actions">
              {s.status !== 'pending' && (
                <button type="button" disabled={busyId !== null} onClick={() => void act(s.id, () => generateState(location.id, s.id))}>
                  {s.imagePath === null && s.kind === 'state' ? 'Draw picture' : 'Regenerate'}
                </button>
              )}
              {/* While a generation runs, its result would overwrite the upload (or the upload the result). */}
              <button type="button" disabled={busyId !== null || s.status === 'pending'} onClick={() => void act(s.id, () => uploadStateImage(location.id, s.id))}>
                Upload
              </button>
              {s.kind !== 'base' && <ConfirmButton label="Delete" disabled={busyId !== null} onConfirm={() => void act(s.id, () => deleteState(location.id, s.id))} />}
            </div>
          </li>
        ))}
      </ul>
      {adding && (
        <StateForm
          onCancel={() => setAdding(false)}
          onSubmit={async (input, generate) => {
            await addState(location.id, input, { generate })
            setAdding(false)
          }}
        />
      )}
    </section>
  )
}
