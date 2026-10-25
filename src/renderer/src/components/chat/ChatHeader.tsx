import { ChevronRight } from 'lucide-react'
import { useAppStore } from '../../stores/app-store'
import { ContinueStoryButton } from './ContinueStoryButton'
import { StoryModeToggle } from './StoryModeToggle'

export const MOCK_BANNER_TEXT = "You're using the offline mock model. Add a real endpoint in Settings → Models."

/** The top bar: where the user is (project, then session) and who leads the story. */
export function ChatHeader() {
  const projectTitle = useAppStore((s) => s.projects.find((p) => p.id === s.projectId)?.title)
  const sessionTitle = useAppStore((s) => s.sessions.find((x) => x.id === s.sessionId)?.title)

  return (
    <div className="chat-header">
      <nav className="breadcrumb" aria-label="Location">
        {projectTitle !== undefined && <span className="breadcrumb-project">{projectTitle}</span>}
        {projectTitle !== undefined && sessionTitle !== undefined && <ChevronRight size={14} aria-hidden="true" className="breadcrumb-sep" />}
        <h1 className="breadcrumb-current">{sessionTitle ?? (projectTitle === undefined ? 'No project open' : 'No session open')}</h1>
      </nav>
      <div className="chat-header-actions">
        <StoryModeToggle />
        <ContinueStoryButton />
      </div>
    </div>
  )
}
