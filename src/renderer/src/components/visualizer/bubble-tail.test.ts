import { describe, expect, it } from 'vitest'
import type { BubbleShape } from '@shared/types'
import { hasTail, restingTip, tailWedge, thoughtPuffs, type Point } from './bubble-tail'

const box = { width: 200, height: 100 }
const em = 15
const stroke = 2

describe('tailWedge', () => {
  it('puts both root ends on the inner edge of the outline', () => {
    const g = tailWedge({ box, tip: { x: 60, y: 120 }, em, stroke, shape: 'speech' })!
    for (const p of [g.a, g.b]) expect((p.x / 98) ** 2 + (p.y / 48) ** 2).toBeCloseTo(1, 5)
  })
  it('ends at the tip it was given', () => {
    expect(tailWedge({ box, tip: { x: 60, y: 120 }, em, stroke, shape: 'speech' })!.tip).toEqual({ x: 60, y: 120 })
  })
  it('centres the root on the way to the tip', () => {
    const g = tailWedge({ box, tip: { x: 0, y: 120 }, em, stroke, shape: 'speech' })!
    expect(g.a.x).toBeCloseTo(-g.b.x, 5)
    expect(g.a.y).toBeCloseTo(g.b.y, 5)
    expect(g.a.y).toBeGreaterThan(0)
  })
  it('draws nothing while the tip is inside the body', () => {
    expect(tailWedge({ box, tip: { x: 10, y: 10 }, em, stroke, shape: 'speech' })).toBeNull()
  })
  it('keeps a usable root on a short tail, and widens only a little on a long one', () => {
    const width = (tip: Point) => {
      const g = tailWedge({ box, tip, em, stroke, shape: 'speech' })!
      return Math.hypot(g.a.x - g.b.x, g.a.y - g.b.y)
    }
    expect(width({ x: 0, y: 60 })).toBeGreaterThan(em)
    expect(width({ x: 0, y: 400 })).toBeLessThanOrEqual(50)
  })
  it('roots a shout inside its spikes', () => {
    const g = tailWedge({ box, tip: { x: 160, y: 0 }, em, stroke, shape: 'shout' })!
    expect(Math.abs(g.a.x)).toBeLessThan(100 * 0.82)
  })
})

describe('thoughtPuffs', () => {
  it('draws three shrinking puffs, the last on the tip', () => {
    const p = thoughtPuffs({ box, tip: { x: 90, y: 120 }, em })
    expect(p).toHaveLength(3)
    expect(p[0].rx).toBeGreaterThan(p[1].rx)
    expect(p[1].rx).toBeGreaterThan(p[2].rx)
    expect(p[2].cx).toBeCloseTo(90)
    expect(p[2].cy).toBeCloseTo(120)
  })
  it('draws none while the tip is inside the body', () => {
    expect(thoughtPuffs({ box, tip: { x: 10, y: 10 }, em })).toEqual([])
  })
})

describe('restingTip', () => {
  it('rests where the automatic wedge ends', () => {
    expect(restingTip({ box, em, side: 'left', drawing: 'down' }).x).toBeLessThan(0)
    expect(restingTip({ box, em, side: 'right', drawing: 'down' }).x).toBeGreaterThan(0)
    expect(restingTip({ box, em, side: 'center', drawing: 'down' }).x).toBeCloseTo(0)
    expect(restingTip({ box, em, side: 'left', drawing: 'down' }).y).toBeGreaterThan(50)
    expect(restingTip({ box, em, side: 'left', drawing: 'edge' }).y).toBeLessThan(-50)
  })
  it('rests below a bubble with no tail', () => {
    expect(restingTip({ box, em, side: 'left', drawing: 'none' })).toEqual({ x: 0, y: 50 + 1.1 * em })
  })
})

it('gives tails to the four shapes that speak from someone', () => {
  expect(['speech', 'shout', 'whisper', 'thought', 'caption', 'sfx'].map((s) => hasTail(s as BubbleShape))).toEqual([true, true, true, true, false, false])
})
