import { create } from 'zustand'
import type { Episode, Panel, PanelDraft, PanelPatch, PanelPlacement, PanelVersion, StripBackground } from '@shared/types'
import { api } from '../api'
import { NO_PANEL_SELECTION, useAppStore } from './app-store'

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
  /** A background being edited and not saved yet: the strip of that episode shows it in place of the stored one. */
  backgroundPreview: { episodeId: string; background: StripBackground } | null
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
  /**
   * Selects a panel from outside the strip (a chat thumbnail): when it belongs to another episode than the one shown,
   * that episode is opened first, so the panel opens in focus mode. A panel that cannot be looked up is selected as is.
   */
  showPanel(id: string): Promise<void>
  /** Creates the episode and opens it. */
  createEpisode(title: string): Promise<Episode>
  updateEpisode(id: string, patch: { synopsis?: string }): Promise<Episode>
  /** Sets the strip's background, or clears it with `null`, and reloads the episodes. */
  setBackground(episodeId: string, background: StripBackground | null): Promise<Episode>
  /** Opens the file dialog in main and makes the chosen image the background; resolves to `null` when it is cancelled. */
  pickBackgroundImage(episodeId: string): Promise<Episode | null>
  /** Shows a background on the episode's strip before it is saved; `null` goes back to the stored one. */
  setBackgroundPreview(preview: PanelsData['backgroundPreview']): void
  /** Returns the new panel at once; with `generate` its image follows through `panel.changed`. */
  createPanel(draft: PanelDraft, generate: boolean): Promise<{ panel: Panel; warnings: string[] }>
  updatePanel(id: string, patch: PanelPatch): Promise<{ panel: Panel; warnings: string[] }>
  /** Starts generation without waiting for it; the pending and final versions follow through `panel.changed`. */
  generatePanel(id: string): Promise<void>
  deletePanel(id: string): Promise<void>
  /** Saves where panels sit on the strip, then reloads the episode, whose order follows reading order. */
  placePanels(episodeId: string, moves: { panelId: string; placement: PanelPlacement }[]): Promise<void>
  revertPanel(id: string, versionId: string): Promise<Panel>
  /** Opens the file dialog in main; resolves to `null` when it is cancelled. */
  uploadPanelImage(id: string): Promise<PanelVersion | null>
  /** Stores the layout sketch (a PNG data URL), or forgets it with `null`, and reloads the panel's episode. */
  saveSketch(id: string, png: string | null): Promise<Panel>
  /** The stored sketch as a PNG data URL, or `null`. */
  readSketch(id: string): Promise<string | null>
}

export const initialPanelsState: PanelsData = { projectId: null, episodes: [], episodesLoaded: false, panelsByEpisode: {}, error: null, backgroundPreview: null }

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
      useAppStore.setState({ activeEpisodeId: id, ...NO_PANEL_SELECTION })
      void get().load(id)
    },

    async showPanel(id) {
      let episodeId = Object.entries(get().panelsByEpisode).find(([, panels]) => panels.some((p) => p.id === id))?.[0] ?? null
      if (episodeId === null) {
        try {
          episodeId = (await api.invoke('panels:get', { projectId: requireProject(), panelId: id })).episodeId
        } catch {
          episodeId = null // gone or unreadable: select it anyway, as before; focus mode says what is wrong
        }
      }
      if (episodeId !== null && episodeId !== useAppStore.getState().activeEpisodeId) get().selectEpisode(episodeId)
      useAppStore.getState().selectPanel(id)
    },

    async createEpisode(title) {
      const created = await api.invoke('episodes:create', { projectId: requireProject(), title })
      useAppStore.setState({ activeEpisodeId: created.id, ...NO_PANEL_SELECTION })
      await get().loadEpisodes()
      return created
    },

    async updateEpisode(id, patch) {
      const updated = await api.invoke('episodes:update', { projectId: requireProject(), episodeId: id, patch })
      await get().loadEpisodes()
      return updated
    },

    async setBackground(episodeId, background) {
      const updated = await api.invoke('episodes:setBackground', { projectId: requireProject(), episodeId, background })
      await get().loadEpisodes()
      return updated
    },

    async pickBackgroundImage(episodeId) {
      const updated = await api.invoke('episodes:pickBackgroundImage', { projectId: requireProject(), episodeId })
      if (updated !== null) await get().loadEpisodes()
      return updated
    },

    setBackgroundPreview(preview) {
      set({ backgroundPreview: preview })
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
      const app = useAppStore.getState()
      if (app.focusedPanelId === id) app.focusPanel(null)
      if (app.selectedPanelId === id || app.selectedPanelIds.includes(id)) {
        const left = app.selectedPanelIds.filter((x) => x !== id)
        useAppStore.setState({ selectedPanelIds: left, selectedPanelId: left.at(-1) ?? null, shiftSelecting: app.shiftSelecting && left.length > 0 })
      }
      await reload(episodeId)
    },

    async placePanels(episodeId, moves) {
      await api.invoke('panels:place', { projectId: requireProject(), episodeId, moves })
      await reload(episodeId)
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
    },

    async saveSketch(id, png) {
      const panel = await api.invoke('panels:saveSketch', { projectId: requireProject(), panelId: id, png })
      await reload(panel.episodeId)
      return panel
    },

    readSketch(id) {
      return api.invoke('panels:readSketch', { projectId: requireProject(), panelId: id })
    }
  }
})
