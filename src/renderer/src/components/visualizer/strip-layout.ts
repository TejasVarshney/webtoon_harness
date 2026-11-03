// How an episode's panels sit in the vertical strip. Pure: no React, so the rules are easy to test.

import type { Panel, PanelAspect, PanelGap, PanelGutter } from '@shared/types'
import { isTallAspect } from '@shared/draw-aspect'

/** The most panels that share one row. */
const MAX_PER_ROW = 3

export interface StripRow {
  panels: Panel[]
  /** The gap below the row, taken from its last panel. */
  gapAfter: PanelGap
  /** The colour of that gap, taken from the same panel. */
  gutter: PanelGutter
  /** Which way each slanted panel leans, by panel id. Tall panels fade instead, so they have no entry. */
  slants: Record<string, 'left' | 'right'>
}

/** Group panels (in strip order) into rows: a panel marked `beside` joins the row before it, up to three. */
export function layoutStrip(panels: Panel[]): StripRow[] {
  const rows: StripRow[] = []
  let slanted = 0
  for (const panel of panels) {
    let row = rows[rows.length - 1]
    if (!panel.beside || !row || row.panels.length >= MAX_PER_ROW) {
      row = { panels: [], gapAfter: panel.gapAfter, gutter: panel.gutter, slants: {} }
      rows.push(row)
    }
    row.panels.push(panel)
    row.gapAfter = panel.gapAfter
    row.gutter = panel.gutter
    if (panel.frame === 'slanted' && !isTallAspect(panel.aspect)) {
      row.slants[panel.id] = slanted % 2 === 0 ? 'left' : 'right'
      slanted += 1
    }
  }
  return rows
}

/** A panel's width over its height. */
export function aspectRatio(aspect: PanelAspect): number {
  const [w, h] = aspect.split(':').map(Number)
  return w / h
}

/**
 * How much of its row's width each panel of the row takes, by panel id: its aspect ratio over the row's sum, since the
 * panels of a row share one height. A lone panel has the whole row (1).
 */
export function rowShares(panels: Panel[]): Record<string, number> {
  const total = panels.reduce((sum, panel) => sum + aspectRatio(panel.aspect), 0)
  return Object.fromEntries(panels.map((panel) => [panel.id, aspectRatio(panel.aspect) / total]))
}
