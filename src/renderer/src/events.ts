import type { AppEvent } from '@shared/types'
import { api } from './api'
import { useAppStore } from './stores/app-store'
import { useCharactersStore } from './stores/characters-store'
import { useChatStore } from './stores/chat-store'
import { useModelsStore } from './stores/models-store'
import { usePanelsStore } from './stores/panels-store'
import { useStoryStore } from './stores/story-store'

function handleEvent(event: AppEvent): void {
  const state = useAppStore.getState()
  switch (event.type) {
    case 'session.changed':
      if (event.projectId === state.projectId) void state.loadSessions()
      break
    case 'character.changed':
      // `load` records its own failures, so there is nothing to catch here.
      if (event.projectId === state.projectId) void useCharactersStore.getState().load()
      break
    // The panel list changes under several events (a generation emits a few), so these overlap; `load` keeps the latest.
    // `panel.changed` names no episode, so the open one is reloaded. `loadEpisodes` records its own failures, too.
    case 'panel.changed':
      if (event.projectId === state.projectId) void usePanelsStore.getState().reloadActive()
      break
    case 'episode.changed':
      if (event.projectId === state.projectId) void usePanelsStore.getState().loadEpisodes()
      break
    // The story mode lives in project.json, so the toggle follows `project.changed`; `story.changed` is the bible and the beats.
    case 'project.changed':
      if (event.projectId === state.projectId) state.refreshMeta().catch((e: unknown) => console.error('Failed to refresh the project', e))
      break
    case 'story.changed':
      // `load` records its own failures, so there is nothing to catch here.
      if (event.projectId === state.projectId) void useStoryStore.getState().load()
      break
    case 'models.changed':
      void useModelsStore.getState().load().catch((e: unknown) => console.error('Failed to reload models', e))
      break
    case 'agent.event': {
      const { threadKey, event: e } = event
      useChatStore.getState().applyAgentEvent(threadKey, e)
      if (e.kind === 'run-started') {
        useAppStore.setState((s) => ({ runningThreads: { ...s.runningThreads, [threadKey]: e.runId } }))
      } else if (e.kind === 'run-finished') {
        useAppStore.setState((s) => {
          if (s.runningThreads[threadKey] !== e.runId) return s
          const { [threadKey]: _done, ...rest } = s.runningThreads
          return { runningThreads: rest }
        })
      }
      break
    }
    default:
      break
  }
}

/** Subscribes the store to main-process events. Returns the unsubscribe function. Later tasks add cases. */
export function startEventSync(): () => void {
  return api.onEvent(handleEvent)
}
