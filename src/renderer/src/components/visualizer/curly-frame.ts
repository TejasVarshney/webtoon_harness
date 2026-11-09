// A frame whose edge is a chain of small loops, like a line of cursive e's. It is built for the box it goes on, in px,
// and never stretched: a stretched loop is an oval, so a longer side gets more loops instead of wider ones.

type Vec = { x: number; y: number }

const along = (p: Vec, d: Vec, by: number): Vec => ({ x: p.x + d.x * by, y: p.y + d.y * by })
const num = (n: number): string => String(Math.round(n * 100) / 100)
const at = (p: Vec): string => `${num(p.x)} ${num(p.y)}`

/** Half a loop's height, as a share of its nominal length along the side. */
const HALF_HEIGHT = 0.67
/** A loop is a quarter-turn at a time, each a cubic with the true tangents at its ends, which is very close to the curve. */
const QUARTER = Math.PI / 2

/** The cubics of one loop, from `from` along `run`, bulging toward `out`. `step` is the loop's length and `b` half its height. */
function loopCurves(from: Vec, run: Vec, out: Vec, step: number, b: number): string {
  // A trochoid traced by a point outside a rolling circle: with b greater than a it runs backward at the top of each turn.
  const a = step / (2 * Math.PI)
  const world = (s: number, h: number): Vec => along(along(from, run, s), out, h)
  const point = (t: number): Vec => world(step / 2 + a * t - b * Math.sin(t), b * (1 + Math.cos(t)))
  const handle = (t: number, by: number): Vec => {
    const p = point(t)
    return along(along(p, run, by * (a - b * Math.cos(t))), out, by * -b * Math.sin(t))
  }
  let d = ''
  for (let i = 0; i < 4; i++) {
    const t = -Math.PI + i * QUARTER
    d += `C${at(handle(t, QUARTER / 3))} ${at(handle(t + QUARTER, -QUARTER / 3))} ${at(point(t + QUARTER))}`
  }
  return d
}

/** The frame as one closed SVG path, in px from the box's corner; empty for a box too small to hold a loop. */
export function curlyFramePath(width: number, height: number, loop: number): string {
  const b = HALF_HEIGHT * loop
  // A loop stands 2b off its side, so the sides are inset by that to keep the frame inside the box.
  const inset = 2 * b
  const right = width - inset
  const bottom = height - inset
  if (loop <= 0 || right <= inset || bottom <= inset) return ''
  // Clockwise from the top left, each side with the way it runs and the way out of the frame.
  const sides: { from: Vec; length: number; run: Vec; out: Vec }[] = [
    { from: { x: inset, y: inset }, length: right - inset, run: { x: 1, y: 0 }, out: { x: 0, y: -1 } },
    { from: { x: right, y: inset }, length: bottom - inset, run: { x: 0, y: 1 }, out: { x: 1, y: 0 } },
    { from: { x: right, y: bottom }, length: right - inset, run: { x: -1, y: 0 }, out: { x: 0, y: 1 } },
    { from: { x: inset, y: bottom }, length: bottom - inset, run: { x: 0, y: -1 }, out: { x: -1, y: 0 } }
  ]
  let d = `M${at(sides[0].from)}`
  for (const { from, length, run, out } of sides) {
    const count = Math.max(1, Math.round(length / loop))
    const step = length / count
    for (let i = 0; i < count; i++) d += loopCurves(along(from, run, i * step), run, out, step, b)
  }
  return `${d}Z`
}
