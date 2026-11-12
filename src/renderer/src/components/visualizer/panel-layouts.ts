import { panelHeight, readingOrder, ROW_GAP, type PlacedPanel } from '@shared/strip-canvas'
import { STRIP_CSS_WIDTH } from '@shared/strip-width'
import type { PanelPlacement } from '@shared/types'

/** The gap between the two panels of a stagger, which overlap the eye's path rather than share a row. */
const STAGGER_GAP = 24
/** The least gap kept between a laid-out block and the panels that follow it. */
const MIN_GAP_BELOW = 8

const W = STRIP_CSS_WIDTH
const HALF = (W - ROW_GAP) / 2
const THIRD = (W - 2 * ROW_GAP) / 3
const TWO_THIRDS = 2 * THIRD + ROW_GAP

/** A box in a layout's own drawing: fractions of a 1 by `tall` sheet, for the button's little picture. */
interface LayoutCell {
  x: number
  y: number
  width: number
  height: number
}

export interface PanelLayout {
  id: string
  name: string
  /** How many panels it arranges: the selected one and those after it in reading order. */
  count: number
  /** The boxes it draws, for its button. */
  cells: LayoutCell[]
  /** Where each panel goes, given their boxes as drawn now (for their shapes) and the top of the block. */
  place(block: PlacedPanel[], top: number): PanelPlacement[]
}

/** Lays rows of panels from `top`, each row's panels at the given widths, the next row below the tallest. */
function rows(block: PlacedPanel[], top: number, widths: number[][]): PanelPlacement[] {
  const out: PanelPlacement[] = []
  let y = top
  let i = 0
  for (const row of widths) {
    let x = 0
    let tallest = 0
    for (const width of row) {
      const panel = block[i++]
      out.push({ x, y, width })
      tallest = Math.max(tallest, panelHeight(width, panel.panel.aspect))
      x += width + ROW_GAP
    }
    y += tallest + ROW_GAP
  }
  return out
}

/** The layouts offered, in the order of their buttons. */
export const PANEL_LAYOUTS: PanelLayout[] = [
  {
    id: 'full',
    name: 'Full width',
    count: 1,
    cells: [{ x: 0, y: 0.25, width: 1, height: 0.5 }],
    place: (block, top) => rows(block, top, [[W]])
  },
  {
    id: 'two-across',
    name: 'Two across',
    count: 2,
    cells: [
      { x: 0, y: 0.2, width: 0.47, height: 0.6 },
      { x: 0.53, y: 0.2, width: 0.47, height: 0.6 }
    ],
    place: (block, top) => rows(block, top, [[HALF, HALF]])
  },
  {
    id: 'three-across',
    name: 'Three across',
    count: 3,
    cells: [
      { x: 0, y: 0.25, width: 0.3, height: 0.5 },
      { x: 0.35, y: 0.25, width: 0.3, height: 0.5 },
      { x: 0.7, y: 0.25, width: 0.3, height: 0.5 }
    ],
    place: (block, top) => rows(block, top, [[THIRD, THIRD, THIRD]])
  },
  {
    id: 'wide-two',
    name: 'Wide, then two',
    count: 3,
    cells: [
      { x: 0, y: 0, width: 1, height: 0.46 },
      { x: 0, y: 0.54, width: 0.47, height: 0.46 },
      { x: 0.53, y: 0.54, width: 0.47, height: 0.46 }
    ],
    place: (block, top) => rows(block, top, [[W], [HALF, HALF]])
  },
  {
    id: 'two-wide',
    name: 'Two, then wide',
    count: 3,
    cells: [
      { x: 0, y: 0, width: 0.47, height: 0.46 },
      { x: 0.53, y: 0, width: 0.47, height: 0.46 },
      { x: 0, y: 0.54, width: 1, height: 0.46 }
    ],
    place: (block, top) => rows(block, top, [[HALF, HALF], [W]])
  },
  {
    id: 'side-stack',
    name: 'Big beside two',
    count: 3,
    cells: [
      { x: 0, y: 0, width: 0.64, height: 1 },
      { x: 0.7, y: 0, width: 0.3, height: 0.47 },
      { x: 0.7, y: 0.53, width: 0.3, height: 0.47 }
    ],
    place: ([, second], top) => {
      const right = TWO_THIRDS + ROW_GAP
      return [
        { x: 0, y: top, width: TWO_THIRDS },
        { x: right, y: top, width: THIRD },
        { x: right, y: top + panelHeight(THIRD, second.panel.aspect) + ROW_GAP, width: THIRD }
      ]
    }
  },
  {
    id: 'stagger',
    name: 'Stagger',
    count: 2,
    cells: [
      { x: 0, y: 0, width: 0.64, height: 0.47 },
      { x: 0.36, y: 0.53, width: 0.64, height: 0.47 }
    ],
    place: ([first], top) => [
      { x: 0, y: top, width: TWO_THIRDS },
      { x: W - TWO_THIRDS, y: top + panelHeight(TWO_THIRDS, first.panel.aspect) + STAGGER_GAP, width: TWO_THIRDS }
    ]
  }
]

/** The panel and those after it in reading order that `layout` arranges, or null when the strip has too few. */
export function layoutBlock(placed: PlacedPanel[], panelId: string, layout: PanelLayout): PlacedPanel[] | null {
  const order = readingOrder(placed)
  const start = order.indexOf(panelId)
  if (start === -1 || start + layout.count > order.length) return null
  return order.slice(start, start + layout.count).map((id) => placed.find((p) => p.panel.id === id) as PlacedPanel)
}

const rounded = (p: PanelPlacement): PanelPlacement => ({ x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width) })

/**
 * The moves that lay `panelId` and the panels after it out as `layout`, from the top of the highest of them. Every
 * other panel at or below that top moves as one by however much the block's bottom moved, keeping the gap it had below
 * the block (at least a little), so the block never lands on one and no hole opens. Panels above are left as drawn.
 * Null when the strip has too few panels from this one.
 */
export function applyLayout(placed: PlacedPanel[], panelId: string, layout: PanelLayout): { panelId: string; placement: PanelPlacement }[] | null {
  const block = layoutBlock(placed, panelId, layout)
  if (block === null) return null
  const ids = new Set(block.map((p) => p.panel.id))
  const top = Math.min(...block.map((p) => p.y))
  const oldBottom = Math.max(...block.map((p) => p.y + p.height))
  const next = layout.place(block, top)
  const newBottom = Math.max(...next.map((p, i) => p.y + panelHeight(p.width, block[i].panel.aspect)))
  const moves = block.map((p, i) => ({ panelId: p.panel.id, placement: rounded(next[i]) }))

  const others = placed.filter((p) => !ids.has(p.panel.id) && p.y >= top - 0.5)
  if (others.length > 0) {
    const firstTop = Math.min(...others.map((p) => p.y))
    const shift = newBottom + Math.max(MIN_GAP_BELOW, firstTop - oldBottom) - firstTop
    if (Math.abs(shift) >= 0.5) for (const p of others) moves.push({ panelId: p.panel.id, placement: rounded({ x: p.x, y: p.y + shift, width: p.width }) })
  }
  return moves
}

/** Where the panel goes on the strip at its width: against the left edge, in the middle, or against the right edge. */
export function alignedX(width: number, side: 'left' | 'centre' | 'right'): number {
  return side === 'left' ? 0 : side === 'right' ? W - width : (W - width) / 2
}
