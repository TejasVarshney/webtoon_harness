import type { AppEvent } from '@shared/types'
import { api } from './api'
import { useAppStore } from './stores/app-store'

function handleEvent(event: AppEvent): void {
  const state = useAppStore.getState()
  switch (event.type) {
    case 'session.changed':
      if (event.projectId === state.projectId) void state.loadSessions()
      break
    default:
      break
  }
}

/** Subscribes the store to main-process events. Returns the unsubscribe function. Later tasks add cases. */
export function startEventSync(): () => void {
  return api.onEvent(handleEvent)
}
