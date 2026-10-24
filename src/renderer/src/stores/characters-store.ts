import { create } from 'zustand'
import type { Character, CharacterInput, CharacterPatch, Variation, VariationInput } from '@shared/types'
import { api } from '../api'
import { useAppStore } from './app-store'

export interface CharactersData {
  /** The project `characters` belongs to. */
  projectId: string | null
  /** Every character of that project, archived ones included (the UI decides what to show). */
  characters: Character[]
  loaded: boolean
  /** The last list failure; cleared by the next successful load. */
  error: string | null
  /** The character shown in the detail view. Kept as an id so the view follows reloads. */
  selectedId: string | null
}

export interface CharactersActions {
  /** Never rejects: a failure lands in `error` and leaves the previous list in place. */
  load(): Promise<void>
  select(id: string | null): void
  /** Starts the base image too; it follows through `character.changed`. */
  create(input: CharacterInput): Promise<Character>
  update(id: string, patch: CharacterPatch): Promise<Character>
  archive(id: string): Promise<void>
  unarchive(id: string): Promise<void>
  remove(id: string): Promise<void>
  /** Starts the variation's image too. */
  addVariation(characterId: string, input: VariationInput): Promise<Variation>
  generateVariation(characterId: string, variationId: string): Promise<Variation>
  deleteVariation(characterId: string, variationId: string): Promise<void>
  /** Opens the file dialog in main; resolves to `null` when it is cancelled. */
  uploadVariationImage(characterId: string, variationId: string): Promise<Variation | null>
}

export const initialCharactersState: CharactersData = { projectId: null, characters: [], loaded: false, error: null, selectedId: null }

/** Only the response to the latest `load` is applied: one generation fires several events, so loads overlap. */
let latestLoad = 0

function requireProject(): string {
  const projectId = useAppStore.getState().projectId
  if (projectId === null) throw new Error('No project is open')
  return projectId
}

export const useCharactersStore = create<CharactersData & CharactersActions>()((set, get) => ({
  ...initialCharactersState,

  async load() {
    const projectId = useAppStore.getState().projectId
    const seq = ++latestLoad
    if (projectId === null) {
      set({ ...initialCharactersState })
      return
    }
    // Another project's characters must not show while this one loads.
    if (get().projectId !== projectId) set({ ...initialCharactersState, projectId })
    const current = (): boolean => seq === latestLoad && useAppStore.getState().projectId === projectId
    try {
      const characters = await api.invoke('characters:list', { projectId, includeArchived: true })
      if (current()) set({ characters, loaded: true, error: null })
    } catch (e) {
      if (current()) set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  select(id) {
    set({ selectedId: id })
  },

  async create(input) {
    const created = await api.invoke('characters:create', { projectId: requireProject(), input, generateBase: true })
    await get().load()
    return created
  },

  async update(id, patch) {
    const updated = await api.invoke('characters:update', { projectId: requireProject(), characterId: id, patch })
    await get().load()
    return updated
  },

  async archive(id) {
    await api.invoke('characters:archive', { projectId: requireProject(), characterId: id })
    await get().load()
  },

  async unarchive(id) {
    await api.invoke('characters:unarchive', { projectId: requireProject(), characterId: id })
    await get().load()
  },

  async remove(id) {
    await api.invoke('characters:delete', { projectId: requireProject(), characterId: id })
    if (get().selectedId === id) set({ selectedId: null })
    await get().load()
  },

  async addVariation(characterId, input) {
    const added = await api.invoke('characters:addVariation', { projectId: requireProject(), characterId, input, generate: true })
    await get().load()
    return added
  },

  async generateVariation(characterId, variationId) {
    const started = await api.invoke('characters:generateVariation', { projectId: requireProject(), characterId, variationId })
    await get().load()
    return started
  },

  async deleteVariation(characterId, variationId) {
    await api.invoke('characters:deleteVariation', { projectId: requireProject(), characterId, variationId })
    await get().load()
  },

  async uploadVariationImage(characterId, variationId) {
    const stored = await api.invoke('characters:uploadVariationImage', { projectId: requireProject(), characterId, variationId })
    if (stored !== null) await get().load()
    return stored
  }
}))
