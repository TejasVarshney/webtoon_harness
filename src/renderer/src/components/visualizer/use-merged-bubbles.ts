import { useLayoutEffect, useState, type RefObject } from 'react'
import { mergeGroups, type MergeBox } from './bubble-merge'
import { overlayScale } from './use-bubble-box'

/** A bubble in a merged group: its line's index, and its box in px at the overlay's own scale. */
export interface MergedMember {
  index: number
  left: number
  top: number
  width: number
  height: number
}
export type MergedGroup = MergedMember[]

const NONE: MergedGroup[] = []

const sameMember = (a: MergedMember, b: MergedMember): boolean => a.index === b.index && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height
const sameGroups = (a: MergedGroup[], b: MergedGroup[]): boolean => a.length === b.length && a.every((group, g) => group.length === b[g].length && group.every((m, i) => sameMember(m, b[g][i])))

function measureGroups(overlay: HTMLElement, bubbles: HTMLElement[]): MergedGroup[] {
  const o = overlay.getBoundingClientRect()
  const scale = overlayScale(overlay)
  const boxes = bubbles.map((bubble): MergeBox => {
    const b = bubble.getBoundingClientRect()
    return {
      index: Number(bubble.dataset.mergeIndex),
      key: bubble.dataset.mergeKey ?? null,
      left: (b.left - o.left) / scale,
      top: (b.top - o.top) / scale,
      width: b.width / scale,
      height: b.height / scale
    }
  })
  return mergeGroups(boxes).map((group) => group.map((index) => boxes.find((b) => b.index === index)!))
}

/**
 * The merged groups among the overlay's bubbles. Measured on every commit, before paint, so a drag merges with no flash
 * of the unmerged look; and again when a bubble or the overlay changes size, as when a font arrives. A panel with no
 * placed bubble measures nothing: its bubbles stand apart in their column, and most panels are like that.
 */
export function useMergedBubbles(overlay: RefObject<HTMLElement | null>): MergedGroup[] {
  const [groups, setGroups] = useState<MergedGroup[]>(NONE)
  useLayoutEffect(() => {
    const root = overlay.current
    const bubbles = root ? [...root.querySelectorAll<HTMLElement>('.bubble[data-merge-key]')] : []
    if (!root || bubbles.length < 2 || !bubbles.some((b) => b.classList.contains('bubble-placed'))) {
      setGroups(NONE)
      return
    }
    function measure(): void {
      if (!root) return
      const next = measureGroups(root, bubbles)
      setGroups((prev) => (sameGroups(prev, next) ? prev : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    for (const bubble of bubbles) {
      observer.observe(bubble)
      // An automatic line above that grows moves this bubble without resizing it, and its layer grows with it.
      if (bubble.parentElement !== null) observer.observe(bubble.parentElement)
    }
    return () => observer.disconnect()
  })
  return groups
}
