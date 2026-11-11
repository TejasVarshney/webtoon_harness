import { useAppStore } from '../../stores/app-store'
import { useGenerateStore } from '../../stores/generate-store'
import { usePanelsStore } from '../../stores/panels-store'

/**
 * Shown while panels are selected with shift: what they can be used for. Only panels with a ready image are
 * references, so a selection of blank panels says so instead of offering to generate from them. Generate opens the
 * Generate page with those panels, in strip order.
 */
export function SelectionBar() {
  const shiftSelecting = useAppStore((s) => s.shiftSelecting)
  const selectedIds = useAppStore((s) => s.selectedPanelIds)
  const activeEpisodeId = useAppStore((s) => s.activeEpisodeId)
  const panels = usePanelsStore((s) => (activeEpisodeId === null ? undefined : s.panelsByEpisode[activeEpisodeId]))
  if (!shiftSelecting || selectedIds.length === 0) return null

  const ready = (panels ?? []).filter((p) => selectedIds.includes(p.id) && p.versions.some((v) => v.id === p.currentVersionId && v.status === 'ready'))
  return (
    <div className="selection-bar" role="status">
      {ready.length === 0 || activeEpisodeId === null ? (
        'Selected panels have no image yet'
      ) : (
        <button type="button" className="btn-primary" onClick={() => useGenerateStore.getState().open({ episodeId: activeEpisodeId, referencePanelIds: ready.map((p) => p.id) })}>
          {`Generate from ${ready.length} ${ready.length === 1 ? 'panel' : 'panels'}`}
        </button>
      )}
    </div>
  )
}
