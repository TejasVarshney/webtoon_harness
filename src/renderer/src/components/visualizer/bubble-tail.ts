import type { BubbleShape } from '@shared/types'
import type { BubbleSide } from './bubble-layout'

// Where a bubble's tail joins its outline and where its tip sits. Everything is in px from the bubble's centre, the
// same space the overlay draws in. No React here: the overlay calls these and draws what comes back.

export type Point = { x: number; y: number }
export type Size = { width: number; height: number }
export type TailedShape = 'speech' | 'shout' | 'whisper' | 'thought'

export function hasTail(shape: BubbleShape): shape is TailedShape {
  return shape === 'speech' || shape === 'shout' || shape === 'whisper' || shape === 'thought'
}

/** The part of the box the shape's body fills. A shout's spikes and a cloud's bumps stop short of their box. */
const BODY: Record<TailedShape, { rx: number; ry: number }> = {
  speech: { rx: 1, ry: 1 },
  whisper: { rx: 1, ry: 1 },
  shout: { rx: 0.81, ry: 0.67 },
  thought: { rx: 0.85, ry: 0.8 }
}

interface TailInput {
  box: Size
  tip: Point
  em: number
  stroke: number
  shape: TailedShape
}

export function tailWedge({ box, tip, em, stroke, shape }: TailInput): { a: Point; tip: Point; b: Point } | null {
  const body = BODY[shape]
  const A = Math.max((box.width / 2) * body.rx - stroke, 1)
  const B = Math.max((box.height / 2) * body.ry - stroke, 1)
  if ((tip.x / (A + stroke)) ** 2 + (tip.y / (B + stroke)) ** 2 <= 1) return null
  const root = Math.min(1.1 * em + 0.08 * Math.hypot(tip.x, tip.y), 0.5 * Math.min(box.width, box.height))
  const phi = Math.atan2(tip.y / B, tip.x / A)
  const speed = Math.hypot(A * Math.sin(phi), B * Math.cos(phi))
  const half = Math.min(root / 2 / speed, Math.PI / 4)
  const at = (t: number): Point => ({ x: A * Math.cos(t), y: B * Math.sin(t) })
  return { a: at(phi - half), tip, b: at(phi + half) }
}

/** The three puffs of a thought's tail, shrinking toward the tip. Empty while the tip is inside the cloud. */
export function thoughtPuffs({ box, tip, em }: { box: Size; tip: Point; em: number }): { cx: number; cy: number; rx: number; ry: number }[] {
  const body = BODY.thought
  const A = (box.width / 2) * body.rx
  const B = (box.height / 2) * body.ry
  const length = Math.hypot(tip.x, tip.y)
  if (length === 0) return []
  // The distance from the centre to the cloud's edge, along the line to the tip.
  const r = 1 / Math.sqrt((tip.x / length / A) ** 2 + (tip.y / length / B) ** 2)
  if (length <= r) return []
  const start = { x: (tip.x / length) * r, y: (tip.y / length) * r }
  return [0.3, 0.65, 1].map((t, i) => {
    const rx = [0.42, 0.28, 0.17][i] * em
    return {
      cx: start.x + t * (tip.x - start.x),
      cy: start.y + t * (tip.y - start.y),
      rx,
      ry: rx * 0.8
    }
  })
}

/** Where a tip rests when nobody has dragged it: the same place the CSS wedge sits at 24% of the box. */
export function restingTip({ box, em, side, drawing }: { box: Size; em: number; side: BubbleSide; drawing: 'down' | 'edge' | 'none' }): Point {
  const below = box.height / 2 + 1.1 * em
  if (drawing === 'none') return { x: 0, y: below }
  const offset = box.width * 0.26 - 0.18 * em
  const x = side === 'center' ? 0 : side === 'left' ? -offset : offset
  return { x, y: drawing === 'edge' ? -below : below }
}
