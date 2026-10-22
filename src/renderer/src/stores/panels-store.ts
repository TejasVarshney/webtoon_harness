import { create } from 'zustand'
import type { Episode, Panel, PanelDraft, PanelPatch, PanelVersion } from '@shared/types'
import { api } from '../api'
import { useAppStore } from './app-store'

export interface PanelsData {
  /** The project `episodes` and `panelsByEpisode` belong to. */
  projectId: string | null
  /** The project's episodes in number order. */
  episodes: Episode[]
  episodesLoaded: boolean
  /** Each loaded episode's panels in strip order. The visualizer shows the one `useAppStore.activeEpisodeId` names. */
  panelsByEpisode: Record<string, Panel[]>
  /** The last load failure; cleared by the next successful load. */
  error: string | null
}

export interface PanelsActions {
  /**
   * Lists the episodes, makes the first one active when none is (or the active one is gone), and loads the
   * active episode's panels. Never rejects: a failure lands in `error` and leaves the previous list in place.
   */
  loadEpisodes(): Promise<void>
  /** Loads one episode's panels. Never rejects, like `loadEpisodes`. */
  load(episodeId: string): Promise<void>
  /** Reloads the active episode's panels, if there is one. What `panel.changed` calls. */
  reloadActive(): Promise<void>
  /** Shows another episode. The panel selection is cleared: it belonged to the episode that was open. */
  selectEpisode(id: string): void
  /** Creates the episode and opens it. */
  createEpisode(title: string): Promise<Episode>
  updateEpisode(id: string, patch: { title?: string; synopsis?: string }): Promise<Episode>
  /** Returns the new panel at once; with `generate` its image follows through `panel.changed`. */
  createPanel(draft: PanelDraft, generate: boolean): Promise<{ panel: Panel; warnings: string[] }>
  updatePanel(id: string, patch: PanelPatch): Promise<{ panel: Panel; warnings: string[] }>
  /** Starts generation without waiting for it; the pending and final versions follow through `panel.changed`. */
  generatePanel(id: string): Promise<void>
  deletePanel(id: string): Promise<void>
  movePanel(id: string, toIndex: number): Promise<void>
  revertPanel(id: string, versionId: string): Promise<Panel>
  /** Opens the file dialog in main; resolves to `null` when it is cancelled. */
  uploadPanelImage(id: string): Promise<PanelVersion | null>
}

export const initialPanelsState: PanelsData = { projectId: null, episodes: [], episodesLoaded: false, panelsByEpisode: {}, error: null }

/**
 * Only the response to the latest load is applied: one generation fires several events, so loads overlap.
 * The episode list tracks its latest load; so does each episode's panel list. Sequence numbers only grow, so a
 * load that outlives a project switch can never be mistaken for a newer one.
 */
let loadSeq = 0
let latestEpisodesLoad = 0
const latestPanelsLoad = new Map<string, number>()

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function requireProject(): string {
  const projectId = useAppStore.getState().projectId
  if (projectId === null) throw new Error('No project is open')
  return projectId
}

export const usePanelsStore = create<PanelsData & PanelsActions>()((set, get) => {
  /** Another project's episodes and panels must not show while this one loads. */
  function enter(projectId: string): void {
    if (get().projectId !== projectId) set({ ...initialPanelsState, projectId })
  }

  /** The episode a panel is shown in: the loaded strip that has it, else the active episode. */
  function episodeOf(panelId: string): string | null {
    for (const [episodeId, panels] of Object.entries(get().panelsByEpisode)) if (panels.some((p) => p.id === panelId)) return episodeId
    return useAppStore.getState().activeEpisodeId
  }

  async function reload(episodeId: string | null): Promise<void> {
    if (episodeId !== null) await get().load(episodeId)
  }

  return {
    ...initialPanelsState,

    async loadEpisodes() {
      const projectId = useAppStore.getState().projectId
      const seq = ++loadSeq
      latestEpisodesLoad = seq
      if (projectId === null) {
        set({ ...initialPanelsState })
        return
      }
      enter(projectId)
      const current = (): boolean => seq === latestEpisodesLoad && useAppStore.getState().projectId === projectId
      let episodes: Episode[]
      try {
        episodes = await api.invoke('episodes:list', { projectId })
      } catch (e) {
        if (current()) set({ error: errorText(e) })
        return
      }
      if (!current()) return
      set({ episodes, episodesLoaded: true, error: null })
      const active = useAppStore.getState().activeEpisodeId
      const open = active !== null && episodes.some((e) => e.id === active) ? active : (episodes[0]?.id ?? null)
      if (open !== active) useAppStore.setState({ activeEpisodeId: open })
      await reload(open)
    },

    async load(episodeId) {
      const projectId = useAppStore.getState().projectId
      if (projectId === null) return
      enter(projectId)
      const seq = ++loadSeq
      latestPanelsLoad.set(episodeId, seq)
      const current = (): boolean => latestPanelsLoad.get(episodeId) === seq && useAppStore.getState().projectId === projectId
      try {
        const panels = await api.invoke('panels:list', { projectId, episodeId })
        if (current()) set((s) => ({ panelsByEpisode: { ...s.panelsByEpisode, [episodeId]: panels }, error: null }))
      } catch (e) {
        if (current()) set({ error: errorText(e) })
      }
    },

    reloadActive() {
      return reload(useAppStore.getState().activeEpisodeId)
    },

    selectEpisode(id) {
      useAppStore.setState({ activeEpisodeId: id, selectedPanelId: null })
      void get().load(id)
    },

    async createEpisode(title) {
      const created = await api.invoke('episodes:create', { projectId: requireProject(), title })
      useAppStore.setState({ activeEpisodeId: created.id, selectedPanelId: null })
      await get().loadEpisodes()
      return created
    },

    async updateEpisode(id, patch) {
      const updated = await api.invoke('episodes:update', { projectId: requireProject(), episodeId: id, patch })
      await get().loadEpisodes()
      return updated
    },

    async createPanel(draft, generate) {
      const created = await api.invoke('panels:create', { projectId: requireProject(), draft, generate })
      await get().load(draft.episodeId)
      return created
    },

    async updatePanel(id, patch) {
      const updated = await api.invoke('panels:update', { projectId: requireProject(), panelId: id, patch })
      await get().load(updated.panel.episodeId)
      return updated
    },

    async generatePanel(id) {
      await api.invoke('panels:generate', { projectId: requireProject(), panelId: id })
      await reload(episodeOf(id))
    },

    async deletePanel(id) {
      const episodeId = episodeOf(id)
      await api.invoke('panels:delete', { projectId: requireProject(), panelId: id })
      if (useAppStore.getState().selectedPanelId === id) useAppStore.getState().selectPanel(null)
      await reload(episodeId)
    },

    async movePanel(id, toIndex) {
      await api.invoke('panels:move', { projectId: requireProject(), panelId: id, toIndex })
      await reload(episodeOf(id))
    },

    async revertPanel(id, versionId) {
      const reverted = await api.invoke('panels:revert', { projectId: requireProject(), panelId: id, versionId })
      await get().load(reverted.episodeId)
      return reverted
    },

    async uploadPanelImage(id) {
      const stored = await api.invoke('panels:uploadImage', { projectId: requireProject(), panelId: id })
      if (stored !== null) await reload(episodeOf(id))
      return stored
    }
  }
})
