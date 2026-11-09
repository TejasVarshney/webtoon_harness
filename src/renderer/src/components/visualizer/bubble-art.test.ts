import { describe, expect, it } from 'vitest'
import { spikyRing } from './bubble-art'

describe('spikyRing', () => {
  it('gives two points a spike, inside the box, the same every time', () => {
    const ring = spikyRing(72, 38, 44, 50)
    expect(ring.split(' ')).toHaveLength(144)
    for (const value of ring.split(/[ ,]/).map(Number)) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(100)
    }
    expect(spikyRing(72, 38, 44, 50)).toBe(ring)
  })

  it('varies the length of the spikes, within the range', () => {
    const lengths = spikyRing(72, 38, 44, 50)
      .split(' ')
      .filter((_, i) => i % 2 === 0)
      .map((p) => {
        const [x, y] = p.split(',').map(Number)
        return Math.hypot(x - 50, y - 50)
      })
    expect(new Set(lengths.map((l) => Math.round(l))).size).toBeGreaterThan(3)
    for (const length of lengths) {
      expect(length).toBeGreaterThan(43.8)
      expect(length).toBeLessThan(50.2)
    }
  })

  it('puts the valleys on the inner circle', () => {
    const [x, y] = spikyRing(72, 38, 44, 50).split(' ')[1].split(',').map(Number)
    expect(Math.hypot(x - 50, y - 50)).toBeCloseTo(38, 0)
  })
})
