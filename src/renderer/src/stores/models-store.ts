import { create } from 'zustand'
import type { EndpointInput, EndpointPatch, ModelInput, ModelPatch } from '@shared/ipc'
import type { EndpointConfig, ModelConfig, ModelRegistryView, Role } from '@shared/types'
import { api } from '../api'

export interface ModelsData {
  view: ModelRegistryView | null
}

/** Mirrors the `models:*` channels. Every mutation reloads the view, so the UI never shows a stale registry. */
export interface ModelsActions {
  load(): Promise<void>
  addEndpoint(input: EndpointInput): Promise<EndpointConfig>
  updateEndpoint(id: string, patch: EndpointPatch): Promise<EndpointConfig>
  removeEndpoint(id: string): Promise<Role[]>
  /** Write-only: the key goes to the main process and is never read back (the view only has `hasKey`). */
  setApiKey(endpointId: string, key: string | null): Promise<void>
  addModel(input: ModelInput): Promise<ModelConfig>
  updateModel(id: string, patch: ModelPatch): Promise<ModelConfig>
  removeModel(id: string): Promise<Role[]>
  assignRole(role: Role, modelId: string | null): Promise<void>
  testModel(modelId: string): Promise<{ ok: boolean; message: string }>
}

export const useModelsStore = create<ModelsData & ModelsActions>()((set, get) => ({
  view: null,

  async load() {
    set({ view: await api.invoke('models:get', {}) })
  },

  async addEndpoint(input) {
    const created = await api.invoke('models:addEndpoint', input)
    await get().load()
    return created
  },

  async updateEndpoint(id, patch) {
    const updated = await api.invoke('models:updateEndpoint', { id, patch })
    await get().load()
    return updated
  },

  async removeEndpoint(id) {
    const { clearedRoles } = await api.invoke('models:removeEndpoint', { id })
    await get().load()
    return clearedRoles
  },

  async setApiKey(endpointId, key) {
    await api.invoke('models:setApiKey', { endpointId, key })
    await get().load()
  },

  async addModel(input) {
    const created = await api.invoke('models:addModel', input)
    await get().load()
    return created
  },

  async updateModel(id, patch) {
    const updated = await api.invoke('models:updateModel', { id, patch })
    await get().load()
    return updated
  },

  async removeModel(id) {
    const { clearedRoles } = await api.invoke('models:removeModel', { id })
    await get().load()
    return clearedRoles
  },

  async assignRole(role, modelId) {
    await api.invoke('models:assignRole', { role, modelId })
    await get().load()
  },

  testModel(modelId) {
    return api.invoke('models:test', { modelId })
  }
}))
