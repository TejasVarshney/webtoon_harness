import { useEffect } from 'react'
import { newId } from '@shared/ids'
import { api, cleanIpcError } from '../../api'
import { useAppStore } from '../../stores/app-store'
import { useChatStore } from '../../stores/chat-store'
import { Composer } from '../chat/Composer'
import { MessageList } from '../chat/MessageList'

export interface PanelThreadProps {
  projectId: string
  panelId: string
}

/** The panel's persisted thread (`panel:<id>`) and its composer. */
export function PanelThread({ projectId, panelId }: PanelThreadProps) {
  const threadKey = `panel:${panelId}`
  const runId = useAppStore((s) => s.runningThreads[threadKey])

  useEffect(() => {
    let stale = false
    useChatStore
      .getState()
      .load(threadKey, async () => {
        const loaded = await api.invoke('panelChat:load', { projectId, panelId })
        if (stale) throw new Error('stale')
        return loaded
      })
      .catch((e: unknown) => {
        if (!stale) useChatStore.getState().addNotice(threadKey, cleanIpcError(e).message)
      })
    return () => {
      stale = true
    }
  }, [projectId, panelId, threadKey])

  function send(text: string): void {
    const chat = useChatStore.getState()
    chat.clearNotices(threadKey)
    // The runner persists the user message but does not emit it, so show it here. The transcript replaces it on the next load.
    const optimisticId = newId('msg')
    chat.addMessage(threadKey, { id: optimisticId, role: 'user', text, imagePaths: [], stateSnapshot: null, createdAt: new Date().toISOString() })
    api.invoke('panelChat:send', { projectId, panelId, text }).catch((e: unknown) => {
      // Nothing was sent, so the optimistic message must not stay in the thread.
      useChatStore.getState().removeMessage(threadKey, optimisticId)
      useChatStore.getState().addNotice(threadKey, cleanIpcError(e).message)
    })
  }

  function stop(): void {
    if (runId === undefined) return
    api.invoke('panelChat:cancel', { runId }).catch((e: unknown) => useChatStore.getState().addNotice(threadKey, cleanIpcError(e).message))
  }

  // `panelChat:send` carries text only, so there is nothing to attach images to.
  return (
    <>
      <MessageList threadKey={threadKey} emptyTitle="Ask for a change to this panel." emptyHint="An expression, the light, the framing: each edit becomes a new version you can step back from." />
      <Composer onSend={send} running={runId !== undefined} onStop={stop} allowAttach={false} placeholder="Describe the change to this panel." />
    </>
  )
}
