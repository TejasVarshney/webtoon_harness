import { useEffect } from 'react'
import type { Item } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { useItemsStore } from '../../stores/items-store'

/**
 * The project's items, archived ones included: the roster the item picker draws from.
 * `item.changed` and the Items tab keep the store fresh; a component that mounts before either has
 * loaded it (`wanted`) asks once, so it never shows an empty list for a project that has items.
 */
export function useItemRoster(wanted = true): Item[] {
  const items = useItemsStore((s) => s.items)
  const loaded = useItemsStore((s) => s.loaded)
  const projectId = useAppStore((s) => s.projectId)
  useEffect(() => {
    // `load` records its own failures. A store that holds items (loaded or set directly) is left alone.
    if (wanted && projectId !== null && !loaded && items.length === 0) void useItemsStore.getState().load()
  }, [wanted, projectId, loaded, items.length])
  return items
}
