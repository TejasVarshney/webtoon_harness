import type { BubblePlacement } from '@shared/types'
import type { BubbleEdge } from '../visualizer/BubbleWidthHandles'
import type { LineIdentity } from './dialogue-edits'

// What the bubbles, the tail's dot and the width handles share while a pointer or the keys are on them: the editing
// hook keeps one of each at a time.

/** A press on one of a bubble's width handles. The bubble's other side stays where it is. */
interface WidthPress {
  edge: BubbleEdge
  /** The other side, in screen px across. The press's `grab.dx` is the pointer's distance from the side it is on. */
  anchor: number
  /** The height of the bubble's centre, as a fraction of the panel: a resize keeps it. */
  y: number
  /** The narrowest the bubble is drawn, as a share of the panel's width: it is never stored narrower. */
  floor: number
  /** The width the drag has reached, as a share of the panel's; null until it moves. */
  share: number | null
}

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
  /** The press is on a width handle, so the drag sets the width: `placement` holds the centre that goes with it. */
  width?: WidthPress
  placement: BubblePlacement | null
}

/** A run of arrow keys on one bubble, on its tail's dot, or on one of its width handles, saved as one change when the keys stop. */
export interface Nudge {
  index: number
  expect: LineIdentity
  /** The run moves the tail's tip, and `placement` holds the tip. */
  tail: boolean
  /** The run sets the width, as a share of the panel's, and `placement` holds the centre that goes with it. */
  width?: number
  placement: BubblePlacement
}

/** What a press follows of a pointer event: the React stage events and the window's native ones both have it. */
export interface PointerFacts {
  pointerId: number
  clientX: number
  clientY: number
  buttons: number
}
