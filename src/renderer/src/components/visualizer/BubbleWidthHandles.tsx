import { useLayoutEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type RefCallback, type RefObject } from 'react'

/** A side of a bubble, where one of its width handles sits. */
export type BubbleEdge = 'left' | 'right'

const EDGES: BubbleEdge[] = ['left', 'right']

/** What the stage gives a handle: its handlers and label, and the ref it gives the handle its focus back through. */
export type WidthHandleProps = HTMLAttributes<HTMLDivElement> & { ref?: RefCallback<HTMLDivElement> }

/**
 * How far, in screen px from its centre, a handle's hit area reaches into the bubble: the rest of it is outside, so a
 * press on a small bubble still moves it. Where the panel's side clips the outside, it reaches in far enough that this
 * much can still be pressed.
 */
const HIT_IN_PX = 3
const HIT_LEAST_PX = 12

interface Drawn {
  /** The bubble's width over the panel's, as laid out: before the stage's zoom, and before a sound effect's tilt. */
  share: number | null
  /** How far each handle's hit area reaches into the bubble, in screen px. */
  left: number
  right: number
}

const same = (a: Drawn, b: Drawn): boolean => a.share === b.share && a.left === b.left && a.right === b.right

/** A length the stylesheet gives, in px; 0 for none, and in jsdom, which lays nothing out. */
const px = (v: string): number => parseFloat(v) || 0

/** The bubble as it is drawn, measured from the page on every commit, as `BubbleTailArt` measures. */
function useDrawn(ref: RefObject<Element | null>): Drawn | null {
  const [drawn, setDrawn] = useState<Drawn | null>(null)
  useLayoutEffect(() => {
    const bubble = ref.current?.closest<HTMLElement>('.bubble')
    const overlay = ref.current?.closest<HTMLElement>('.dialogue-overlay')
    if (!bubble || !overlay) return
    function measure(): void {
      if (!bubble || !overlay) return
      const b = bubble.getBoundingClientRect()
      const o = overlay.getBoundingClientRect()
      // jsdom lays nothing out: there the boxes on screen stand in.
      const laidOut = px(getComputedStyle(overlay).width) || overlay.offsetWidth
      const share = laidOut > 0 ? (px(getComputedStyle(bubble).width) || bubble.offsetWidth) / laidOut : o.width > 0 ? b.width / o.width : null
      // The panel clips what is outside it, so the room outside each side is all of its hit area that can be pressed.
      const reachIn = (room: number): number => Math.round(Math.max(HIT_IN_PX, HIT_LEAST_PX - Math.max(0, room)) * 2) / 2
      const next = { share, left: reachIn(b.left - o.left), right: reachIn(o.right - b.right) }
      setDrawn((prev) => (prev !== null && same(prev, next) ? prev : next))
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
 * percent of the panel's width. They say the width the bubble is drawn at: an automatic bubble's, or a set width's,
 * which a bubble's least width (a thought's cloud, say) can make wider. The stylesheet draws them
 * (`.bubble-width-handle`), at one size on screen at any zoom.
 */
export function BubbleWidthHandles({ width, bind }: BubbleWidthHandlesProps) {
  const probe = useRef<HTMLDivElement | null>(null)
  const drawn = useDrawn(probe)
  const share = width === undefined ? (drawn?.share ?? null) : Math.max(width, drawn?.share ?? 0)
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
            style={drawn === null ? undefined : ({ '--hit-in': `${drawn[edge]}px` } as CSSProperties)}
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
