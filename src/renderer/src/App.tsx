import { useEffect } from 'react'
import { ChatHeader } from './components/chat/ChatHeader'
import { ChatPane } from './components/chat/ChatPane'
import { RightPane } from './components/layout/RightPane'
import { ThreePaneLayout } from './components/layout/ThreePaneLayout'
import { SessionSidebar } from './components/sessions/SessionSidebar'
import { startEventSync } from './events'
import { startActiveContextSync, useAppStore } from './stores/app-store'
import { useModelsStore } from './stores/models-store'
import { usePluginsStore } from './stores/plugins-store'

export function App() {
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

  return (
    <ThreePaneLayout
      header={<ChatHeader />}
      left={<SessionSidebar />}
      middle={<ChatPane />}
      right={<RightPane />}
    />
  )
}
