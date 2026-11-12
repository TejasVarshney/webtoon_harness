import { useEffect } from 'react'
import { useAppStore } from '../../stores/app-store'
import { useCharactersStore } from '../../stores/characters-store'
import { usePanelsStore } from '../../stores/panels-store'
import { EpisodeBar } from './EpisodeBar'
import { SelectionBar } from './SelectionBar'
import { StripCanvas } from './StripCanvas'
import { useStripUndoKeys } from './use-strip-undo-keys'

/** The Webtoon tab: an episode picker above the strip of the open episode's panels, and the bar for a shift selection. */
export function WebtoonPane() {
  const projectId = useAppStore((s) => s.projectId)
  const activeEpisodeId = useAppStore((s) => s.activeEpisodeId)
  // Panels of another project must never show under this one, whatever the store still holds.
  const storeProjectId = usePanelsStore((s) => s.projectId)
  const panels = usePanelsStore((s) => (activeEpisodeId === null ? undefined : s.panelsByEpisode[activeEpisodeId]))
  const error = usePanelsStore((s) => s.error)
  useStripUndoKeys(projectId === null ? null : activeEpisodeId)

  useEffect(() => {
    if (projectId === null) return
    // Both record their own failures. The roster names dialogue speakers and fills the editor's cast picker.
    void usePanelsStore.getState().loadEpisodes()
    void useCharactersStore.getState().load()
  }, [projectId])

  if (projectId === null) return <p className="placeholder">Create a project to see its panels.</p>

  const ready = storeProjectId === projectId && activeEpisodeId !== null && panels !== undefined
  return (
    <div className="webtoon-pane">
      <EpisodeBar />
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {ready ? <StripCanvas episodeId={activeEpisodeId} panels={panels} /> : error === null && <p className="placeholder">Loading panels…</p>}
      <SelectionBar />
    </div>
  )
}
