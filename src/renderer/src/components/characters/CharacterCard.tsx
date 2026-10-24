import { assetUrl } from '@shared/asset-url'
import type { Character } from '@shared/types'

export interface CharacterCardProps {
  character: Character
  projectId: string
  onOpen(): void
}

export function CharacterCard({ character, projectId, onOpen }: CharacterCardProps) {
  const base = character.variations.find((v) => v.kind === 'base')
  return (
    <button type="button" className="character-card" data-testid="character-card" data-archived={character.archived ? 'true' : undefined} onClick={onOpen}>
      <span className="character-thumb">
        {base?.imagePath ? (
          <img src={assetUrl(projectId, base.imagePath)} alt={`${character.name} base reference`} />
        ) : (
          <span className="character-thumb-empty">{base?.status === 'pending' ? 'Generating…' : base?.status === 'failed' ? 'Failed' : 'No image'}</span>
        )}
      </span>
      <span className="character-name">{character.name}</span>
      <span className="character-role">{character.role}</span>
      {character.archived && <span className="badge">Archived</span>}
    </button>
  )
}
