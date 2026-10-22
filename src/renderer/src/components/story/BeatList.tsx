import { useState } from 'react'
import type { Beat } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { usePanelsStore } from '../../stores/panels-store'
import { useStoryStore } from '../../stores/story-store'

const STATUSES: Beat['status'][] = ['planned', 'drawn', 'dropped']

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** The beats of the episode open in the Webtoon tab, each with a status chip the user can change. */
export function BeatList() {
  const activeEpisodeId = useAppStore((s) => s.activeEpisodeId)
  const episodeTitle = usePanelsStore((s) => s.episodes.find((e) => e.id === activeEpisodeId)?.title)
  const beats = useStoryStore((s) => s.beats)
  const updateBeat = useStoryStore((s) => s.updateBeat)
  const [error, setError] = useState<string | null>(null)

  function setStatus(beat: Beat, status: Beat['status']): void {
    setError(null)
    updateBeat(beat.id, { status }).catch((e: unknown) => setError(errorText(e)))
  }

  const shown = activeEpisodeId === null ? [] : beats.filter((b) => b.episodeId === activeEpisodeId)
  return (
    <section className="beat-list-section">
      <h3>Beats{episodeTitle !== undefined && <span className="beat-episode"> · {episodeTitle}</span>}</h3>
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {activeEpisodeId === null ? (
        <p className="placeholder">Open an episode in the Webtoon tab to see its beats.</p>
      ) : shown.length === 0 ? (
        <p className="placeholder">No beats planned for this episode yet.</p>
      ) : (
        <ol className="beat-list">
          {shown.map((beat) => (
            <li key={beat.id} data-testid="beat-item">
              <select
                className={`chip chip-${beat.status}`}
                data-testid="beat-status"
                aria-label={`Status of beat: ${beat.summary}`}
                value={beat.status}
                onChange={(e) => setStatus(beat, e.target.value as Beat['status'])}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <span className="beat-summary">{beat.summary}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
