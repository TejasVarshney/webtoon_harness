import { useEffect } from 'react'
import type { Location } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { useLocationsStore } from '../../stores/locations-store'

/**
 * The project's locations, archived ones included: the roster the Scene tab's location picker draws from.
 * `location.changed` and the Locations tab keep the store fresh; a component that mounts before either has
 * loaded it (`wanted`) asks once, so it never shows an empty list for a project that has locations.
 */
export function useLocationRoster(wanted = true): Location[] {
  const locations = useLocationsStore((s) => s.locations)
  const loaded = useLocationsStore((s) => s.loaded)
  const projectId = useAppStore((s) => s.projectId)
  useEffect(() => {
    // `load` records its own failures. A store that holds locations (loaded or set directly) is left alone.
    if (wanted && projectId !== null && !loaded && locations.length === 0) void useLocationsStore.getState().load()
  }, [wanted, projectId, loaded, locations.length])
  return locations
}
