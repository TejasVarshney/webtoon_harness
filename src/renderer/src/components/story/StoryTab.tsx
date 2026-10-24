import { useEffect } from 'react'
import { useAppStore } from '../../stores/app-store'
import { useStoryStore } from '../../stores/story-store'
import { BeatList } from './BeatList'
import { BibleEditor } from './BibleEditor'

/** The Story tab: the editable story bible and the beats of the active episode. */
export function StoryTab() {
  const projectId = useAppStore((s) => s.projectId)
  const ready = useStoryStore((s) => s.loaded && s.projectId === projectId)
  const error = useStoryStore((s) => s.error)

  // Opening the tab reads the story; `story.changed` keeps it fresh after that (events.ts).
  useEffect(() => {
    void useStoryStore.getState().load()
  }, [projectId])

  if (projectId === null) return <p className="placeholder">Create a project to start.</p>
  return (
    <div className="story-tab" data-testid="story-tab">
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {ready ? (
        <>
          {/* Keyed so another project starts from its own text. */}
          <BibleEditor key={projectId} />
          <BeatList />
        </>
      ) : (
        error === null && <p className="placeholder">Loading the story…</p>
      )}
    </div>
  )
}
