// The shapes a slanted panel can be cut to. Pure, with no zod, so the strip layout and the renderer can both use it.
// One table drives the panel's clip-path on screen and in the export, and the little picture on each button.

import type { PanelCut } from './types'

/**
 * A corner of a cut: where it is on the panel's box (`bx`, `by`: 0 the left or top edge, 1 the right or bottom edge)
 * and how far the slant moves it (`sx`, `sy`: -1, 0 or 1 times the slant, inward or outward).
 */
type Corner = readonly [bx: 0 | 1, sx: -1 | 0 | 1, by: 0 | 1, sy: -1 | 0 | 1]

/** How a slanted panel is cut: one of the cuts the user picks, or the automatic `left` and `right` that alternate down the strip. */
export type PanelSlant = 'left' | 'right' | PanelCut

const CORNERS: Record<PanelSlant, readonly Corner[]> = {
  // Automatic: the top and bottom edges close in towards one side, alternating from panel to panel.
  left: [
    [0, 0, 0, 0],
    [1, 0, 0, 1],
    [1, 0, 1, -1],
    [0, 0, 1, 0]
  ],
  right: [
    [0, 0, 0, 1],
    [1, 0, 0, 0],
    [1, 0, 1, 0],
    [0, 0, 1, -1]
  ],
  'narrow-right': [
    [0, 0, 0, 0],
    [1, 0, 0, 1],
    [1, 0, 1, -1],
    [0, 0, 1, 0]
  ],
  'narrow-left': [
    [0, 0, 0, 1],
    [1, 0, 0, 0],
    [1, 0, 1, 0],
    [0, 0, 1, -1]
  ],
  'top-down': [
    [0, 0, 0, 0],
    [1, 0, 0, 1],
    [1, 0, 1, 0],
    [0, 0, 1, 0]
  ],
  'top-up': [
    [0, 0, 0, 1],
    [1, 0, 0, 0],
    [1, 0, 1, 0],
    [0, 0, 1, 0]
  ],
  'bottom-down': [
    [0, 0, 0, 0],
    [1, 0, 0, 0],
    [1, 0, 1, 0],
    [0, 0, 1, -1]
  ],
  'bottom-up': [
    [0, 0, 0, 0],
    [1, 0, 0, 0],
    [1, 0, 1, -1],
    [0, 0, 1, 0]
  ],
  'both-down': [
    [0, 0, 0, 0],
    [1, 0, 0, 1],
    [1, 0, 1, 0],
    [0, 0, 1, -1]
  ],
  'both-up': [
    [0, 0, 0, 1],
    [1, 0, 0, 0],
    [1, 0, 1, -1],
    [0, 0, 1, 0]
  ],
  'lean-right': [
    [0, 1, 0, 0],
    [1, 0, 0, 0],
    [1, -1, 1, 0],
    [0, 0, 1, 0]
  ],
  'lean-left': [
    [0, 0, 0, 0],
    [1, -1, 0, 0],
    [1, 0, 1, 0],
    [0, 1, 1, 0]
  ],
  'left-edge': [
    [0, 1, 0, 0],
    [1, 0, 0, 0],
    [1, 0, 1, 0],
    [0, 0, 1, 0]
  ],
  'right-edge': [
    [0, 0, 0, 0],
    [1, 0, 0, 0],
    [1, -1, 1, 0],
    [0, 0, 1, 0]
  ]
}

/** The cuts the user can pick, in the order of their buttons, with their names. */
export const PANEL_CUTS: { cut: PanelCut; name: string }[] = [
  { cut: 'top-down', name: 'Top falls' },
  { cut: 'top-up', name: 'Top rises' },
  { cut: 'bottom-down', name: 'Bottom falls' },
  { cut: 'bottom-up', name: 'Bottom rises' },
  { cut: 'both-down', name: 'Falls' },
  { cut: 'both-up', name: 'Rises' },
  { cut: 'narrow-right', name: 'Narrows right' },
  { cut: 'narrow-left', name: 'Narrows left' },
  { cut: 'lean-right', name: 'Leans right' },
  { cut: 'lean-left', name: 'Leans left' },
  { cut: 'left-edge', name: 'Left edge' },
  { cut: 'right-edge', name: 'Right edge' }
]

/** The frame's ink, which the inner cut sits inside of. */
const INK_PX = 2.5

function coord(base: 0 | 1, slant: -1 | 0 | 1, inset: number): string {
  const parts = [`${base * 100}%`]
  if (slant !== 0) parts.push(`${slant < 0 ? '-' : '+'} var(--slant)`)
  if (inset !== 0) parts.push(`${base === 0 ? '+' : '-'} ${inset}px`)
  return parts.length === 1 ? parts[0] : `calc(${parts.join(' ')})`
}

function polygon(slant: PanelSlant, inset: number): string {
  return `polygon(${CORNERS[slant].map(([bx, sx, by, sy]) => `${coord(bx, sx, inset)} ${coord(by, sy, inset)}`).join(', ')})`
}

/**
 * The CSS custom properties that cut a slanted panel: `--cut` for its ink, `--cut-inner` for the picture inside the
 * ink. The stylesheet sets `--slant`, the slope's depth.
 */
export function cutStyle(slant: PanelSlant): Record<'--cut' | '--cut-inner', string> {
  return { '--cut': polygon(slant, 0), '--cut-inner': polygon(slant, INK_PX) }
}

/** The cut's corners on a `width` by `height` box with a slope `depth` deep, for a button's little picture. */
export function cutPoints(slant: PanelSlant, width: number, height: number, depth: number): string {
  return CORNERS[slant].map(([bx, sx, by, sy]) => `${bx * width + sx * depth},${by * height + sy * depth}`).join(' ')
}
