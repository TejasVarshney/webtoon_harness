import { useState } from 'react'
import { assetUrl } from '@shared/asset-url'
import type { Character, Variation } from '@shared/types'
import { useCharactersStore } from '../../stores/characters-store'
import { ConfirmButton, errorText } from './controls'
import { VariationForm } from './VariationForm'

const BADGE: Record<Variation['status'], string> = { pending: 'Generating…', ready: 'Ready', failed: 'Failed' }

export interface VariationGridProps {
  character: Character
  projectId: string
}

export function VariationGrid({ character, projectId }: VariationGridProps) {
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The variation whose action is in flight; one at a time keeps the buttons honest. */
  const [busyId, setBusyId] = useState<string | null>(null)
  const { addVariation, generateVariation, uploadVariationImage, deleteVariation } = useCharactersStore.getState()

  async function act(variationId: string, task: () => Promise<unknown>): Promise<void> {
    setBusyId(variationId)
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
    <section className="variation-section" aria-label="Variations">
      <div className="section-header">
        <h4>Variations</h4>
        <button type="button" onClick={() => setAdding(true)} disabled={adding}>
          Add variation
        </button>
      </div>
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <ul className="variation-grid">
        {character.variations.map((v) => (
          <li key={v.id} className="variation-card" data-testid="variation-card" data-status={v.status}>
            <div className="variation-media">
              {v.imagePath !== null ? (
                <img src={assetUrl(projectId, v.imagePath)} alt={v.name} />
              ) : (
                <div className="variation-placeholder">{v.status === 'ready' ? 'No image' : BADGE[v.status]}</div>
              )}
              {/* A kept previous image still shows; the badge says the newest attempt did not finish. */}
              {v.imagePath !== null && v.status !== 'ready' && <span className={`badge badge-${v.status}`}>{BADGE[v.status]}</span>}
            </div>
            <div className="variation-meta">
              <strong>{v.name}</strong>
              <span className="variation-kind">{v.kind}</span>
              {v.delta !== '' && <span className="variation-delta">{v.delta}</span>}
              {v.status === 'failed' && v.error !== null && <span className="error">{v.error}</span>}
            </div>
            <div className="variation-actions">
              {v.status === 'failed' && (
                <button type="button" disabled={busyId !== null} onClick={() => void act(v.id, () => generateVariation(character.id, v.id))}>
                  Retry
                </button>
              )}
              {v.status === 'ready' && (
                <button type="button" disabled={busyId !== null} onClick={() => void act(v.id, () => generateVariation(character.id, v.id))}>
                  Regenerate
                </button>
              )}
              {/* While a generation runs, its result would overwrite the upload (or the upload the result). */}
              <button type="button" disabled={busyId !== null || v.status === 'pending'} onClick={() => void act(v.id, () => uploadVariationImage(character.id, v.id))}>
                Upload
              </button>
              {v.kind !== 'base' && <ConfirmButton label="Delete" disabled={busyId !== null} onConfirm={() => void act(v.id, () => deleteVariation(character.id, v.id))} />}
            </div>
          </li>
        ))}
      </ul>
      {adding && (
        <VariationForm
          onCancel={() => setAdding(false)}
          onSubmit={async (input) => {
            await addVariation(character.id, input)
            setAdding(false)
          }}
        />
      )}
    </section>
  )
}
