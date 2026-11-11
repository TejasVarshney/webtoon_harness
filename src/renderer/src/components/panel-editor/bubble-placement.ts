import type { BubblePlacement } from '@shared/types'

// Pointer and key math for placing a bubble inside a panel. Every box is in screen pixels, as getBoundingClientRect
// reports it, so the editing stage can be scaled by CSS without any of this knowing the scale.

/** Pointer travel before a press on a bubble becomes a drag instead of a click. */
export const DRAG_THRESHOLD_PX = 3
/** One arrow key press, and one with Shift, as fractions of the panel. */
const NUDGE = 0.01
const NUDGE_BIG = 0.05
/** How long a run of nudges waits before it is saved as one change. */
export const NUDGE_COMMIT_MS = 300
/** The height the panel stage is laid out at before it is fitted to the room. */
export const STAGE_ROW_PX = 560

export type Box = { left: number; top: number; width: number; height: number }

export const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const
export type Arrow = (typeof ARROWS)[number]

export const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

const round = (n: number): number => Math.round(n * 10000) / 10000

/** Keeps a bubble's centre where the whole bubble stays inside the panel; an axis it overflows is centred. */
function clampAxis(centre: number, half: number): number {
  if (half >= 0.5) return 0.5
  return Math.min(1 - half, Math.max(half, centre))
}

/** The room a bubble may move in as fractions of the panel: across the whole of `bounds`, and down from its top. */
function limitsIn(bounds: Box, panel: Box): { left: number; right: number; top: number } {
  return {
    left: (bounds.left - panel.left) / panel.width,
    right: (bounds.left + bounds.width - panel.left) / panel.width,
    top: (bounds.top - panel.top) / panel.height
  }
}

/** Keeps a centre where the bubble stays between `low` and `high`; an axis it overflows is centred between them. */
function clampBetween(centre: number, half: number, low: number, high: number): number {
  if (half * 2 >= high - low) return (low + high) / 2
  return Math.min(high - half, Math.max(low + half, centre))
}

/**
 * A bubble's centre where it stays inside the panel, or, with `bounds`, inside those horizontally and below their top
 * and free to leave the panel: a bubble on the strip belongs to its panel but is not held by it.
 */
function keep(centre: { x: number; y: number }, half: { x: number; y: number }, panel: Box | null, bounds: Box | undefined): BubblePlacement {
  if (bounds === undefined || panel === null || panel.width <= 0 || panel.height <= 0) return { x: round(clampAxis(centre.x, half.x)), y: round(clampAxis(centre.y, half.y)) }
  const limit = limitsIn(bounds, panel)
  return { x: round(clampBetween(centre.x, half.x, limit.left, limit.right)), y: round(Math.max(limit.top + half.y, centre.y)) }
}

/** `grab` is the pointer's offset from the bubble's centre at press time, so the bubble does not jump to the pointer. */
export function placementFromPointer(a: {
  pointer: { x: number; y: number }
  grab: { dx: number; dy: number }
  panel: Box
  bubble: { width: number; height: number }
  /** Given, the bubble may leave the panel but not these (the strip). */
  bounds?: Box
}): BubblePlacement {
  const { pointer, grab, panel, bubble, bounds } = a
  if (panel.width <= 0 || panel.height <= 0) return { x: 0.5, y: 0.5 }
  const x = (pointer.x - grab.dx - panel.left) / panel.width
  const y = (pointer.y - grab.dy - panel.top) / panel.height
  return keep({ x, y }, { x: bubble.width / 2 / panel.width, y: bubble.height / 2 / panel.height }, panel, bounds)
}

/** `half` is the bubble's half-size as fractions of the panel. With `bounds` (and the `panel` they are measured against) it may leave the panel. */
export function nudgePlacement(
  p: BubblePlacement,
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  big: boolean,
  half: { x: number; y: number },
  bounds?: Box,
  panel?: Box
): BubblePlacement {
  const step = big ? NUDGE_BIG : NUDGE
  const x = p.x + (key === 'ArrowRight' ? step : key === 'ArrowLeft' ? -step : 0)
  const y = p.y + (key === 'ArrowDown' ? step : key === 'ArrowUp' ? -step : 0)
  return keep({ x, y }, half, panel ?? null, bounds)
}

/** Where the Add bubble menu puts a panel's next line, given how many it has: across three columns and down five rows, 15 spots before it starts over. */
export function addSpot(count: number): BubblePlacement {
  return { x: [0.3, 0.5, 0.7][count % 3], y: [0.2, 0.35, 0.5, 0.65, 0.8][Math.floor(count / 3) % 5] }
}

/** The placement of a bubble where it is drawn now: the first drag or nudge of an automatic bubble starts from here. */
export function centreOf(bubble: Box, panel: Box): BubblePlacement {
  if (panel.width <= 0 || panel.height <= 0) return { x: 0.5, y: 0.5 }
  const x = (bubble.left + bubble.width / 2 - panel.left) / panel.width
  const y = (bubble.top + bubble.height / 2 - panel.top) / panel.height
  return { x: round(Math.min(1, Math.max(0, x))), y: round(Math.min(1, Math.max(0, y))) }
}

/** The scale that fits `natural` into `avail` whole; 1 when there is nothing to fit. */
export function fitScale(avail: { width: number; height: number }, natural: { width: number; height: number }): number {
  if (natural.width <= 0 || natural.height <= 0) return 1
  return Math.min(avail.width / natural.width, avail.height / natural.height)
}
