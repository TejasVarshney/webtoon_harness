// A frame whose edge is a chain of small loops. It is built for the box it goes on, in px, and never stretched: a
// stretched loop is an oval, so a longer side gets more loops instead of wider ones.

type Vec = { x: number; y: number }

const along = (p: Vec, d: Vec, by: number): Vec => ({ x: p.x + d.x * by, y: p.y + d.y * by })
const num = (n: number): string => String(Math.round(n * 100) / 100)
const at = (p: Vec): string => `${num(p.x)} ${num(p.y)}`

/** How far a loop reaches past its side, as a share of its length: `.bubble-body` is the box, so the frame is inset by it. */
const INSET = 1.1
/** How far a loop's control points stand off the side, and how far they overshoot its ends, which is what makes it cross itself. */
const REACH = 1.4
const OVERSHOOT = 0.2

/** The frame as one closed SVG path, in px from the box's corner; empty for a box too small to hold a loop. */
export function curlyFramePath(width: number, height: number, loop: number): string {
  const inset = loop * INSET
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
    for (let i = 0; i < count; i++) {
      const p = along(from, run, i * step)
      const q = along(p, run, step)
      const ahead = along(along(q, out, REACH * step), run, OVERSHOOT * step)
      const behind = along(along(p, out, REACH * step), run, -OVERSHOOT * step)
      d += `C${at(ahead)} ${at(behind)} ${at(q)}`
    }
  }
  return `${d}Z`
}
