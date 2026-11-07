import type { BubblePlacement } from '@shared/types'
import type { LineIdentity } from './dialogue-edits'

// What the bubbles and the tail's dot share while a pointer or the keys are on them: the editing hook keeps one of
// each at a time.

/** A press on a bubble, which becomes a drag once it has moved far enough. */
export interface Press {
  index: number
  pointerId: number
  start: { x: number; y: number }
  /** The pointer's offset from the bubble's centre, kept while it is dragged. */
  grab: { dx: number; dy: number }
  bubble: { width: number; height: number }
  expect: LineIdentity
  dragging: boolean
  /** The press is on the tail's dot, so the drag moves the tip: `placement` holds the tip. */
  tail: boolean
  placement: BubblePlacement | null
}

/** A run of arrow keys on one bubble, or on its tail's dot, saved as one change when the keys stop. */
export interface Nudge {
  index: number
  expect: LineIdentity
  /** The run moves the tail's tip, and `placement` holds the tip. */
  tail: boolean
  placement: BubblePlacement
}
