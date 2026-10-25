import { useEffect } from 'react'
import { ChatHeader } from './components/chat/ChatHeader'
import { ChatPane } from './components/chat/ChatPane'
import { RightPane } from './components/layout/RightPane'
import { ThreePaneLayout } from './components/layout/ThreePaneLayout'
import { SessionSidebar } from './components/sessions/SessionSidebar'
import { startEventSync } from './events'
import { useAppStore } from './stores/app-store'
import { useModelsStore } from './stores/models-store'

export function App() {
  useEffect(() => {
    const stop = startEventSync()
    void useAppStore.getState().loadProjects()
    void useModelsStore.getState().load().catch((e: unknown) => console.error('Failed to load models', e))
    return stop
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
