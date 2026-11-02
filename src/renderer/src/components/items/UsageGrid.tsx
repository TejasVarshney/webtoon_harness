import { useState } from 'react'
import { assetUrl } from '@shared/asset-url'
import type { Item, ItemUsage } from '@shared/types'
import { useItemsStore } from '../../stores/items-store'
import { ConfirmButton, errorText } from '../characters/controls'
import { UsageForm } from './UsageForm'

const BADGE: Record<ItemUsage['status'], string> = { pending: 'Generating…', ready: 'Ready', failed: 'Failed' }
const KIND_LABEL: Record<ItemUsage['kind'], string> = { base: 'Base', state: 'State', action: 'Action' }

export interface UsageGridProps {
  item: Item
  projectId: string
}

export function UsageGrid({ item, projectId }: UsageGridProps) {
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The usage whose action is in flight; one at a time keeps the buttons honest. */
  const [busyId, setBusyId] = useState<string | null>(null)
  const { addUsage, generateUsage, uploadUsageImage, deleteUsage } = useItemsStore.getState()

  async function act(usageId: string, task: () => Promise<unknown>): Promise<void> {
    setBusyId(usageId)
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
    <section className="variation-section" aria-label="Usages">
      <div className="section-header">
        <h4>Usages</h4>
        <button type="button" data-testid="usage-add" onClick={() => setAdding(true)} disabled={adding}>
          Add usage
        </button>
      </div>
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <ul className="variation-grid">
        {item.usages.map((u) => (
          <li key={u.id} className="variation-card" data-testid="usage-card" data-status={u.status}>
            <div className="variation-media">
              {u.imagePath !== null ? (
                <img src={assetUrl(projectId, u.imagePath)} alt={u.name} />
              ) : (
                <div className="variation-placeholder">{u.status === 'ready' ? 'No image' : BADGE[u.status]}</div>
              )}
              {/* A kept previous image still shows; the badge says the newest attempt did not finish. */}
              {u.imagePath !== null && u.status !== 'ready' && <span className={`badge badge-${u.status}`}>{BADGE[u.status]}</span>}
            </div>
            <div className="variation-meta">
              <strong>{u.name}</strong>
              <span className="variation-kind">{KIND_LABEL[u.kind]}</span>
              {u.delta !== '' && <span className="variation-delta">{u.delta}</span>}
              {u.status === 'failed' && u.error !== null && <span className="error">{u.error}</span>}
            </div>
            <div className="variation-actions">
              {u.status !== 'pending' && (
                <button type="button" disabled={busyId !== null} onClick={() => void act(u.id, () => generateUsage(item.id, u.id))}>
                  Regenerate
                </button>
              )}
              {/* While a generation runs, its result would overwrite the upload (or the upload the result). */}
              <button type="button" disabled={busyId !== null || u.status === 'pending'} onClick={() => void act(u.id, () => uploadUsageImage(item.id, u.id))}>
                Upload
              </button>
              {u.kind !== 'base' && <ConfirmButton label="Delete" disabled={busyId !== null} onConfirm={() => void act(u.id, () => deleteUsage(item.id, u.id))} />}
            </div>
          </li>
        ))}
      </ul>
      {adding && (
        <UsageForm
          onCancel={() => setAdding(false)}
          onSubmit={async (input) => {
            await addUsage(item.id, input)
            setAdding(false)
          }}
        />
      )}
    </section>
  )
}
