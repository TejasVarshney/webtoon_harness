import type { Panel, PanelPlacement } from '@shared/types'
import { clampPlacement, readingOrder, resolveStrip } from '@shared/strip-canvas'
import { EntityNotFoundError } from './errors'

/**
 * What saving `moves` has to write. The strip is resolved first and every panel whose resolved box differs from its
 * stored placement is frozen at that box (not only the unplaced ones, so a panel the flow pushed down stays where it
 * was drawn), then the moves are stored on top, clamped. `order` is the episode's panel ids in reading order after that.
 */
export function planPlacement(
  panels: Panel[],
  moves: { panelId: string; placement: PanelPlacement }[]
): { writes: { panelId: string; placement: PanelPlacement }[]; order: string[] } {
  const target = new Map<string, PanelPlacement>()
  for (const r of resolveStrip(panels)) target.set(r.panel.id, { x: r.x, y: r.y, width: r.width })
  for (const move of moves) {
    const panel = panels.find((p) => p.id === move.panelId)
    // `panels` are the episode's readable panels, so this also refuses a panel of another episode.
    if (!panel) throw new EntityNotFoundError('panel', move.panelId)
    target.set(move.panelId, clampPlacement(move.placement, panel.aspect))
  }
  const writes: { panelId: string; placement: PanelPlacement }[] = []
  const placed = panels.map((panel) => {
    const placement = target.get(panel.id) as PanelPlacement
    const kept = panel.placement
    if (!kept || kept.x !== placement.x || kept.y !== placement.y || kept.width !== placement.width) writes.push({ panelId: panel.id, placement })
    return { ...panel, placement }
  })
  return { writes, order: readingOrder(resolveStrip(placed)) }
}
