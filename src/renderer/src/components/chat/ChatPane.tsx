import { useEffect } from 'react'
import { api } from '../../api'
import { useAppStore } from '../../stores/app-store'
import { useChatStore } from '../../stores/chat-store'
import { useModelsStore } from '../../stores/models-store'
import { claudeCodeIsAgent, usePluginsStore } from '../../stores/plugins-store'
import { MOCK_BANNER_TEXT } from './ChatHeader'
import { Composer } from './Composer'
import { MessageList } from './MessageList'
import { ModelPicker } from './ModelPicker'
import { sendUserMessage } from './send-message'

/** Shown above a session that Claude Code drives. */
const DRIVER_BANNER_TEXT = 'Driven by Claude Code'
/** The Attach tooltip while Claude Code runs the chat: its runs refuse images (ruling R16). */
const NO_IMAGES_TEXT = "Claude Code can't see attached images yet"

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** The main chat for the selected session. */
export function ChatPane() {
  const projectId = useAppStore((s) => s.projectId)
  const sessionId = useAppStore((s) => s.sessionId)
  const runId = useAppStore((s) => (s.sessionId === null ? undefined : s.runningThreads[s.sessionId]))
  // Claude Code writes this session's steps through the MCP link, so the app's own agent has nothing to say in it.
  const driven = useAppStore((s) => s.sessions.find((x) => x.id === s.sessionId)?.driver === 'claude-code')
  const draft = useChatStore((s) => s.draft)
  const setDraft = useChatStore((s) => s.setDraft)
  const claudeCodeAgent = usePluginsStore(claudeCodeIsAgent)
  const onMock = useModelsStore((s) => {
    const model = s.view?.models.find((m) => m.id === s.view?.effectiveRoles.agent)
    return s.view?.endpoints.find((e) => e.id === model?.endpointId)?.kind === 'mock'
  })

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

  function stop(): void {
    if (sessionId === null || runId === undefined) return
    api.invoke('agent:cancel', { runId }).catch((e: unknown) => useChatStore.getState().addNotice(sessionId, errorText(e)))
  }

  return (
    <div className="chat-pane">
      {onMock && !claudeCodeAgent && (
        <p className="mock-banner" data-testid="mock-banner">
          {MOCK_BANNER_TEXT}
        </p>
      )}
      <div className="main-chat">
        {sessionId === null ? (
          <div className="chat-empty">
            <p className="placeholder">{projectId === null ? 'Create a project to start.' : 'Select or create a session to chat.'}</p>
          </div>
        ) : (
          <>
            {driven && (
              <p className="driver-banner" data-testid="driver-banner">
                {DRIVER_BANNER_TEXT}
              </p>
            )}
            <MessageList threadKey={sessionId} />
            <Composer
              onSend={sendUserMessage}
              running={runId !== undefined}
              onStop={stop}
              value={draft}
              onValueChange={setDraft}
              {...(claudeCodeAgent ? { attachOffReason: NO_IMAGES_TEXT } : {})}
              tools={driven ? undefined : <ModelPicker />}
              disabled={driven}
            />
          </>
        )}
      </div>
    </div>
  )
}
