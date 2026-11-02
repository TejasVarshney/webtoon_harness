import type { Item, ItemUsage } from '@shared/types'

export { PROJECT_ID } from './character-fixtures'
const T = '2026-10-21T10:00:00.000Z'

export function usage(o: Partial<ItemUsage> = {}): ItemUsage {
  return {
    id: 'use_0000000001',
    itemId: 'itm_0000000001',
    name: 'At rest',
    kind: 'base',
    delta: '',
    imagePath: 'items/itm_0000000001/use_0000000001_aaaaaa.png',
    status: 'ready',
    error: null,
    createdBy: 'user',
    createdAt: T,
    ...o
  }
}

export function item(o: Partial<Item> = {}): Item {
  return {
    id: 'itm_0000000001',
    name: 'Ray Pistol',
    aliases: [],
    ownerId: null,
    notes: '',
    appearanceLock: 'Chrome pistol with a cyan barrel ring',
    usages: [usage()],
    archived: false,
    createdBy: 'user',
    createdAt: T,
    updatedAt: T,
    ...o
  }
}

/** `base` plus one extra usage (an action unless `o` says otherwise). */
export function withUsage(i: Item, name: string, o: Partial<ItemUsage> = {}): Item {
  const id = `use_${String(i.usages.length + 1).padStart(10, '0')}`
  return { ...i, usages: [...i.usages, usage({ id, itemId: i.id, name, kind: 'action', delta: 'both hands, finger on the trigger', imagePath: `items/${i.id}/${id}_bbbbbb.png`, ...o })] }
}
