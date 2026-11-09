import type { Location, LocationState } from '@shared/types'

// The twin of item-fixtures.ts.

const T = '2026-10-21T10:00:00.000Z'

export function locationState(o: Partial<LocationState> = {}): LocationState {
  return {
    id: 'lst_0000000001',
    locationId: 'loc_0000000001',
    name: 'Default',
    kind: 'base',
    delta: '',
    imagePath: 'locations/loc_0000000001/lst_0000000001_aaaaaa.png',
    status: 'ready',
    error: null,
    check: null,
    createdBy: 'user',
    createdAt: T,
    ...o
  }
}

export function location(o: Partial<Location> = {}): Location {
  return {
    id: 'loc_0000000001',
    name: 'Back stockroom',
    aliases: [],
    notes: '',
    layout: 'Camera faces the back wall. Back door at frame-left; shelves at frame-right.',
    states: [locationState()],
    archived: false,
    createdBy: 'user',
    createdAt: T,
    updatedAt: T,
    ...o
  }
}
