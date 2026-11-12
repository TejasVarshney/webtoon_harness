import { describe, expect, it } from 'vitest'
import { centred, clampAxis, fitSize, panBy, zoomAt } from './paper-view'

// A 600 by 400 frame and a 2:3 paper: at the fit the paper is 400 high and 266.67 wide, with room on either side.
const FRAME = { width: 600, height: 400 }
const RATIO = 2 / 3

describe('paper view', () => {
  it('fits the paper to the frame at its aspect', () => {
    expect(fitSize(FRAME, RATIO).height).toBeCloseTo(400, 5)
    expect(fitSize(FRAME, RATIO).width).toBeCloseTo(266.67, 1)
    expect(fitSize({ width: 300, height: 400 }, 1)).toEqual({ width: 300, height: 300 })
    expect(fitSize({ width: 0, height: 400 }, 1)).toEqual({ width: 0, height: 0 })
  })

  it('lets the paper go past the frame until a quarter of it, or of the frame, is left in view', () => {
    // A 200 paper in a 600 frame keeps 50 in view: from -150 to 550.
    expect(clampAxis(-500, 200, 600)).toBe(-150)
    expect(clampAxis(900, 200, 600)).toBe(550)
    expect(clampAxis(150, 200, 600)).toBe(150)
    // A 900 paper in a 600 frame keeps 150 in view: from -750 to 450.
    expect(clampAxis(-2000, 900, 600)).toBe(-750)
    expect(clampAxis(2000, 900, 600)).toBe(450)
    // An empty frame has nothing to keep in view, and puts nothing out of it.
    expect(clampAxis(30, 0, 0)).toBe(0)
  })

  it('moves a paper that fits sideways and up and down, past the edges, but always partly in the frame', () => {
    const start = centred(1, FRAME, RATIO)
    expect(start.x).toBeCloseTo(166.67, 1)
    expect(start.y).toBeCloseTo(0, 5)
    expect(panBy(start, -100, 0, FRAME, RATIO).x).toBeCloseTo(66.67, 1)
    // 266.67 wide: a quarter, 66.67, stays in view.
    const far = panBy(start, -1000, -1000, FRAME, RATIO)
    expect(far.x).toBeCloseTo(-200, 1)
    expect(far.y).toBeCloseTo(-300, 1)
    const other = panBy(start, 1000, 1000, FRAME, RATIO)
    expect(other.x).toBeCloseTo(533.33, 1)
    expect(other.y).toBeCloseTo(300, 1)
  })

  it('moves a zoomed-out paper both ways, past the edges', () => {
    const small = centred(0.5, FRAME, RATIO)
    expect(small.y).toBeCloseTo(100, 5)
    expect(panBy(small, 0, -60, FRAME, RATIO).y).toBeCloseTo(40, 5)
    // 200 high: 50 stays in view.
    expect(panBy(small, 0, -600, FRAME, RATIO).y).toBeCloseTo(-150, 5)
  })

  it('zooms at a point, keeping that point of the paper under it, and keeps the paper over the frame', () => {
    const start = centred(1, FRAME, RATIO)
    const at = { x: 300, y: 200 }
    const zoomed = zoomAt(start, 2, at, FRAME, RATIO)
    // The paper point at the frame's middle stays at the middle.
    expect((at.x - zoomed.x) / 2).toBeCloseTo(at.x - start.x, 5)
    expect((at.y - zoomed.y) / 2).toBeCloseTo(at.y - start.y, 5)
    // Zoomed out a long way from a corner, the paper is still partly in view.
    const tiny = zoomAt(start, 0.5, { x: 0, y: 0 }, FRAME, RATIO)
    expect(tiny.x).toBeLessThan(FRAME.width)
    expect(tiny.y).toBeLessThan(FRAME.height)
  })
})
