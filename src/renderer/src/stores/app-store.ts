import { create } from 'zustand'
import type { ProjectMeta, ProjectProblem, SessionSummary } from '@shared/types'
import { api } from '../api'

export type StudioTab = 'webtoon' | 'characters' | 'items' | 'locations' | 'story'

export interface AppData {
  projects: ProjectMeta[]
  projectId: string | null
  problems: ProjectProblem[]
  sessions: SessionSummary[]
  sessionId: string | null
  /** The last panel selected, or null. */
  selectedPanelId: string | null
  /** Every selected panel, in the order they were added. */
  selectedPanelIds: string[]
  /** True once a shift-click added to the selection; the selection bar shows for it. A plain click ends it. */
  shiftSelecting: boolean
  /** The panel open in the editing mode, which covers the strip. */
  focusedPanelId: string | null
  activeEpisodeId: string | null
  studioTab: StudioTab
  /** Thread key (a session id, or `panel:<panelId>`) to the id of its running agent run. */
  runningThreads: Record<string, string>
}

export interface AppActions {
  loadProjects(): Promise<void>
  /** `stylePreset` left out gives the project the default style. */
  createProject(title: string, stylePreset?: string): Promise<void>
  openProject(id: string): Promise<void>
  /** Leaves the open project and goes back to the home page. */
  closeProject(): void
  /** Re-reads the open project's meta and problems (what `project.changed` calls). Leaves the sessions and the selection alone. */
  refreshMeta(): Promise<void>
  /**
   * Re-reads only the open project's problems. Main records an unreadable file while it lists (characters, episodes,
   * panels, sessions, story), so this runs after those lists load; see `startEventSync`.
   */
  refreshProblems(): Promise<void>
  /** Copies a library style into the open project and shows it at once. Rejects when main refuses. */
  applyStyle(styleId: string): Promise<void>
  loadSessions(): Promise<void>
  newSession(): Promise<void>
  selectSession(id: string | null): void
  renameSession(id: string, title: string): Promise<void>
  bookmarkSession(id: string, bookmarked: boolean): Promise<void>
  deleteSession(id: string): Promise<void>
  /** A plain click: the selection becomes this panel alone, or nothing for null. */
  selectPanel(id: string | null): void
  /** A shift-click: adds the panel to the selection, or takes it out when it is already in. */
  togglePanelSelection(id: string): void
  /** Opens a panel in the editing mode (selecting it alone), or closes the editing mode for null. */
  focusPanel(id: string | null): void
  setStudioTab(tab: StudioTab): void
}

/** What no selection and no open panel look like: where a new project or episode starts. */
export const NO_PANEL_SELECTION = { selectedPanelId: null, selectedPanelIds: [], shiftSelecting: false, focusedPanelId: null } satisfies Pick<
  AppData,
  'selectedPanelId' | 'selectedPanelIds' | 'shiftSelecting' | 'focusedPanelId'
>

export const initialAppState: AppData = {
  projects: [],
  projectId: null,
  problems: [],
  sessions: [],
  sessionId: null,
  ...NO_PANEL_SELECTION,
  activeEpisodeId: null,
  studioTab: 'webtoon',
  runningThreads: {}
}

export const useAppStore = create<AppData & AppActions>()((set, get) => ({
  ...initialAppState,

  async loadProjects() {
    const { projects, problems } = await api.invoke('projects:list', {})
    // The app starts on the home page: the user picks a project, none is opened for them.
    set({ projects, problems })
  },

  async createProject(title, stylePreset) {
    const meta = await api.invoke('projects:create', stylePreset === undefined ? { title } : { title, stylePreset })
    set((s) => ({ projects: [meta, ...s.projects.filter((p) => p.id !== meta.id)] }))
    await get().openProject(meta.id)
  },

  async openProject(id) {
    const { meta, problems } = await api.invoke('projects:open', { projectId: id })
    set((s) => ({
      projects: s.projects.some((p) => p.id === meta.id) ? s.projects.map((p) => (p.id === meta.id ? meta : p)) : [meta, ...s.projects],
      projectId: meta.id,
      problems,
      sessions: [],
      sessionId: null,
      ...NO_PANEL_SELECTION,
      activeEpisodeId: null
    }))
    await get().loadSessions()
  },

  closeProject() {
    set({ projectId: null, problems: [], sessions: [], sessionId: null, ...NO_PANEL_SELECTION, activeEpisodeId: null })
  },

  async refreshMeta() {
    const projectId = get().projectId
    if (projectId === null) return
    const { meta, problems } = await api.invoke('projects:open', { projectId })
    // The user may have switched project while this was loading.
    if (get().projectId !== projectId) return
    set((s) => ({ projects: s.projects.map((p) => (p.id === meta.id ? meta : p)), problems }))
  },

  async refreshProblems() {
    const projectId = get().projectId
    if (projectId === null) return
    const { problems } = await api.invoke('projects:open', { projectId })
    if (get().projectId !== projectId) return
    set({ problems })
  },

  async applyStyle(styleId) {
    const projectId = get().projectId
    if (projectId === null) return
    const meta = await api.invoke('styles:apply', { projectId, styleId })
    set((s) => ({ projects: s.projects.map((p) => (p.id === meta.id ? meta : p)) }))
  },

  async loadSessions() {
    const projectId = get().projectId
    if (projectId === null) return
    const sessions = await api.invoke('sessions:list', { projectId })
    // The user may have switched project while the list was loading.
    if (get().projectId !== projectId) return
    set((s) => ({ sessions, sessionId: s.sessionId !== null && sessions.some((x) => x.id === s.sessionId) ? s.sessionId : null }))
  },

  async newSession() {
    const projectId = get().projectId
    if (projectId === null) return
    const created = await api.invoke('sessions:create', { projectId })
    if (get().projectId !== projectId) return
    set((s) => ({ sessions: [created, ...s.sessions.filter((x) => x.id !== created.id)], sessionId: created.id }))
  },

  selectSession(id) {
    set({ sessionId: id })
  },

  async renameSession(id, title) {
    const projectId = get().projectId
    if (projectId === null) return
    await api.invoke('sessions:rename', { projectId, sessionId: id, title })
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, title } : x)) }))
  },

  async bookmarkSession(id, bookmarked) {
    const projectId = get().projectId
    if (projectId === null) return
    await api.invoke('sessions:bookmark', { projectId, sessionId: id, bookmarked })
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, bookmarked } : x)) }))
  },

  async deleteSession(id) {
    const projectId = get().projectId
    if (projectId === null) return
    await api.invoke('sessions:delete', { projectId, sessionId: id })
    set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id), sessionId: s.sessionId === id ? null : s.sessionId }))
  },

  selectPanel(id) {
    set({ selectedPanelId: id, selectedPanelIds: id === null ? [] : [id], shiftSelecting: false })
  },

  togglePanelSelection(id) {
    set((s) => {
      // A selection made by a plain click or by the agent's thumbnail may not be in the list yet.
      const base = s.selectedPanelIds.length === 0 && s.selectedPanelId !== null ? [s.selectedPanelId] : s.selectedPanelIds
      const ids = base.includes(id) ? base.filter((x) => x !== id) : [...base, id]
      return { selectedPanelIds: ids, selectedPanelId: ids.at(-1) ?? null, shiftSelecting: true }
    })
  },

  focusPanel(id) {
    if (id === null) set({ focusedPanelId: null })
    else set({ focusedPanelId: id, selectedPanelId: id, selectedPanelIds: [id], shiftSelecting: false })
  },

  setStudioTab(tab) {
    set({ studioTab: tab })
  }
}))

/**
 * Tells main which project and episode the window shows (`app:setActiveContext`): once now, then whenever either
 * changes, so plugins that act on "the open project" follow the user. Returns the unsubscribe function.
 */
export function startActiveContextSync(): () => void {
  const send = ({ projectId, activeEpisodeId }: AppData): void => {
    api
      .invoke('app:setActiveContext', { projectId, episodeId: activeEpisodeId })
      .catch((e: unknown) => console.error('Failed to tell main the active project', e))
  }
  send(useAppStore.getState())
  return useAppStore.subscribe((s, prev) => {
    if (s.projectId !== prev.projectId || s.activeEpisodeId !== prev.activeEpisodeId) send(s)
  })
}
