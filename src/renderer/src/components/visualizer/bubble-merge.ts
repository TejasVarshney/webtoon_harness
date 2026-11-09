import type { BubbleShape, BubbleStyle } from '@shared/types'
import { bubbleDefaults } from './bubble-style'

// Which placed bubbles become one balloon. No React here: the overlay measures the boxes and draws what comes back.

const MERGEABLE = ['speech', 'whisper', 'shout', 'thought'] as const
type MergeableShape = (typeof MERGEABLE)[number]

function isMergeable(shape: BubbleShape): shape is MergeableShape {
  return (MERGEABLE as readonly BubbleShape[]).includes(shape)
}

/** What a merged bubble's body is drawn from. */
export interface MergedLook {
  shape: MergeableShape
  fill: string
  stroke: string
  strokeWidth: number
}

/** The look of a bubble that can merge, its style resolved through the shape's defaults; null for one that cannot. */
export function mergedLook(shape: BubbleShape, style: BubbleStyle | null): MergedLook | null {
  if (!isMergeable(shape)) return null
  const { fill, stroke, strokeWidth } = { ...bubbleDefaults(shape), ...style }
  return { shape, fill, stroke, strokeWidth }
}

/** A placed bubble's box, in px from the overlay's corner. `index` is the line's place in the dialogue. */
export interface MergeBox {
  index: number
  key: string | null
  left: number
  top: number
  width: number
  height: number
}

/** What two bubbles must share to merge: the shape and everything about its outline. Null for a shape that never merges. */
export function mergeKey(shape: BubbleShape, style: BubbleStyle | null): string | null {
  const look = mergedLook(shape, style)
  return look && [look.shape, look.fill.toLowerCase(), look.stroke.toLowerCase(), look.strokeWidth].join('|')
}

/** Strict on both axes, so boxes that only touch stay apart and an empty box (jsdom lays nothing out) overlaps nothing. */
function overlaps(a: MergeBox, b: MergeBox): boolean {
  if (a.width <= 0 || a.height <= 0 || b.width <= 0 || b.height <= 0) return false
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height
}

/**
 * The groups of two or more boxes joined by overlaps, among boxes with the same non-null key, as ascending `index`
 * values, the groups in the order of their first line. A box's shape is not tested, only its box: two bubbles whose
 * boxes meet but whose outlines do not are drawn the same whether they are grouped or not.
 */
export function mergeGroups(boxes: MergeBox[]): number[][] {
  const candidates = boxes.filter((b) => b.key !== null)
  const seen = new Set<number>()
  const groups: number[][] = []
  for (const start of candidates) {
    if (seen.has(start.index)) continue
    seen.add(start.index)
    const group = [start]
    for (const member of group) {
      for (const other of candidates) {
        if (!seen.has(other.index) && other.key === member.key && overlaps(member, other)) {
          seen.add(other.index)
          group.push(other)
        }
      }
    }
    if (group.length > 1) groups.push(group.map((b) => b.index).sort((a, b) => a - b))
  }
  return groups.sort((a, b) => a[0] - b[0])
}
