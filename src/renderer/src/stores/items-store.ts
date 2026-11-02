import { create } from 'zustand'
import type { Item, ItemInput, ItemPatch, ItemUsage, ItemUsageInput } from '@shared/types'
import { api } from '../api'
import { useAppStore } from './app-store'

export interface ItemsData {
  /** The project `items` belongs to. */
  projectId: string | null
  /** Every item of that project, archived ones included (the UI decides what to show). */
  items: Item[]
  loaded: boolean
  /** The last list failure; cleared by the next successful load. */
  error: string | null
  /** The item shown in the detail view. Kept as an id so the view follows reloads. */
  selectedId: string | null
}

export interface ItemsActions {
  /** Never rejects: a failure lands in `error` and leaves the previous list in place. */
  load(): Promise<void>
  select(id: string | null): void
  /** Starts the base image too; it follows through `item.changed`. */
  create(input: ItemInput): Promise<Item>
  update(id: string, patch: ItemPatch): Promise<Item>
  archive(id: string): Promise<void>
  unarchive(id: string): Promise<void>
  remove(id: string): Promise<void>
  /** Starts the usage's image too. */
  addUsage(itemId: string, input: ItemUsageInput): Promise<ItemUsage>
  generateUsage(itemId: string, usageId: string): Promise<ItemUsage>
  deleteUsage(itemId: string, usageId: string): Promise<void>
  /** Opens the file dialog in main; resolves to `null` when it is cancelled. */
  uploadUsageImage(itemId: string, usageId: string): Promise<ItemUsage | null>
}

export const initialItemsState: ItemsData = { projectId: null, items: [], loaded: false, error: null, selectedId: null }

/** Only the response to the latest `load` is applied: one generation fires several events, so loads overlap. */
let latestLoad = 0

function requireProject(): string {
  const projectId = useAppStore.getState().projectId
  if (projectId === null) throw new Error('No project is open')
  return projectId
}

export const useItemsStore = create<ItemsData & ItemsActions>()((set, get) => ({
  ...initialItemsState,

  async load() {
    const projectId = useAppStore.getState().projectId
    const seq = ++latestLoad
    if (projectId === null) {
      set({ ...initialItemsState })
      return
    }
    // Another project's items must not show while this one loads.
    if (get().projectId !== projectId) set({ ...initialItemsState, projectId })
    const current = (): boolean => seq === latestLoad && useAppStore.getState().projectId === projectId
    try {
      const items = await api.invoke('items:list', { projectId, includeArchived: true })
      if (current()) set({ items, loaded: true, error: null })
    } catch (e) {
      if (current()) set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  select(id) {
    set({ selectedId: id })
  },

  async create(input) {
    const created = await api.invoke('items:create', { projectId: requireProject(), input, generateBase: true })
    await get().load()
    return created
  },

  async update(id, patch) {
    const updated = await api.invoke('items:update', { projectId: requireProject(), itemId: id, patch })
    await get().load()
    return updated
  },

  async archive(id) {
    await api.invoke('items:archive', { projectId: requireProject(), itemId: id })
    await get().load()
  },

  async unarchive(id) {
    await api.invoke('items:unarchive', { projectId: requireProject(), itemId: id })
    await get().load()
  },

  async remove(id) {
    await api.invoke('items:delete', { projectId: requireProject(), itemId: id })
    if (get().selectedId === id) set({ selectedId: null })
    await get().load()
  },

  async addUsage(itemId, input) {
    const added = await api.invoke('items:addUsage', { projectId: requireProject(), itemId, input, generate: true })
    await get().load()
    return added
  },

  async generateUsage(itemId, usageId) {
    const started = await api.invoke('items:generateUsage', { projectId: requireProject(), itemId, usageId })
    await get().load()
    return started
  },

  async deleteUsage(itemId, usageId) {
    await api.invoke('items:deleteUsage', { projectId: requireProject(), itemId, usageId })
    await get().load()
  },

  async uploadUsageImage(itemId, usageId) {
    const stored = await api.invoke('items:uploadUsageImage', { projectId: requireProject(), itemId, usageId })
    if (stored !== null) await get().load()
    return stored
  }
}))
