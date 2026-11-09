import { create } from 'zustand'
import type { Location, LocationInput, LocationPatch, LocationState, LocationStateInput } from '@shared/types'
import { api } from '../api'
import { useAppStore } from './app-store'

export interface LocationsData {
  /** The project `locations` belongs to. */
  projectId: string | null
  /** Every location of that project, archived ones included (the UI decides what to show). */
  locations: Location[]
  loaded: boolean
  /** The last list failure; cleared by the next successful load. */
  error: string | null
  /** The location shown in the detail view. Kept as an id so the view follows reloads. */
  selectedId: string | null
}

export interface LocationsActions {
  /** Never rejects: a failure lands in `error` and leaves the previous list in place. */
  load(): Promise<void>
  select(id: string | null): void
  /** Starts the base picture too; it follows through `location.changed`. */
  create(input: LocationInput): Promise<Location>
  update(id: string, patch: LocationPatch): Promise<Location>
  archive(id: string): Promise<void>
  unarchive(id: string): Promise<void>
  remove(id: string): Promise<void>
  /** Draws the state's own picture only with `generate`: without one, panels use the base picture and the state's words. */
  addState(locationId: string, input: LocationStateInput, opts?: { generate?: boolean }): Promise<LocationState>
  generateState(locationId: string, stateId: string): Promise<LocationState>
  deleteState(locationId: string, stateId: string): Promise<void>
  /** Opens the file dialog in main; resolves to `null` when it is cancelled. */
  uploadStateImage(locationId: string, stateId: string): Promise<LocationState | null>
}

export const initialLocationsState: LocationsData = { projectId: null, locations: [], loaded: false, error: null, selectedId: null }

/** Only the response to the latest `load` is applied: one generation fires several events, so loads overlap. */
let latestLoad = 0

function requireProject(): string {
  const projectId = useAppStore.getState().projectId
  if (projectId === null) throw new Error('No project is open')
  return projectId
}

export const useLocationsStore = create<LocationsData & LocationsActions>()((set, get) => ({
  ...initialLocationsState,

  async load() {
    const projectId = useAppStore.getState().projectId
    const seq = ++latestLoad
    if (projectId === null) {
      set({ ...initialLocationsState })
      return
    }
    // Another project's locations must not show while this one loads.
    if (get().projectId !== projectId) set({ ...initialLocationsState, projectId })
    const current = (): boolean => seq === latestLoad && useAppStore.getState().projectId === projectId
    try {
      const locations = await api.invoke('locations:list', { projectId, includeArchived: true })
      if (current()) set({ locations, loaded: true, error: null })
    } catch (e) {
      if (current()) set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  select(id) {
    set({ selectedId: id })
  },

  async create(input) {
    const created = await api.invoke('locations:create', { projectId: requireProject(), input, generateBase: true })
    await get().load()
    return created
  },

  async update(id, patch) {
    const updated = await api.invoke('locations:update', { projectId: requireProject(), locationId: id, patch })
    await get().load()
    return updated
  },

  async archive(id) {
    await api.invoke('locations:archive', { projectId: requireProject(), locationId: id })
    await get().load()
  },

  async unarchive(id) {
    await api.invoke('locations:unarchive', { projectId: requireProject(), locationId: id })
    await get().load()
  },

  async remove(id) {
    await api.invoke('locations:delete', { projectId: requireProject(), locationId: id })
    if (get().selectedId === id) set({ selectedId: null })
    await get().load()
  },

  async addState(locationId, input, opts = {}) {
    const added = await api.invoke('locations:addState', { projectId: requireProject(), locationId, input, generate: opts.generate === true })
    await get().load()
    return added
  },

  async generateState(locationId, stateId) {
    const started = await api.invoke('locations:generateState', { projectId: requireProject(), locationId, stateId })
    await get().load()
    return started
  },

  async deleteState(locationId, stateId) {
    await api.invoke('locations:deleteState', { projectId: requireProject(), locationId, stateId })
    await get().load()
  },

  async uploadStateImage(locationId, stateId) {
    const stored = await api.invoke('locations:uploadStateImage', { projectId: requireProject(), locationId, stateId })
    if (stored !== null) await get().load()
    return stored
  }
}))
