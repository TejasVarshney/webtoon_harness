import { useEffect } from 'react'
import { ChatHeader } from './components/chat/ChatHeader'
import { ChatPane } from './components/chat/ChatPane'
import { GeneratePage } from './components/generate/GeneratePage'
import { HomePage } from './components/home/HomePage'
import { MenuDialogs } from './components/layout/MenuDialogs'
import { StudioPane } from './components/layout/StudioPane'
import { WorkspaceLayout } from './components/layout/WorkspaceLayout'
import { PanelWorkspace } from './components/panel-editor/PanelWorkspace'
import { startEventSync } from './events'
import { startActiveContextSync, useAppStore } from './stores/app-store'
import { useGenerateStore } from './stores/generate-store'
import { startMenuSync } from './stores/menu-store'
import { useModelsStore } from './stores/models-store'
import { usePluginsStore } from './stores/plugins-store'

export function App() {
  const focusedPanelId = useAppStore((s) => s.focusedPanelId)
  const projectId = useAppStore((s) => s.projectId)
  const generating = useGenerateStore((s) => s.request !== null)

  useEffect(() => {
    const stopEvents = startEventSync()
    const stopContext = startActiveContextSync()
    const stopMenu = startMenuSync()
    void useAppStore.getState().loadProjects()
    void useModelsStore.getState().load().catch((e: unknown) => console.error('Failed to load models', e))
    // The model picker needs to know whether Claude Code runs the chat, before Settings is ever opened.
    void usePluginsStore.getState().load().catch((e: unknown) => console.error('Failed to load plugins', e))
    return () => {
      stopEvents()
      stopContext()
      stopMenu()
    }
  }, [])

  // A page left open must not carry over to the next project.
  useEffect(() => {
    useGenerateStore.getState().close()
  }, [projectId])

  return (
    <>
      {projectId === null ? (
        <HomePage />
      ) : generating ? (
        // The page stands in for the workspace, so the chat is not mounted while it is open.
        <GeneratePage />
      ) : (
        <WorkspaceLayout
          header={<ChatHeader />}
          left={<StudioPane />}
          right={<ChatPane />}
          overlay={focusedPanelId === null ? undefined : <PanelWorkspace panelId={focusedPanelId} />}
        />
      )}
      {/* The window's File menu works on every screen, so what it opens is mounted above them all. */}
      <MenuDialogs />
    </>
  )
}
