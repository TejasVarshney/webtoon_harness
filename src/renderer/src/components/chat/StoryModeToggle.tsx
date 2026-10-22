import { useState } from 'react'
import type { StoryMode } from '@shared/types'
import { useAppStore } from '../../stores/app-store'

const MODES: { value: StoryMode; label: string }[] = [
  { value: 'user', label: 'User-led' },
  { value: 'ai', label: 'AI-led' }
]

/** Who leads the story: the user (the agent follows) or the AI (the agent decides, and Continue story appears). */
export function StoryModeToggle() {
  const mode = useAppStore((s) => s.projects.find((p) => p.id === s.projectId)?.storyMode)
  const setStoryMode = useAppStore((s) => s.setStoryMode)
  // The mode being saved, so the select does not jump back to the old one while main answers.
  const [pending, setPending] = useState<StoryMode | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (mode === undefined) return null

  function change(next: StoryMode): void {
    setError(null)
    setPending(next)
    setStoryMode(next)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setPending(null))
  }

  return (
    <span className="story-mode">
      <select data-testid="story-mode-toggle" aria-label="Story mode" value={pending ?? mode} disabled={pending !== null} onChange={(e) => change(e.target.value as StoryMode)}>
        {MODES.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      {error !== null && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </span>
  )
}
