import { create } from 'zustand'
import type { CropArea, Episode, Panel, PanelAspect, PanelDraft, PanelPatch, PanelPlacement, PanelVersion, PromptPreview, StripBackground } from '@shared/types'
import { api } from '../api'
import { NO_PANEL_SELECTION, useAppStore } from './app-store'
import { track, useStripHistoryStore, type PictureState, type StepLabel } from './strip-history-store'

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
  /** Why a background could not be saved after its editor was closed; the preview stays until it is dismissed. */
  backgroundError: string | null
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
  /** Sets the strip's background, or clears it with `null`, and reloads the episodes. The strip's undo records it. */
  setBackground(episodeId: string, background: StripBackground | null): Promise<Episode>
  /**
   * Opens the file dialog in main and makes the chosen image the background; resolves to `null` when it is cancelled.
   * Not undoable: main deletes the image it replaces, so the episode's background steps go.
   */
  pickBackgroundImage(episodeId: string): Promise<Episode | null>
  /** Shows a background on the episode's strip before it is saved; `null` goes back to the stored one. */
  setBackgroundPreview(preview: PanelsData['backgroundPreview']): void
  /** Forgets a background save failure and puts the strip back on the stored background. */
  dismissBackgroundError(): void
  /** Returns the new panel at once; with `generate` its image follows through `panel.changed`. */
  createPanel(draft: PanelDraft, generate: boolean, sketchPng?: string): Promise<{ panel: Panel; warnings: string[] }>
  /** What a new panel from this draft would be drawn with. Writes nothing. */
  previewPrompt(draft: PanelDraft, hasSketch: boolean): Promise<PromptPreview>
  updatePanel(id: string, patch: PanelPatch): Promise<{ panel: Panel; warnings: string[] }>
  /** Starts generation without waiting for it; the pending and final versions follow through `panel.changed`. */
  generatePanel(id: string): Promise<void>
  deletePanel(id: string): Promise<void>
  /**
   * Saves where panels sit on the strip, then reloads the episode, whose order follows reading order. The strip's undo
   * records it as one step named `label`, from the layouts main read and wrote.
   */
  placePanels(episodeId: string, moves: { panelId: string; placement: PanelPlacement }[], label?: StepLabel): Promise<void>
  /** Makes a ready version current. Undoable when the panel had a current version. */
  revertPanel(id: string, versionId: string): Promise<Panel>
  /** Opens the file dialog in main; resolves to `null` when it is cancelled. Undoable like `revertPanel`. */
  uploadPanelImage(id: string): Promise<PanelVersion | null>
  /**
   * Stores the part `area` covers of a version's picture as the panel's new current version, in `aspect` if given, and
   * reloads its episode. Its undo puts back both the version and the shape.
   */
  cropPanelImage(id: string, versionId: string, area: CropArea, aspect?: PanelAspect): Promise<PanelVersion>
  /** Stores the layout sketch (a PNG data URL), or forgets it with `null`, and reloads the panel's episode. */
  saveSketch(id: string, png: string | null): Promise<Panel>
  /** The stored sketch as a PNG data URL, or `null`. */
  readSketch(id: string): Promise<string | null>
}

export const initialPanelsState: PanelsData = { projectId: null, episodes: [], episodesLoaded: false, panelsByEpisode: {}, error: null, backgroundPreview: null, backgroundError: null }

/**
 * Only the response to the latest load is applied: one generation fires several events, so loads overlap.
 * The episode list tracks its latest load; so does each episode's panel list. Sequence numbers only grow, so a
 * load that outlives a project switch can never be mistaken for a newer one.
 */
let loadSeq = 0

/**
 * Each episode's background saves, one at a time, and the episode as the last of them returned it: each save takes the
 * one before it as its undo's value, since the store's list may not have caught up with that save yet.
 */
const backgrounds = new Map<string, { saving: Promise<unknown>; last: Episode | null }>()
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

  /** The picture the panel shows now, as the store has it; null when it has none (then a new picture is not undoable). */
  function pictureOf(panelId: string): { episodeId: string; state: PictureState } | null {
    for (const panels of Object.values(get().panelsByEpisode)) {
      const panel = panels.find((p) => p.id === panelId)
      if (panel !== undefined) return panel.currentVersionId === null ? null : { episodeId: panel.episodeId, state: { versionId: panel.currentVersionId, aspect: panel.aspect } }
    }
    return null
  }

  function recordPicture(panelId: string, was: { episodeId: string; state: PictureState } | null, now: PictureState, label: StepLabel): void {
    if (was !== null) useStripHistoryStore.getState().record({ kind: 'picture', episodeId: was.episodeId, panelId, label, before: was.state, after: now })
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

    setBackground(episodeId, background) {
      // Async from the first line, so no open project is a rejection and not a throw.
      const run = (async () => {
        const projectId = requireProject()
        const line = backgrounds.get(episodeId) ?? { saving: Promise.resolve(), last: null }
        backgrounds.set(episodeId, line)
        const saved = line.saving.then(async () => {
          // What the strip had before this save: the last save's answer, unless the list is newer (another change since).
          const listed = get().episodes.find((e) => e.id === episodeId)
          const was = line.last !== null && (listed === undefined || line.last.updatedAt >= listed.updatedAt) ? line.last : listed
          const updated = await api.invoke('episodes:setBackground', { projectId, episodeId, background })
          line.last = updated
          if (was !== undefined) useStripHistoryStore.getState().record({ kind: 'background', episodeId, label: 'background', before: was.background, after: updated.background })
          await get().loadEpisodes()
          return updated
        })
        line.saving = saved.catch(() => undefined)
        return saved
      })()
      return track(run)
    },

    async pickBackgroundImage(episodeId) {
      const updated = await api.invoke('episodes:pickBackgroundImage', { projectId: requireProject(), episodeId })
      if (updated !== null) {
        const line = backgrounds.get(episodeId)
        if (line !== undefined) line.last = updated
        useStripHistoryStore.getState().dropBackground(episodeId)
        await get().loadEpisodes()
      }
      return updated
    },

    setBackgroundPreview(preview) {
      set({ backgroundPreview: preview })
    },

    dismissBackgroundError() {
      set({ backgroundError: null, backgroundPreview: null })
    },

    async createPanel(draft, generate, sketchPng) {
      const created = await api.invoke('panels:create', { projectId: requireProject(), draft, generate, ...(sketchPng === undefined ? {} : { sketchPng }) })
      await get().load(draft.episodeId)
      return created
    },

    previewPrompt(draft, hasSketch) {
      return api.invoke('panels:previewPrompt', { projectId: requireProject(), draft, hasSketch })
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
      useStripHistoryStore.getState().dropPanel(id)
      const app = useAppStore.getState()
      if (app.focusedPanelId === id) app.focusPanel(null)
      if (app.selectedPanelId === id || app.selectedPanelIds.includes(id)) {
        const left = app.selectedPanelIds.filter((x) => x !== id)
        useAppStore.setState({ selectedPanelIds: left, selectedPanelId: left.at(-1) ?? null, shiftSelecting: app.shiftSelecting && left.length > 0 })
      }
      await reload(episodeId)
    },

    placePanels(episodeId, moves, label = 'move') {
      return track(
        (async () => {
          const { before, after } = await api.invoke('panels:place', { projectId: requireProject(), episodeId, moves })
          useStripHistoryStore.getState().record({ kind: 'place', episodeId, label, before, after, panelIds: moves.map((m) => m.panelId) })
          await reload(episodeId)
        })()
      )
    },

    revertPanel(id, versionId) {
      const was = pictureOf(id)
      return track(
        (async () => {
          const reverted = await api.invoke('panels:revert', { projectId: requireProject(), panelId: id, versionId })
          recordPicture(id, was, { versionId, aspect: reverted.aspect }, 'picture')
          await get().load(reverted.episodeId)
          return reverted
        })()
      )
    },

    uploadPanelImage(id) {
      const was = pictureOf(id)
      return track(
        (async () => {
          const stored = await api.invoke('panels:uploadImage', { projectId: requireProject(), panelId: id })
          if (stored === null) return null
          if (was !== null) recordPicture(id, was, { versionId: stored.id, aspect: was.state.aspect }, 'picture')
          await reload(episodeOf(id))
          return stored
        })()
      )
    },

    cropPanelImage(id, versionId, area, aspect) {
      const was = pictureOf(id)
      return track(
        (async () => {
          const stored = await api.invoke('panels:crop', { projectId: requireProject(), panelId: id, versionId, area, ...(aspect === undefined ? {} : { aspect }) })
          if (was !== null) recordPicture(id, was, { versionId: stored.id, aspect: aspect ?? was.state.aspect }, 'crop')
          await reload(episodeOf(id))
          return stored
        })()
      )
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
