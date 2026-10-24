import { continueStoryPrompt } from '@shared/prompts'
import { useAppStore } from '../../stores/app-store'
import { sendUserMessage } from './send-message'

/** AI-led mode only: asks the agent to plan the next beats and draw the project's autopilot number of panels. */
export function ContinueStoryButton() {
  const meta = useAppStore((s) => s.projects.find((p) => p.id === s.projectId))
  const sessionId = useAppStore((s) => s.sessionId)
  const running = useAppStore((s) => s.sessionId !== null && s.runningThreads[s.sessionId] !== undefined)
  if (meta === undefined || meta.storyMode !== 'ai') return null
  return (
    <button type="button" data-testid="continue-story" disabled={sessionId === null || running} onClick={() => sendUserMessage(continueStoryPrompt(meta.autopilotPanels), [])}>
      Continue story
    </button>
  )
}
