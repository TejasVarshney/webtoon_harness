import type { BubblePlacement } from '@shared/types'

// Pointer and key math for placing a bubble inside a panel. Every box is in screen pixels, as getBoundingClientRect
// reports it, so the editing stage can be scaled by CSS without any of this knowing the scale.

/** Pointer travel before a press on a bubble becomes a drag instead of a click. */
export const DRAG_THRESHOLD_PX = 3
/** One arrow key press, and one with Shift, as fractions of the panel. */
export const NUDGE = 0.01
export const NUDGE_BIG = 0.05
/** How long a run of nudges waits before it is saved as one change. */
export const NUDGE_COMMIT_MS = 300
/** The height the panel stage is laid out at before it is fitted to the room. */
export const STAGE_ROW_PX = 560

export type Box = { left: number; top: number; width: number; height: number }

const round = (n: number): number => Math.round(n * 10000) / 10000

/** Keeps a bubble's centre where the whole bubble stays inside the panel; an axis it overflows is centred. */
function clampAxis(centre: number, half: number): number {
  if (half >= 0.5) return 0.5
  return Math.min(1 - half, Math.max(half, centre))
}

/** `grab` is the pointer's offset from the bubble's centre at press time, so the bubble does not jump to the pointer. */
export function placementFromPointer(a: {
  pointer: { x: number; y: number }
  grab: { dx: number; dy: number }
  panel: Box
  bubble: { width: number; height: number }
}): BubblePlacement {
  const { pointer, grab, panel, bubble } = a
  if (panel.width <= 0 || panel.height <= 0) return { x: 0.5, y: 0.5 }
  const x = (pointer.x - grab.dx - panel.left) / panel.width
  const y = (pointer.y - grab.dy - panel.top) / panel.height
  return {
    x: round(clampAxis(x, bubble.width / 2 / panel.width)),
    y: round(clampAxis(y, bubble.height / 2 / panel.height))
  }
}

/** `half` is the bubble's half-size as fractions of the panel. */
export function nudgePlacement(
  p: BubblePlacement,
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  big: boolean,
  half: { x: number; y: number }
): BubblePlacement {
  const step = big ? NUDGE_BIG : NUDGE
  const x = p.x + (key === 'ArrowRight' ? step : key === 'ArrowLeft' ? -step : 0)
  const y = p.y + (key === 'ArrowDown' ? step : key === 'ArrowUp' ? -step : 0)
  return { x: round(clampAxis(x, half.x)), y: round(clampAxis(y, half.y)) }
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
