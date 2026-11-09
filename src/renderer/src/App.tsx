import { useEffect } from 'react'
import { ChatHeader } from './components/chat/ChatHeader'
import { ChatPane } from './components/chat/ChatPane'
import { HomePage } from './components/home/HomePage'
import { StudioPane } from './components/layout/StudioPane'
import { WorkspaceLayout } from './components/layout/WorkspaceLayout'
import { PanelWorkspace } from './components/panel-editor/PanelWorkspace'
import { SessionSidebar } from './components/sessions/SessionSidebar'
import { startEventSync } from './events'
import { startActiveContextSync, useAppStore } from './stores/app-store'
import { useModelsStore } from './stores/models-store'
import { usePluginsStore } from './stores/plugins-store'

export function App() {
  const selectedPanelId = useAppStore((s) => s.selectedPanelId)
  const projectId = useAppStore((s) => s.projectId)

  useEffect(() => {
    const stopEvents = startEventSync()
    const stopContext = startActiveContextSync()
    void useAppStore.getState().loadProjects()
    void useModelsStore.getState().load().catch((e: unknown) => console.error('Failed to load models', e))
    // The model picker needs to know whether Claude Code runs the chat, before Settings is ever opened.
    void usePluginsStore.getState().load().catch((e: unknown) => console.error('Failed to load plugins', e))
    return () => {
      stopEvents()
      stopContext()
    }
  }, [])

  if (projectId === null) return <HomePage />

  return (
    <WorkspaceLayout
      header={<ChatHeader />}
      left={<StudioPane />}
      // The sessions sit above the chat until they get a place of their own.
      right={
        <div className="chat-column">
          <SessionSidebar />
          <ChatPane />
        </div>
      }
      overlay={selectedPanelId === null ? undefined : <PanelWorkspace panelId={selectedPanelId} />}
    />
  )
}
