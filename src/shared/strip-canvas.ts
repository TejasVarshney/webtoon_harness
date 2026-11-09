// Where every panel sits on the strip, in strip px. Pure: this is the one source of panel positions for the screen and
// the export. A panel with no placement flows as the rows of `layoutStrip` always did; a placed panel holds its spot.

import type { Panel, PanelAspect, PanelGap, PanelPlacement } from '@shared/types'
import { aspectRatio, layoutStrip, rowShares } from '@shared/strip-layout'
import { STRIP_CSS_WIDTH } from '@shared/strip-width'

/** The narrowest a panel can be made. */
const MIN_PANEL_WIDTH = 80

/** The gap between the panels of one row. */
const ROW_GAP = 6

/** The gap below a flowing row, by its `gapAfter`. */
const GAP_PX: Record<PanelGap, number> = { tight: 8, normal: 48, long: 120 }

export interface PlacedPanel {
  panel: Panel
  x: number
  y: number
  width: number
  height: number
  /** The width over the strip's width. */
  share: number
  /** Which way a slanted panel leans; tall panels fade instead, so they have none. */
  slant?: 'left' | 'right'
}

/** A panel's height at `width`. */
export function panelHeight(width: number, aspect: PanelAspect): number {
  return width / aspectRatio(aspect)
}

/**
 * Every panel's box, in the order of `panels`. A placed panel holds its spot and never shares a row. Each run of
 * consecutive unplaced panels flows as rows of its own (`beside` only joins panels of the same run), starting below
 * everything above it plus the gap of the panel before it. Placed panels after a run move down together by one shift,
 * enough that the highest of them clears the run and its gap, and never less than the run's own height, so a panel
 * inserted into the flow never lands on top of one placed below it. Slants are numbered over the whole list.
 */
export function resolveStrip(panels: Panel[]): PlacedPanel[] {
  const slants: Record<string, 'left' | 'right'> = {}
  for (const row of layoutStrip(panels)) Object.assign(slants, row.slants)

  const out: PlacedPanel[] = []
  let lowest = 0
  let previousGap = 0
  let shift = 0
  const box = (panel: Panel, x: number, y: number, width: number): PlacedPanel => {
    const height = panelHeight(width, panel.aspect)
    lowest = Math.max(lowest, y + height)
    return { panel, x, y, width, height, share: width / STRIP_CSS_WIDTH, slant: slants[panel.id] }
  }

  let i = 0
  while (i < panels.length) {
    const first = panels[i]
    if (first.placement) {
      out.push(box(first, first.placement.x, first.placement.y + shift, first.placement.width))
      previousGap = GAP_PX[first.gapAfter]
      i += 1
      continue
    }
    let end = i
    while (end < panels.length && !panels[end].placement) end += 1
    let cursor = lowest + previousGap
    let height = 0
    let gap = previousGap
    for (const row of layoutStrip(panels.slice(i, end))) {
      const available = STRIP_CSS_WIDTH - ROW_GAP * (row.panels.length - 1)
      const shares = rowShares(row.panels)
      let x = 0
      let rowHeight = 0
      for (const panel of row.panels) {
        const placed = box(panel, x, cursor, shares[panel.id] * available)
        out.push(placed)
        rowHeight = placed.height
        x += placed.width + ROW_GAP
      }
      gap = GAP_PX[row.gapAfter]
      height += rowHeight + gap
      cursor += rowHeight + gap
    }
    const later = panels.slice(end).filter((p) => p.placement)
    if (later.length > 0) {
      const minY = Math.min(...later.map((p) => (p.placement as PanelPlacement).y))
      shift = Math.max(shift + height, cursor - minY)
    }
    previousGap = gap
    i = end
  }
  return out
}

/** The lowest bottom edge of the placed panels; 0 when there are none. */
export function contentBottom(placed: PlacedPanel[]): number {
  return placed.reduce((bottom, p) => Math.max(bottom, p.y + p.height), 0)
}

/** A placement kept inside the strip: at least the minimum width, at most the strip's, and never off an edge. */
export function clampPlacement(p: PanelPlacement, _aspect: PanelAspect): PanelPlacement {
  // The height follows the aspect and the strip has no bottom edge, so only the width and the sides are held.
  const width = Math.min(STRIP_CSS_WIDTH, Math.max(MIN_PANEL_WIDTH, p.width))
  return { x: Math.min(STRIP_CSS_WIDTH - width, Math.max(0, p.x)), y: Math.max(0, p.y), width }
}

/** The move of a whole group, cut down so that no member leaves the strip: the group stays rigid at an edge. */
export function clampGroupDelta(group: PlacedPanel[], dx: number, dy: number): { dx: number; dy: number } {
  if (group.length === 0) return { dx: 0, dy: 0 }
  const left = Math.min(...group.map((p) => p.x))
  const right = Math.max(...group.map((p) => p.x + p.width))
  const top = Math.min(...group.map((p) => p.y))
  return {
    dx: Math.min(STRIP_CSS_WIDTH - right, Math.max(0 - left, dx)),
    dy: Math.max(0 - top, dy)
  }
}

/** Panel ids in reading order: top to bottom, then left to right, then by id. */
export function readingOrder(placed: PlacedPanel[]): string[] {
  return [...placed]
    .sort((a, b) => a.y - b.y || a.x - b.x || (a.panel.id < b.panel.id ? -1 : a.panel.id > b.panel.id ? 1 : 0))
    .map((p) => p.panel.id)
}
