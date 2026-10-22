import { create } from 'zustand'
import type { Beat, BeatPatch, StoryMode } from '@shared/types'
import { api } from '../api'
import { useAppStore } from './app-store'

export interface StoryData {
  /** The project `bible` and `beats` belong to. */
  projectId: string | null
  mode: StoryMode
  /** The bible markdown as stored. The editor keeps its own unsaved copy. */
  bible: string
  /** Every beat of the project, in the order they were added; the beat list shows the active episode's. */
  beats: Beat[]
  loaded: boolean
  /** The last load failure; cleared by the next successful load. */
  error: string | null
}

export interface StoryActions {
  /** Never rejects: a failure lands in `error` and leaves the previous story in place. */
  load(): Promise<void>
  /** Replaces the whole bible and reloads. Rejects when main refuses. */
  saveBible(markdown: string): Promise<void>
  /** Changes one beat and reloads. Rejects when main refuses. */
  updateBeat(beatId: string, patch: BeatPatch): Promise<void>
}

export const initialStoryState: StoryData = { projectId: null, mode: 'user', bible: '', beats: [], loaded: false, error: null }

/** Only the response to the latest `load` is applied: several events can arrive close together. */
let latestLoad = 0

function requireProject(): string {
  const projectId = useAppStore.getState().projectId
  if (projectId === null) throw new Error('No project is open')
  return projectId
}

export const useStoryStore = create<StoryData & StoryActions>()((set, get) => ({
  ...initialStoryState,

  async load() {
    const projectId = useAppStore.getState().projectId
    const seq = ++latestLoad
    if (projectId === null) {
      set({ ...initialStoryState })
      return
    }
    // Another project's story must not show while this one loads.
    if (get().projectId !== projectId) set({ ...initialStoryState, projectId })
    const current = (): boolean => seq === latestLoad && useAppStore.getState().projectId === projectId
    try {
      const story = await api.invoke('story:get', { projectId })
      if (current()) set({ ...story, loaded: true, error: null })
    } catch (e) {
      if (current()) set({ error: e instanceof Error ? e.message : String(e) })
    }
  },

  async saveBible(markdown) {
    await api.invoke('story:updateBible', { projectId: requireProject(), markdown })
    // What was saved is the bible now, even if the reload below fails.
    set({ bible: markdown })
    await get().load()
  },

  async updateBeat(beatId, patch) {
    await api.invoke('story:updateBeat', { projectId: requireProject(), beatId, patch })
    await get().load()
  }
}))
