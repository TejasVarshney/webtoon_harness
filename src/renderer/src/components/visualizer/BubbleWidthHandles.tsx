import { useLayoutEffect, useRef, useState, type HTMLAttributes, type RefCallback, type RefObject } from 'react'

/** A side of a bubble, where one of its width handles sits. */
export type BubbleEdge = 'left' | 'right'

const EDGES: BubbleEdge[] = ['left', 'right']

/** What the stage gives a handle: its handlers and label, and the ref it gives the handle its focus back through. */
export type WidthHandleProps = HTMLAttributes<HTMLDivElement> & { ref?: RefCallback<HTMLDivElement> }

/** The bubble's width over the panel's, as it is drawn: what an automatic bubble's handles say. */
function useDrawnWidth(ref: RefObject<Element | null>, measuring: boolean): number | null {
  const [drawn, setDrawn] = useState<number | null>(null)
  // On every commit, as `BubbleTailArt` measures: the text, font or style may have changed without a resize yet.
  useLayoutEffect(() => {
    const bubble = ref.current?.closest('.bubble')
    const overlay = ref.current?.closest('.dialogue-overlay')
    if (!measuring || !bubble || !overlay) return
    function measure(): void {
      if (!bubble || !overlay) return
      // Both are on screen, so the stage's zoom cancels out.
      const panel = overlay.getBoundingClientRect().width
      setDrawn(panel > 0 ? bubble.getBoundingClientRect().width / panel : null)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(bubble)
    observer.observe(overlay)
    return () => observer.disconnect()
  })
  return drawn
}

export interface BubbleWidthHandlesProps {
  /** The width the line sets, or the one being set; undefined while the bubble fits its text. */
  width: number | undefined
  bind(edge: BubbleEdge): WidthHandleProps
}

/**
 * The handles on the left and right of the selected bubble, at mid-height, that set its width: each a slider, in
 * percent of the panel's width. The stylesheet draws them (`.bubble-width-handle`), at one size on screen at any zoom.
 */
export function BubbleWidthHandles({ width, bind }: BubbleWidthHandlesProps) {
  const probe = useRef<HTMLDivElement | null>(null)
  const drawn = useDrawnWidth(probe, width === undefined)
  const share = width ?? drawn
  const now = share === null ? undefined : Math.round(Math.min(0.95, Math.max(0.1, share)) * 100)
  return (
    <>
      {EDGES.map((edge) => {
        const { ref: keep, ...attrs } = bind(edge)
        return (
          <div
            key={edge}
            className="bubble-width-handle"
            role="slider"
            tabIndex={0}
            aria-orientation="horizontal"
            aria-valuemin={10}
            aria-valuemax={95}
            aria-valuenow={now}
            data-edge={edge}
            {...attrs}
            ref={(el) => {
              if (edge === 'left') probe.current = el
              keep?.(el)
            }}
          />
        )
      })}
    </>
  )
}
