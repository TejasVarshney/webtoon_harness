import { useEffect } from 'react'
import type { Character } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { useCharactersStore } from '../../stores/characters-store'

/**
 * The project's characters, archived ones included: the roster dialogue names and the cast picker draw from.
 * `character.changed` and the Webtoon tab keep the store fresh; a component that mounts before either has
 * loaded it (`wanted`) asks once, so it never shows an empty roster for a project that has characters.
 */
export function useRoster(wanted = true): Character[] {
  const characters = useCharactersStore((s) => s.characters)
  const loaded = useCharactersStore((s) => s.loaded)
  const projectId = useAppStore((s) => s.projectId)
  useEffect(() => {
    // `load` records its own failures. A store that holds characters (loaded or set directly) is left alone.
    if (wanted && projectId !== null && !loaded && characters.length === 0) void useCharactersStore.getState().load()
  }, [wanted, projectId, loaded, characters.length])
  return characters
}
