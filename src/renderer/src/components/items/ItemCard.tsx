import { assetUrl } from '@shared/asset-url'
import type { Item } from '@shared/types'

export interface ItemCardProps {
  item: Item
  projectId: string
  /** The owner's name, or `null` when the item belongs to nobody. */
  ownerName: string | null
  onOpen(): void
}

export function ItemCard({ item, projectId, ownerName, onOpen }: ItemCardProps) {
  const base = item.usages.find((u) => u.kind === 'base')
  return (
    <button type="button" className="character-card" data-testid="item-card" data-archived={item.archived ? 'true' : undefined} onClick={onOpen}>
      <span className="character-thumb">
        {base?.imagePath ? (
          <img src={assetUrl(projectId, base.imagePath)} alt={`${item.name} base reference`} />
        ) : (
          <span className="character-thumb-empty">{base?.status === 'pending' ? 'Generating…' : base?.status === 'failed' ? 'Failed' : 'No image'}</span>
        )}
      </span>
      <span className="character-name">{item.name}</span>
      <span className="character-role">{ownerName ?? 'No owner'}</span>
      {item.archived && <span className="badge">Archived</span>}
    </button>
  )
}
