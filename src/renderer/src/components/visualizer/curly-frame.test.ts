import { describe, expect, it } from 'vitest'
import { curlyFramePath } from './curly-frame'

const curves = (d: string): number => d.match(/C/g)?.length ?? 0

describe('curlyFramePath', () => {
  it('fits whole loops along each side', () => {
    // The inner rectangle is 178 x 78: 18 loops across and 8 down, twice over.
    expect(curves(curlyFramePath(200, 100, 10))).toBe(52)
  })

  it('is one closed path', () => {
    const d = curlyFramePath(200, 100, 10)
    expect(d.startsWith('M')).toBe(true)
    expect(d.endsWith('Z')).toBe(true)
    expect(d).not.toContain('NaN')
  })

  it('keeps loops round on a wide box, by adding more of them', () => {
    expect(curves(curlyFramePath(400, 100, 10))).toBe(2 * (38 + 8))
  })

  it('draws nothing for a box too small to hold a loop', () => {
    expect(curlyFramePath(0, 0, 10)).toBe('')
    expect(curlyFramePath(20, 200, 10)).toBe('')
    expect(curlyFramePath(200, 20, 10)).toBe('')
  })

  it('gives a short side at least one loop', () => {
    expect(curves(curlyFramePath(25, 25, 10))).toBe(4)
  })
})
