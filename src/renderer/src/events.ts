import type { AppEvent } from '@shared/types'
import { api } from './api'
import { useAppStore } from './stores/app-store'
import { useChatStore } from './stores/chat-store'
import { useModelsStore } from './stores/models-store'

function handleEvent(event: AppEvent): void {
  const state = useAppStore.getState()
  switch (event.type) {
    case 'session.changed':
      if (event.projectId === state.projectId) void state.loadSessions()
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
