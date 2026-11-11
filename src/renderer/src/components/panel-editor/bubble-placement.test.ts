import { describe, expect, it } from 'vitest'
import { addSpot, centreOf, fitScale, nudgePlacement, placementFromPointer } from './bubble-placement'

const panel = { left: 0, top: 0, width: 400, height: 600 }
const bubble = { width: 100, height: 50 }
const grab = { dx: 0, dy: 0 }

describe('addSpot', () => {
  it('gives 15 new bubbles in a row 15 different spots inside the panel', () => {
    const spots = Array.from({ length: 15 }, (_, count) => addSpot(count))
    expect(new Set(spots.map((s) => `${s.x},${s.y}`)).size).toBe(15)
    for (const s of spots) {
      expect(s.x).toBeGreaterThan(0)
      expect(s.x).toBeLessThan(1)
      expect(s.y).toBeGreaterThan(0)
      expect(s.y).toBeLessThan(1)
    }
  })

  it('goes across three columns, then down a row, and starts over after the fifth row', () => {
    expect(addSpot(0)).toEqual({ x: 0.3, y: 0.2 })
    expect(addSpot(2)).toEqual({ x: 0.7, y: 0.2 })
    expect(addSpot(3)).toEqual({ x: 0.3, y: 0.35 })
    expect(addSpot(14)).toEqual({ x: 0.7, y: 0.8 })
    expect(addSpot(15)).toEqual(addSpot(0))
  })
})

describe('placementFromPointer', () => {
  it('puts the centre where the pointer is', () => {
    expect(placementFromPointer({ pointer: { x: 200, y: 300 }, grab, panel, bubble })).toEqual({ x: 0.5, y: 0.5 })
  })

  it('does not depend on the stage scale or position', () => {
    const scaled = { left: 1000, top: 200, width: 800, height: 1200 }
    const big = { width: 200, height: 100 }
    expect(placementFromPointer({ pointer: { x: 1400, y: 800 }, grab, panel: scaled, bubble: big })).toEqual({ x: 0.5, y: 0.5 })
  })

  it('keeps the grab offset, so the bubble does not jump to the pointer', () => {
    const p = placementFromPointer({ pointer: { x: 240, y: 330 }, grab: { dx: 40, dy: 30 }, panel, bubble })
    expect(p).toEqual({ x: 0.5, y: 0.5 })
  })

  it('clamps so the whole bubble stays inside the panel', () => {
    const p = placementFromPointer({ pointer: { x: 0, y: 0 }, grab, panel, bubble })
    expect(p.x).toBe(0.125)
    expect(p.y).toBeCloseTo(50 / 1200, 4)
    const q = placementFromPointer({ pointer: { x: 999, y: 999 }, grab, panel, bubble })
    expect(q.x).toBe(0.875)
    expect(q.y).toBeCloseTo(1 - 50 / 1200, 4)
  })

  it('centres an axis the bubble is too big for', () => {
    const wide = { width: 500, height: 50 }
    expect(placementFromPointer({ pointer: { x: 10, y: 300 }, grab, panel, bubble: wide }).x).toBe(0.5)
    const tall = { width: 100, height: 700 }
    expect(placementFromPointer({ pointer: { x: 200, y: 10 }, grab, panel, bubble: tall }).y).toBe(0.5)
  })

  it('rounds to four decimals', () => {
    const p = placementFromPointer({ pointer: { x: 400 / 3, y: 300 }, grab, panel, bubble })
    expect(p.x).toBe(0.3333)
  })
})

describe('placementFromPointer with bounds', () => {
  const small = { width: 40, height: 20 }
  const own = { left: 0, top: 0, width: 200, height: 200 }
  const strip = { left: 0, top: 0, width: 440, height: 5000 }

  it('with bounds a bubble can leave its panel', () => {
    expect(placementFromPointer({ pointer: { x: 100, y: 900 }, grab, panel: own, bubble: small, bounds: strip })).toEqual({ x: 0.5, y: 4.5 })
  })

  it('with bounds it stays inside the strip', () => {
    // The right edge stops at 440, so the centre is at 420: 2.1 panel widths.
    expect(placementFromPointer({ pointer: { x: 900, y: 50 }, grab, panel: own, bubble: small, bounds: strip })).toEqual({ x: 2.1, y: 0.25 })
    expect(placementFromPointer({ pointer: { x: -300, y: 50 }, grab, panel: own, bubble: small, bounds: strip }).x).toBe(0.1)
  })

  it('with bounds it stays below the top of the strip', () => {
    expect(placementFromPointer({ pointer: { x: 100, y: -300 }, grab, panel: { ...own, top: 100 }, bubble: small, bounds: strip }).y).toBe(-0.45)
  })

  it('without bounds it stays inside the panel', () => {
    expect(placementFromPointer({ pointer: { x: 900, y: 900 }, grab, panel: own, bubble: small })).toEqual({ x: 0.9, y: 0.95 })
  })
})

describe('nudgePlacement with bounds', () => {
  const own = { left: 0, top: 0, width: 200, height: 200 }
  const strip = { left: 0, top: 0, width: 440, height: 5000 }

  it('a bubble off its panel keeps its place when nudged', () => {
    expect(nudgePlacement({ x: 1.5, y: 3 }, 'ArrowRight', false, { x: 0.1, y: 0.05 }, strip, own)).toEqual({ x: 1.51, y: 3 })
  })

  it('stops at the strip edge', () => {
    expect(nudgePlacement({ x: 2.1, y: 3 }, 'ArrowRight', true, { x: 0.1, y: 0.05 }, strip, own)).toEqual({ x: 2.1, y: 3 })
  })
})

describe('nudgePlacement', () => {
  const half = { x: 0.1, y: 0.1 }

  it('moves by one percent, or five with big', () => {
    expect(nudgePlacement({ x: 0.5, y: 0.5 }, 'ArrowRight', false, half)).toEqual({ x: 0.51, y: 0.5 })
    expect(nudgePlacement({ x: 0.5, y: 0.5 }, 'ArrowRight', true, half)).toEqual({ x: 0.55, y: 0.5 })
    expect(nudgePlacement({ x: 0.5, y: 0.5 }, 'ArrowLeft', false, half)).toEqual({ x: 0.49, y: 0.5 })
    expect(nudgePlacement({ x: 0.5, y: 0.5 }, 'ArrowUp', false, half)).toEqual({ x: 0.5, y: 0.49 })
    expect(nudgePlacement({ x: 0.5, y: 0.5 }, 'ArrowDown', true, half)).toEqual({ x: 0.5, y: 0.55 })
  })

  it('stops at the edge of the panel', () => {
    expect(nudgePlacement({ x: 0.89, y: 0.5 }, 'ArrowRight', false, half).x).toBe(0.9)
    expect(nudgePlacement({ x: 0.5, y: 0.11 }, 'ArrowUp', true, half).y).toBe(0.1)
  })
})

describe('centreOf', () => {
  it('is the bubble box centre as fractions of the panel', () => {
    const scaled = { left: 1000, top: 200, width: 800, height: 1200 }
    expect(centreOf({ left: 1100, top: 300, width: 200, height: 100 }, scaled)).toEqual({ x: 0.25, y: 0.125 })
  })
})

describe('fitScale', () => {
  it('is the scale that fits both sides', () => {
    expect(fitScale({ width: 800, height: 600 }, { width: 400, height: 600 })).toBe(1)
    expect(fitScale({ width: 200, height: 600 }, { width: 400, height: 600 })).toBe(0.5)
  })

  it('is 1 when the natural size is empty', () => {
    expect(fitScale({ width: 800, height: 600 }, { width: 0, height: 0 })).toBe(1)
    expect(fitScale({ width: 800, height: 600 }, { width: 400, height: 0 })).toBe(1)
  })
})
