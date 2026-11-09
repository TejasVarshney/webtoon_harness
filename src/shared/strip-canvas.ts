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
 * Every panel's box, in the order of `panels`. Rows are walked top to bottom holding a `cursor`, where the next
 * flowing row starts (the lowest bottom so far plus the previous row's gap), and a `shift`, the height and gap of every
 * flowing row so far, which moves each later placed panel down so a panel inserted into the flow never lands on top of
 * one the user has placed below it. A row shares its width by `rowShares` whether or not some of its panels are placed.
 */
export function resolveStrip(panels: Panel[]): PlacedPanel[] {
  const byId = new Map<string, PlacedPanel>()
  let lowest = 0
  let previousGap = 0
  let shift = 0

  for (const row of layoutStrip(panels)) {
    const cursor = lowest + previousGap
    const gap = GAP_PX[row.gapAfter]
    const available = STRIP_CSS_WIDTH - ROW_GAP * (row.panels.length - 1)
    const shares = rowShares(row.panels)
    let flowX = 0
    let flowHeight = 0
    let flows = false

    for (const panel of row.panels) {
      const flowWidth = shares[panel.id] * available
      const { placement } = panel
      const width = placement ? placement.width : flowWidth
      const x = placement ? placement.x : flowX
      const y = placement ? placement.y + shift : cursor
      const height = panelHeight(width, panel.aspect)
      byId.set(panel.id, { panel, x, y, width, height, share: width / STRIP_CSS_WIDTH, slant: row.slants[panel.id] })
      lowest = Math.max(lowest, y + height)
      if (!placement) {
        flows = true
        flowHeight = panelHeight(flowWidth, panel.aspect)
      }
      flowX += flowWidth + ROW_GAP
    }

    if (flows) shift += flowHeight + gap
    previousGap = gap
  }

  return panels.map((panel) => byId.get(panel.id) as PlacedPanel)
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
