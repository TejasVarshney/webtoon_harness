import { useAppStore } from '../../stores/app-store'
import { FileMenu } from '../layout/FileMenu'
import { ProjectProblems } from '../sessions/ProjectProblems'
import { StyleButton } from '../styles/StyleButton'
import { ContinueStoryButton } from './ContinueStoryButton'

export const MOCK_BANNER_TEXT = "You're using the offline mock model. Add a real endpoint in Settings → Models."

/** The top bar: the File menu, the open project, and what shapes the story (style, continue). */
export function ChatHeader() {
  const projectTitle = useAppStore((s) => s.projects.find((p) => p.id === s.projectId)?.title)

  return (
    <div className="chat-header">
      <FileMenu />
      <h1 className="project-title">{projectTitle ?? 'No project open'}</h1>
      <ProjectProblems />
      <div className="chat-header-actions">
        <StyleButton />
        <ContinueStoryButton />
      </div>
    </div>
  )
}
