import { create } from 'zustand'
import type { ProjectMeta, ProjectProblem, SessionSummary, StoryMode } from '@shared/types'
import { api } from '../api'

export type RightTab = 'webtoon' | 'characters' | 'story'

const LAST_PROJECT_KEY = 'webtoon.lastProjectId'

function readLastProject(): string | null {
  try {
    return localStorage.getItem(LAST_PROJECT_KEY)
  } catch {
    return null
  }
}

function writeLastProject(id: string): void {
  try {
    localStorage.setItem(LAST_PROJECT_KEY, id)
  } catch {
    // Storage can be unavailable; remembering the last project is only a convenience.
  }
}

export interface AppData {
  projects: ProjectMeta[]
  projectId: string | null
  problems: ProjectProblem[]
  sessions: SessionSummary[]
  sessionId: string | null
  selectedPanelId: string | null
  activeEpisodeId: string | null
  rightTab: RightTab
  /** Thread key (a session id, or `panel:<panelId>`) to the id of its running agent run. */
  runningThreads: Record<string, string>
}

export interface AppActions {
  loadProjects(): Promise<void>
  createProject(title: string): Promise<void>
  openProject(id: string): Promise<void>
  /** Re-reads the open project's meta and problems (what `project.changed` calls). Leaves the sessions and the selection alone. */
  refreshMeta(): Promise<void>
  /** Saves the story mode and shows it at once from the meta main returns. Rejects when main refuses. */
  setStoryMode(mode: StoryMode): Promise<void>
  loadSessions(): Promise<void>
  newSession(): Promise<void>
  selectSession(id: string | null): void
  renameSession(id: string, title: string): Promise<void>
  deleteSession(id: string): Promise<void>
  selectPanel(id: string | null): void
  setRightTab(tab: RightTab): void
}

export const initialAppState: AppData = {
  projects: [],
  projectId: null,
  problems: [],
  sessions: [],
  sessionId: null,
  selectedPanelId: null,
  activeEpisodeId: null,
  rightTab: 'webtoon',
  runningThreads: {}
}

export const useAppStore = create<AppData & AppActions>()((set, get) => ({
  ...initialAppState,

  async loadProjects() {
    const { projects, problems } = await api.invoke('projects:list', {})
    set({ projects, problems })
    if (get().projectId === null && projects.length > 0) {
      const last = readLastProject()
      await get().openProject(projects.find((p) => p.id === last)?.id ?? projects[0].id)
    }
  },

  async createProject(title) {
    const meta = await api.invoke('projects:create', { title })
    set((s) => ({ projects: [meta, ...s.projects.filter((p) => p.id !== meta.id)] }))
    await get().openProject(meta.id)
  },

  async openProject(id) {
    const { meta, problems } = await api.invoke('projects:open', { projectId: id })
    writeLastProject(meta.id)
    set((s) => ({
      projects: s.projects.some((p) => p.id === meta.id) ? s.projects.map((p) => (p.id === meta.id ? meta : p)) : [meta, ...s.projects],
      projectId: meta.id,
      problems,
      sessions: [],
      sessionId: null,
      selectedPanelId: null,
      activeEpisodeId: null
    }))
    await get().loadSessions()
  },

  async refreshMeta() {
    const projectId = get().projectId
    if (projectId === null) return
    const { meta, problems } = await api.invoke('projects:open', { projectId })
    // The user may have switched project while this was loading.
    if (get().projectId !== projectId) return
    set((s) => ({ projects: s.projects.map((p) => (p.id === meta.id ? meta : p)), problems }))
  },

  async setStoryMode(mode) {
    const projectId = get().projectId
    if (projectId === null) return
    const meta = await api.invoke('story:setMode', { projectId, mode })
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

  async deleteSession(id) {
    const projectId = get().projectId
    if (projectId === null) return
    await api.invoke('sessions:delete', { projectId, sessionId: id })
    set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id), sessionId: s.sessionId === id ? null : s.sessionId }))
  },

  selectPanel(id) {
    set({ selectedPanelId: id })
  },

  setRightTab(tab) {
    set({ rightTab: tab })
  }
}))
