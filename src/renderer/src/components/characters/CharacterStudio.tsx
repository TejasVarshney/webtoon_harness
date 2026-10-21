import { useEffect, useState } from 'react'
import type { Character } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { useCharactersStore } from '../../stores/characters-store'
import { CharacterCard } from './CharacterCard'
import { CharacterForm, DraftWithAiButton } from './CharacterForm'
import { ConfirmButton, errorText } from './controls'
import { VariationGrid } from './VariationGrid'

interface DetailProps {
  character: Character
  characters: Character[]
  projectId: string
  onBack(): void
}

function CharacterDetail({ character, characters, projectId, onBack }: DetailProps) {
  const [error, setError] = useState<string | null>(null)

  function run(task: Promise<unknown>): void {
    setError(null)
    task.catch((e: unknown) => setError(errorText(e)))
  }

  const { archive, unarchive, remove } = useCharactersStore.getState()
  return (
    <div className="character-detail">
      <div className="detail-header">
        <button type="button" onClick={onBack}>
          Back to characters
        </button>
        <h3>{character.name}</h3>
        {character.archived && <span className="badge">Archived</span>}
        <span className="detail-actions">
          {character.archived ? (
            <button type="button" onClick={() => run(unarchive(character.id))}>
              Unarchive
            </button>
          ) : (
            <button type="button" onClick={() => run(archive(character.id))}>
              Archive
            </button>
          )}
          <ConfirmButton label="Delete character" onConfirm={() => run(remove(character.id))} />
        </span>
      </div>
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {/* Keyed by id so another character starts from its own values; edits survive the reloads a generation causes. */}
      <CharacterForm key={character.id} character={character} characters={characters} />
      <VariationGrid character={character} projectId={projectId} />
    </div>
  )
}

/** The Characters tab: a grid of cards, and a detail view with the form and the variations. */
export function CharacterStudio() {
  const projectId = useAppStore((s) => s.projectId)
  const characters = useCharactersStore((s) => s.characters)
  const selectedId = useCharactersStore((s) => s.selectedId)
  const error = useCharactersStore((s) => s.error)
  const [creating, setCreating] = useState(false)
  const [showArchived, setShowArchived] = useState(false)

  useEffect(() => {
    void useCharactersStore.getState().load()
  }, [projectId])

  if (projectId === null) return <p className="placeholder">Create a project to add characters.</p>

  const { select } = useCharactersStore.getState()
  const selected = characters.find((c) => c.id === selectedId)
  const visible = characters.filter((c) => showArchived || !c.archived)

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
            <h3>New character</h3>
          </div>
          <CharacterForm
            characters={characters}
            onCancel={() => setCreating(false)}
            onCreated={(created) => {
              setCreating(false)
              select(created.id)
            }}
          />
        </>
      ) : selected ? (
        <CharacterDetail character={selected} characters={characters} projectId={projectId} onBack={() => select(null)} />
      ) : (
        <>
          <div className="section-header">
            <h3>Characters</h3>
            <span className="detail-actions">
              <label className="inline-label">
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                Show archived
              </label>
              <DraftWithAiButton name="" />
              <button type="button" onClick={() => setCreating(true)}>
                New character
              </button>
            </span>
          </div>
          {visible.length === 0 ? (
            <p className="placeholder">No characters yet. Create one, or ask the agent to.</p>
          ) : (
            <div className="character-grid">
              {visible.map((c) => (
                <CharacterCard key={c.id} character={c} projectId={projectId} onOpen={() => select(c.id)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
