import { useEffect, useState } from 'react'
import type { Character, Item } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { useItemsStore } from '../../stores/items-store'
import { ConfirmButton, errorText } from '../characters/controls'
import { useRoster } from '../visualizer/use-roster'
import { ItemCard } from './ItemCard'
import { ItemForm } from './ItemForm'
import { UsageGrid } from './UsageGrid'

interface DetailProps {
  item: Item
  characters: Character[]
  projectId: string
  onBack(): void
}

function ItemDetail({ item, characters, projectId, onBack }: DetailProps) {
  const [error, setError] = useState<string | null>(null)

  function run(task: Promise<unknown>): void {
    setError(null)
    task.catch((e: unknown) => setError(errorText(e)))
  }

  const { archive, unarchive, remove } = useItemsStore.getState()
  return (
    <div className="character-detail">
      <div className="detail-header">
        <button type="button" onClick={onBack}>
          Back to items
        </button>
        <h3>{item.name}</h3>
        {item.archived && <span className="badge">Archived</span>}
        <span className="detail-actions">
          {item.archived ? (
            <button type="button" onClick={() => run(unarchive(item.id))}>
              Unarchive
            </button>
          ) : (
            <button type="button" onClick={() => run(archive(item.id))}>
              Archive
            </button>
          )}
          <ConfirmButton label="Delete item" onConfirm={() => run(remove(item.id))} />
        </span>
      </div>
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {/* Keyed by id so another item starts from its own values; edits survive the reloads a generation causes. */}
      <ItemForm key={item.id} item={item} characters={characters} />
      <UsageGrid item={item} projectId={projectId} />
    </div>
  )
}

/** The Items tab: a grid of cards, and a detail view with the form and the usages. */
export function ItemStudio() {
  const projectId = useAppStore((s) => s.projectId)
  const items = useItemsStore((s) => s.items)
  const selectedId = useItemsStore((s) => s.selectedId)
  const error = useItemsStore((s) => s.error)
  const characters = useRoster()
  const [creating, setCreating] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  useEffect(() => {
    void useItemsStore.getState().load()
  }, [projectId])

  if (projectId === null) return <p className="placeholder">Create a project to add items.</p>

  const { select } = useItemsStore.getState()
  const selected = items.find((i) => i.id === selectedId)
  const visible = items.filter((i) => showArchived || !i.archived)
  const ownerName = (i: Item): string | null => (i.ownerId === null ? null : (characters.find((c) => c.id === i.ownerId)?.name ?? null))

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
            <h3>New item</h3>
          </div>
          <ItemForm
            characters={characters}
            onCancel={() => setCreating(false)}
            onCreated={(created) => {
              setCreating(false)
              select(created.id)
            }}
          />
        </>
      ) : selected ? (
        <ItemDetail item={selected} characters={characters} projectId={projectId} onBack={() => select(null)} />
      ) : (
        <>
          <div className="section-header">
            <h3>Items</h3>
            <span className="detail-actions">
              <label className="inline-label">
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                Show archived
              </label>
              <button type="button" onClick={() => setCreating(true)}>
                New item
              </button>
            </span>
          </div>
          {visible.length === 0 ? (
            <p className="placeholder">No items yet. Create one, or ask the agent to.</p>
          ) : (
            <div className="character-grid">
              {visible.map((i) => (
                <ItemCard key={i.id} item={i} projectId={projectId} ownerName={ownerName(i)} onOpen={() => select(i.id)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
