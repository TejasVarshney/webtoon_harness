import { useEffect } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { api } from '../../api'
import { useAppStore } from '../../stores/app-store'
import { useChatStore } from '../../stores/chat-store'
import { useModelsStore } from '../../stores/models-store'
import { MOCK_BANNER_TEXT } from './ChatHeader'
import { Composer } from './Composer'
import { MessageList } from './MessageList'
import { ModelPicker } from './ModelPicker'
import { sendUserMessage } from './send-message'
import { PanelSideChat } from '../panel-chat/PanelSideChat'

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** The main chat for the selected session. */
export function ChatPane() {
  const projectId = useAppStore((s) => s.projectId)
  const sessionId = useAppStore((s) => s.sessionId)
  const runId = useAppStore((s) => (s.sessionId === null ? undefined : s.runningThreads[s.sessionId]))
  const selectedPanelId = useAppStore((s) => s.selectedPanelId)
  const draft = useChatStore((s) => s.draft)
  const setDraft = useChatStore((s) => s.setDraft)
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
      {onMock && (
        <p className="mock-banner" data-testid="mock-banner">
          {MOCK_BANNER_TEXT}
        </p>
      )}
      {/* The main chat's panel is always there, so opening the side chat below it never remounts the main chat. */}
      <Group orientation="vertical" className="chat-split">
        <Panel id="chat-main" defaultSize="55%" minSize="25%">
          <div className="main-chat">
            {sessionId === null ? (
              <div className="chat-empty">
                <p className="placeholder">{projectId === null ? 'Create a project to start.' : 'Select or create a session to chat.'}</p>
              </div>
            ) : (
              <>
                <MessageList threadKey={sessionId} />
                <Composer onSend={sendUserMessage} running={runId !== undefined} onStop={stop} value={draft} onValueChange={setDraft} tools={<ModelPicker />} />
              </>
            )}
          </div>
        </Panel>
        {selectedPanelId !== null && (
          <>
            <Separator className="pane-separator pane-separator-row" />
            <Panel id="chat-side" defaultSize="45%" minSize="20%">
              {/* Keyed so each panel starts with its own composer text and thread. */}
              <PanelSideChat key={selectedPanelId} panelId={selectedPanelId} />
            </Panel>
          </>
        )}
      </Group>
    </div>
  )
}
