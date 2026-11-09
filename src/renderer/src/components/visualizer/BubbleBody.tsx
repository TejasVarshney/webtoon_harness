import { useRef } from 'react'
import type { BubbleShape } from '@shared/types'
import { spikyRing } from './bubble-art'
import { curlyFramePath } from './curly-frame'
import { useBubbleBox } from './use-bubble-box'

// The outline of a shout (a spiked burst), a thought (a cloud of circles), a fringe, a dark burst and a curly frame is
// inline SVG, so its fill and stroke follow the bubble's colours. The other shapes are drawn by the stylesheet's own
// borders. The stylesheet sets the stroke widths and `stroke-linejoin`.

const RING_VIEW_BOX = '0 0 100 100'
const FRINGE_POINTS = spikyRing(96, 40, 44, 50)
const BURST_POINTS = spikyRing(72, 38, 44, 50)

const SHOUT_VIEW_BOX = '-2 -8 104 116'
const SHOUT_POINTS =
  '100.0,50.0 92.7,54.7 98.5,60.8 89.3,63.4 94.3,70.9 83.7,71.0 87.4,79.8 79.8,80.3 78.4,87.0 70.4,85.1 67.7,92.1 60.3,87.6 56.0,94.7 50.0,87.8 44.0,94.7 40.2,85.8 32.3,92.1 29.1,85.9 21.6,87.0 20.8,79.6 12.6,79.8 14.6,72.0 5.7,70.9 10.7,63.4 1.5,60.8 9.3,54.4 0.0,50.0 5.3,45.1 1.5,39.2 8.9,36.0 5.7,29.1 14.6,28.0 12.6,20.2 22.1,21.7 21.6,13.0 30.9,17.3 32.3,7.9 39.2,10.7 44.0,5.3 50.0,10.4 56.0,5.3 60.3,12.4 67.7,7.9 69.5,16.5 78.4,13.0 77.2,22.4 87.4,20.2 87.0,27.0 94.3,29.1 91.1,36.0 98.5,39.2 92.7,45.3'

const THOUGHT_VIEW_BOX = '-7 -4 114 108'
/** The cloud's bumps as [cx, cy, r], drawn twice: once with the outline, then again in the fill to cover the outline's inner half. */
const THOUGHT_CIRCLES: [number, number, number][] = [
  [50, 50, 32],
  [24, 48, 22],
  [76, 48, 22],
  [36, 28, 20],
  [64, 28, 20],
  [36, 72, 20],
  [64, 72, 20],
  [16, 30, 14],
  [84, 30, 14],
  [16, 70, 14],
  [84, 70, 14],
  [8, 50, 12],
  [92, 50, 12],
  [50, 16, 15],
  [50, 84, 15]
]

export const BODY_VIEW_BOX = { shout: SHOUT_VIEW_BOX, thought: THOUGHT_VIEW_BOX }

/** The two passes of a body that fills over its own outline: the outline first, then the fill on top of it. */
export type BodyPass = 'outline' | 'fill'

/** One pass of a shout or a thought. Colours are the caller's. A shout's polygon is the same in both passes. */
export function BodyArt({ shape, pass }: { shape: 'shout' | 'thought'; pass: BodyPass }) {
  if (shape === 'shout') return <polygon points={SHOUT_POINTS} vectorEffect="non-scaling-stroke" />
  return (
    <>
      {THOUGHT_CIRCLES.map(([cx, cy, r]) =>
        pass === 'outline' ? (
          <circle key={`outline-${cx}-${cy}`} className="bubble-body-outline" cx={cx} cy={cy} r={r} vectorEffect="non-scaling-stroke" />
        ) : (
          <circle key={`fill-${cx}-${cy}`} className="bubble-body-fill" cx={cx} cy={cy} r={r} />
        )
      )}
    </>
  )
}

/** A loop's length along the frame, in ems, so the loops grow with the lettering. */
const CURLY_LOOP_EM = 0.55

/** A curly frame, built in px for the bubble's measured box, so its loops stay round at any width. */
function CurlyBody() {
  const ref = useRef<SVGSVGElement>(null)
  const m = useBubbleBox(ref)
  const d = m === null ? '' : curlyFramePath(m.box.width, m.box.height, CURLY_LOOP_EM * m.em)
  return (
    <svg ref={ref} className="bubble-body" aria-hidden="true">
      {d !== '' && <path d={d} />}
    </svg>
  )
}

/** The SVG body of a shape that has one, behind the text; null for a shape the stylesheet draws itself. */
export function BubbleBody({ shape }: { shape: BubbleShape }) {
  if (shape === 'curly') return <CurlyBody />
  if (shape === 'shout') {
    return (
      <svg className="bubble-body" viewBox={SHOUT_VIEW_BOX} preserveAspectRatio="none" aria-hidden="true">
        <BodyArt shape="shout" pass="outline" />
      </svg>
    )
  }
  if (shape === 'thought') {
    return (
      <svg className="bubble-body" viewBox={THOUGHT_VIEW_BOX} preserveAspectRatio="none" aria-hidden="true">
        <BodyArt shape="thought" pass="outline" />
        <BodyArt shape="thought" pass="fill" />
      </svg>
    )
  }
  if (shape === 'fringe') {
    return (
      <svg className="bubble-body" viewBox={RING_VIEW_BOX} preserveAspectRatio="none" aria-hidden="true">
        <polygon points={FRINGE_POINTS} />
        <ellipse className="bubble-body-fill" cx="50" cy="50" rx="39" ry="39" />
      </svg>
    )
  }
  if (shape === 'burst') {
    return (
      <svg className="bubble-body" viewBox={RING_VIEW_BOX} preserveAspectRatio="none" aria-hidden="true">
        <polygon points={BURST_POINTS} vectorEffect="non-scaling-stroke" />
      </svg>
    )
  }
  return null
}
