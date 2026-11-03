import { Sparkles } from 'lucide-react'
import { continueStoryPrompt } from '@shared/prompts'
import { useAppStore } from '../../stores/app-store'
import { sendUserMessage } from './send-message'

/** AI-led mode only: asks the agent to plan the next beats and draw the project's autopilot number of panels. */
export function ContinueStoryButton() {
  const meta = useAppStore((s) => s.projects.find((p) => p.id === s.projectId))
  const sessionId = useAppStore((s) => s.sessionId)
  const running = useAppStore((s) => s.sessionId !== null && s.runningThreads[s.sessionId] !== undefined)
  // A session Claude Code drives over MCP is read-only, as its composer is.
  const driven = useAppStore((s) => s.sessions.find((x) => x.id === s.sessionId)?.driver === 'claude-code')
  if (meta === undefined || meta.storyMode !== 'ai') return null
  return (
    <button
      type="button"
      className="btn-primary"
      data-testid="continue-story"
      disabled={sessionId === null || running || driven}
      onClick={() => sendUserMessage(continueStoryPrompt(meta.autopilotPanels), [])}
    >
      <Sparkles size={15} aria-hidden="true" />
      Continue story
    </button>
  )
}
