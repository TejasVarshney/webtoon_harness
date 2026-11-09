import { useAppStore } from '../../stores/app-store'
import { usePanelsStore } from '../../stores/panels-store'

/**
 * Shown while panels are selected with shift: what they can be used for. Only panels with a ready image are
 * references, so a selection of blank panels says so instead of offering to generate from them.
 */
export function SelectionBar() {
  const shiftSelecting = useAppStore((s) => s.shiftSelecting)
  const selectedIds = useAppStore((s) => s.selectedPanelIds)
  const activeEpisodeId = useAppStore((s) => s.activeEpisodeId)
  const panels = usePanelsStore((s) => (activeEpisodeId === null ? undefined : s.panelsByEpisode[activeEpisodeId]))
  if (!shiftSelecting || selectedIds.length === 0) return null

  const ready = (panels ?? []).filter((p) => selectedIds.includes(p.id) && p.versions.some((v) => v.id === p.currentVersionId && v.status === 'ready')).length
  return (
    <div className="selection-bar" role="status">
      {ready === 0 ? 'Selected panels have no image yet' : `Generate from ${ready} ${ready === 1 ? 'panel' : 'panels'}`}
    </div>
  )
}
