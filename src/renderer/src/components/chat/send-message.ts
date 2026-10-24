import { newId } from '@shared/ids'
import { api } from '../../api'
import { useAppStore } from '../../stores/app-store'
import { useChatStore } from '../../stores/chat-store'

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Sends `text` to the selected session's agent: the one path the composer and the Continue story button share.
 * Does nothing without an open project and session. A rejected send is reported as a notice in the thread.
 */
export function sendUserMessage(text: string, imagePaths: string[]): void {
  const { projectId, sessionId, activeEpisodeId } = useAppStore.getState()
  if (projectId === null || sessionId === null) return
  const chat = useChatStore.getState()
  chat.clearNotices(sessionId)
  // The runner persists the user message but does not emit it, so show it here. The transcript replaces it on the next load.
  const optimisticId = newId('msg')
  chat.addMessage(sessionId, { id: optimisticId, role: 'user', text, imagePaths, stateSnapshot: null, createdAt: new Date().toISOString() })
  api.invoke('agent:send', { projectId, sessionId, text, imagePaths, activeEpisodeId }).catch((e: unknown) => {
    // Nothing was sent, so the optimistic message must not stay in the thread.
    useChatStore.getState().removeMessage(sessionId, optimisticId)
    useChatStore.getState().addNotice(sessionId, errorText(e))
  })
}
