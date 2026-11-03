import { create } from 'zustand'
import type { PluginView } from '@shared/types'
import { api } from '../api'

export interface PluginsData {
  /** Null until the first load. */
  plugins: PluginView[] | null
  /** Why `plugins.json` could not be read, or null. Every plugin is off while it is set. */
  loadError: string | null
}

/** Mirrors the `plugins:*` channels. `plugins.changed` reloads the list, so a status line follows the plugin. */
export interface PluginsActions {
  load(): Promise<void>
  setEnabled(id: string, enabled: boolean): Promise<void>
  /** Rejects with main's message when it refuses the patch (a port outside 1024-65535). */
  setConfig(id: string, patch: Record<string, unknown>): Promise<void>
}

export const initialPluginsState: PluginsData = { plugins: null, loadError: null }

/** Whether the Claude Code plugin is on and set to run the main chat; the app's own agent model is then not used. */
export function claudeCodeIsAgent(s: PluginsData): boolean {
  const plugin = s.plugins?.find((p) => p.id === 'claude-code')
  return plugin?.enabled === true && plugin.config.useAsAgent === true
}

export const usePluginsStore = create<PluginsData & PluginsActions>()((set) => {
  /** Shows the view main returned for one plugin at once; the change event follows with the rest. */
  const replace = (view: PluginView): void =>
    set((s) => ({ plugins: s.plugins === null ? [view] : s.plugins.map((p) => (p.id === view.id ? view : p)) }))

  return {
    ...initialPluginsState,

    async load() {
      const [plugins, loadError] = await Promise.all([api.invoke('plugins:list', {}), api.invoke('plugins:loadError', {})])
      set({ plugins, loadError })
    },

    async setEnabled(id, enabled) {
      replace(await api.invoke('plugins:setEnabled', { id, enabled }))
    },

    async setConfig(id, patch) {
      replace(await api.invoke('plugins:setConfig', { id, patch }))
    }
  }
})
