import { useRef, type HTMLAttributes } from 'react'
import type { BubblePlacement } from '@shared/types'
import type { BubbleSide, TailDrawing } from './bubble-layout'
import { restingTip, tailWedge, thoughtPuffs, type Point, type TailedShape } from './bubble-tail'
import { useBubbleBox, type BubbleBox } from './use-bubble-box'

// A bubble's tail drawn as SVG, in px from the bubble's centre. The tail has to reach a point in the panel and meet an
// outline whose size depends on the text and the font, so it is measured from the page and redrawn when either changes.

/** Half the dot's size on screen (`.bubble-tail-handle`). */
const DOT_RADIUS_PX = 7

/**
 * A resting dot, held whole inside the panel. Outside it, a press there would land on the stage and not the dot, and a
 * dot that is focused there would have the browser try to bring it into view. A stored tip is where the user put it.
 */
function insidePanel(p: Point, m: BubbleBox): Point {
  const inset = DOT_RADIUS_PX / m.scale
  return {
    x: Math.min(m.panel.width - inset - m.centre.x, Math.max(inset - m.centre.x, p.x)),
    y: Math.min(m.panel.height - inset - m.centre.y, Math.max(inset - m.centre.y, p.y))
  }
}

const num =(n: number): string => String(Math.round(n * 100) / 100)

export interface BubbleTailArtProps {
  shape: TailedShape
  side: BubbleSide
  drawing: TailDrawing
  /** The stored tip, as fractions of the panel; null while the tail is automatic. */
  tip: BubblePlacement | null
  /** The outline's width in px, which the wedge's root is inset by. */
  stroke: number
  /** When set, a dot at the tip that takes these props (the stage's drag). */
  handle?: HTMLAttributes<HTMLDivElement>
}

export function BubbleTailArt({ shape, side, drawing, tip, stroke, handle }: BubbleTailArtProps) {
  const ref = useRef<SVGSVGElement>(null)
  const m = useBubbleBox(ref)
  let local: Point | null = null
  if (m !== null) {
    local = tip
      ? { x: tip.x * m.panel.width - m.centre.x, y: tip.y * m.panel.height - m.centre.y }
      : insidePanel(restingTip({ box: m.box, em: m.em, side, drawing: drawing === 'point' ? 'down' : drawing }), m)
  }
  let art = null
  // An automatic tail is the stylesheet's; only a stored tip is drawn here, and the dot may sit by one that is not.
  if (m !== null && local !== null && drawing === 'point') {
    if (shape === 'thought') {
      art = thoughtPuffs({ box: m.box, tip: local, em: m.em }).map((p, i) => <ellipse key={i} cx={num(p.cx)} cy={num(p.cy)} rx={num(p.rx)} ry={num(p.ry)} />)
    } else {
      const wedge = tailWedge({ box: m.box, tip: local, em: m.em, stroke, shape })
      if (wedge) art = <path d={`M${num(wedge.a.x)} ${num(wedge.a.y)} L${num(wedge.tip.x)} ${num(wedge.tip.y)} L${num(wedge.b.x)} ${num(wedge.b.y)}`} />
    }
  }
  return (
    <>
      <svg ref={ref} className="bubble-tail" aria-hidden="true">
        {art}
      </svg>
      {handle && local && (
        <div
          className="bubble-tail-handle"
          role="button"
          tabIndex={0}
          data-state={tip ? 'pointed' : 'resting'}
          style={{ transform: `translate(${num(local.x)}px, ${num(local.y)}px)` }}
          {...handle}
        />
      )}
    </>
  )
}
