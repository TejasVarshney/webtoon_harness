import { useLayoutEffect, useState, type RefObject } from 'react'
import type { Point, Size } from './bubble-tail'

// What a bubble measures on the page. A tail has to meet an outline whose size depends on the text and the font, so it
// is measured the way `useStageFit` is, and measured again when the bubble or the overlay changes size.

export interface BubbleBox {
  /** The bubble's size, in px at the overlay's own scale (the stage is scaled with a transform; the strip is not). */
  box: Size
  /** The bubble's centre, from the overlay's top left corner. */
  centre: Point
  /** The overlay, which is the panel. */
  panel: Size
  em: number
  /** Screen px for each px at the overlay's own scale. */
  scale: number
}

const same = (a: BubbleBox, b: BubbleBox): boolean =>
  a.box.width === b.box.width &&
  a.box.height === b.box.height &&
  a.centre.x === b.centre.x &&
  a.centre.y === b.centre.y &&
  a.panel.width === b.panel.width &&
  a.panel.height === b.panel.height &&
  a.em === b.em &&
  a.scale === b.scale

/** Screen px for each px at the overlay's own scale, from the overlay's width before any transform. */
export function overlayScale(overlay: HTMLElement): number {
  // The computed width keeps the fraction that offsetWidth rounds away. jsdom has no layout, so both are empty or 0 there.
  const layoutWidth = parseFloat(getComputedStyle(overlay).width) || overlay.offsetWidth
  return layoutWidth > 0 ? overlay.getBoundingClientRect().width / layoutWidth : 1
}

/** The box of the bubble `ref` sits in, or null before it is measured. */
export function useBubbleBox(ref: RefObject<Element | null>): BubbleBox | null {
  const [measured, setMeasured] = useState<BubbleBox | null>(null)
  // On every commit: the bubble's text, font or style may have changed without either box being resized yet.
  useLayoutEffect(() => {
    const bubble = ref.current?.closest('.bubble')
    const overlay = ref.current?.closest<HTMLElement>('.dialogue-overlay')
    if (!bubble || !overlay) return
    function measure(): void {
      if (!bubble || !overlay) return
      const b = bubble.getBoundingClientRect()
      const o = overlay.getBoundingClientRect()
      const scale = overlayScale(overlay)
      const em = parseFloat(getComputedStyle(bubble).fontSize)
      const next: BubbleBox = {
        box: { width: b.width / scale, height: b.height / scale },
        centre: { x: (b.left + b.width / 2 - o.left) / scale, y: (b.top + b.height / 2 - o.top) / scale },
        panel: { width: o.width / scale, height: o.height / scale },
        em: Number.isFinite(em) ? em : 16,
        scale
      }
      setMeasured((prev) => (prev !== null && same(prev, next) ? prev : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(bubble)
    observer.observe(overlay)
    // A line above that grows moves this bubble without resizing it, and its layer grows with it.
    if (bubble.parentElement !== null) observer.observe(bubble.parentElement)
    return () => observer.disconnect()
  })
  return measured
}
