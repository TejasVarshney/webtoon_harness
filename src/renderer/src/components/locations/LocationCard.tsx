import { assetUrl } from '@shared/asset-url'
import type { Location } from '@shared/types'

// The twin of ItemCard.

export interface LocationCardProps {
  location: Location
  projectId: string
  onOpen(): void
}

export function LocationCard({ location, projectId, onOpen }: LocationCardProps) {
  const base = location.states.find((s) => s.kind === 'base')
  const states = location.states.length
  return (
    <button type="button" className="character-card" data-testid="location-card" data-archived={location.archived ? 'true' : undefined} onClick={onOpen}>
      <span className="character-thumb is-landscape">
        {base?.imagePath ? (
          <img src={assetUrl(projectId, base.imagePath)} alt={`${location.name} base picture`} />
        ) : (
          <span className="character-thumb-empty">{base?.status === 'pending' ? 'Generating…' : 'No picture'}</span>
        )}
      </span>
      <span className="character-name">{location.name}</span>
      <span className="character-role">{states === 1 ? '1 state' : `${states} states`}</span>
      {location.archived && <span className="badge">Archived</span>}
    </button>
  )
}
