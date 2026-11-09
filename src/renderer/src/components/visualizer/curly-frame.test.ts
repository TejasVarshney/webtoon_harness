import { describe, expect, it } from 'vitest'
import { curlyFramePath } from './curly-frame'

/** Each curve of the path as [c1x, c1y, c2x, c2y, x, y]. */
const curvesOf = (d: string): number[][] =>
  d
    .slice(1, -1)
    .split('C')
    .slice(1)
    .map((c) => c.split(' ').map(Number))

/** Each loop is drawn as four curves. */
const loops = (d: string): number => curvesOf(d).length / 4

describe('curlyFramePath', () => {
  it('fits whole loops along each side', () => {
    // The inner rectangle is 173.2 x 73.2: 17 loops across and 7 down, twice over.
    expect(loops(curlyFramePath(200, 100, 10))).toBe(48)
  })

  it('is one closed path', () => {
    const d = curlyFramePath(200, 100, 10)
    expect(d.startsWith('M')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
    expect(d).not.toContain('NaN')
  })

  it('keeps loops round on a wide box, by adding more of them', () => {
    expect(loops(curlyFramePath(400, 100, 10))).toBe(2 * (37 + 7))
  })

  it('draws nothing for a box too small to hold a loop', () => {
    expect(curlyFramePath(0, 0, 10)).toBe('')
    expect(curlyFramePath(20, 200, 10)).toBe('')
    expect(curlyFramePath(200, 20, 10)).toBe('')
  })

  it('gives a short side at least one loop', () => {
    expect(loops(curlyFramePath(30, 30, 10))).toBe(4)
  })

  it('runs back on itself at the top of each loop', () => {
    const [up, top, down, on] = curvesOf(curlyFramePath(200, 100, 10))
    expect(top[4]).toBeLessThan(up[4])
    expect(down[4]).toBeLessThan(top[4])
    expect(on[4]).toBeGreaterThan(up[4])
    expect(top[5]).toBeLessThan(up[5])
  })

  it('flows from one loop into the next with no corner', () => {
    const curves = curvesOf(curlyFramePath(200, 100, 10))
    const start = curves[3][5]
    expect(curves[3][3]).toBe(start)
    expect(curves[4][1]).toBe(start)
  })

  it('stays inside its box', () => {
    for (const [width, height] of [[200, 100], [400, 100], [37, 91]]) {
      for (const curve of curvesOf(curlyFramePath(width, height, 10))) {
        expect(curve[4]).toBeGreaterThanOrEqual(0)
        expect(curve[4]).toBeLessThanOrEqual(width)
        expect(curve[5]).toBeGreaterThanOrEqual(0)
        expect(curve[5]).toBeLessThanOrEqual(height)
      }
    }
  })
})
