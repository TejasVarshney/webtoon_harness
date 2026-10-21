import { useEffect } from 'react'
import { api } from '../../api'
import { useAppStore } from '../../stores/app-store'
import { useChatStore } from '../../stores/chat-store'
import { ChatHeader } from './ChatHeader'
import { Composer } from './Composer'
import { MessageList } from './MessageList'
import { newId } from '@shared/ids'

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** The main chat for the selected session. */
export function ChatPane() {
  const projectId = useAppStore((s) => s.projectId)
  const sessionId = useAppStore((s) => s.sessionId)
  const runId = useAppStore((s) => (s.sessionId === null ? undefined : s.runningThreads[s.sessionId]))

  useEffect(() => {
    if (projectId === null || sessionId === null) return
    let stale = false
    useChatStore
      .getState()
      .load(sessionId, async () => {
        const loaded = await api.invoke('sessions:load', { projectId, sessionId })
        if (stale) throw new Error('stale')
        return loaded
      })
      .catch((e: unknown) => {
        if (!stale) useChatStore.getState().addNotice(sessionId, errorText(e))
      })
    return () => {
      stale = true
    }
  }, [projectId, sessionId])

  function send(text: string, imagePaths: string[]): void {
    if (projectId === null || sessionId === null) return
    const chat = useChatStore.getState()
    chat.clearNotices(sessionId)
    // The runner persists the user message but does not emit it, so show it here. The transcript replaces it on the next load.
    const optimisticId = newId('msg')
    chat.addMessage(sessionId, { id: optimisticId, role: 'user', text, imagePaths, stateSnapshot: null, createdAt: new Date().toISOString() })
    const activeEpisodeId = useAppStore.getState().activeEpisodeId
    api.invoke('agent:send', { projectId, sessionId, text, imagePaths, activeEpisodeId }).catch((e: unknown) => {
      // Nothing was sent, so the optimistic message must not stay in the thread.
      useChatStore.getState().removeMessage(sessionId, optimisticId)
      useChatStore.getState().addNotice(sessionId, errorText(e))
    })
  }

  function stop(): void {
    if (sessionId === null || runId === undefined) return
    api.invoke('agent:cancel', { runId }).catch((e: unknown) => useChatStore.getState().addNotice(sessionId, errorText(e)))
  }

  return (
    <div className="chat-pane">
      <ChatHeader />
      {sessionId === null ? (
        <p className="placeholder">{projectId === null ? 'Create a project to start.' : 'Select or create a session to chat.'}</p>
      ) : (
        <>
          <MessageList threadKey={sessionId} />
          <Composer onSend={send} running={runId !== undefined} onStop={stop} />
        </>
      )}
    </div>
  )
}
