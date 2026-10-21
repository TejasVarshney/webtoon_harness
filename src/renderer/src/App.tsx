import { useEffect } from 'react'
import { ThreePaneLayout } from './components/layout/ThreePaneLayout'
import { SessionSidebar } from './components/sessions/SessionSidebar'
import { startEventSync } from './events'
import { useAppStore } from './stores/app-store'

export function App() {
  useEffect(() => {
    const stop = startEventSync()
    void useAppStore.getState().loadProjects()
    return stop
  }, [])

  return (
    <ThreePaneLayout
      left={<SessionSidebar />}
      middle={<p className="placeholder">Chat</p>}
      right={<p className="placeholder">Webtoon panels</p>}
    />
  )
}
