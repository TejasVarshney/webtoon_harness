import { describe, expect, it } from 'vitest'
import { clampZoom, MAX_ZOOM, MIN_ZOOM, stepZoom } from './use-stage-zoom'
import { isShape, shapeEnd, sketchSize } from './use-sketch-pad'

describe('shapeEnd', () => {
  const start = { x: 100, y: 100 }

  it('ends where the drag ends without Shift', () => {
    expect(shapeEnd('rect', start, { x: 130, y: 180 }, false)).toEqual({ x: 130, y: 180 })
  })

  it('makes a square or a circle as wide as the longer side, in the direction of the drag', () => {
    expect(shapeEnd('rect', start, { x: 130, y: 180 }, true)).toEqual({ x: 180, y: 180 })
    expect(shapeEnd('ellipse', start, { x: 40, y: 120 }, true)).toEqual({ x: 40, y: 160 })
    expect(shapeEnd('rect', start, { x: 100, y: 60 }, true)).toEqual({ x: 140, y: 60 })
  })

  it('snaps a line to the nearest 45 degrees, keeping its length', () => {
    const flat = shapeEnd('line', start, { x: 200, y: 110 }, true)
    expect(flat.x).toBeCloseTo(100 + Math.hypot(100, 10))
    expect(flat.y).toBeCloseTo(100)
    const diagonal = shapeEnd('line', start, { x: 150, y: 160 }, true)
    expect(diagonal.x - start.x).toBeCloseTo(diagonal.y - start.y)
  })
})

describe('isShape', () => {
  it('tells the shape tools from the brushes', () => {
    expect(['pen', 'eraser', 'line', 'rect', 'ellipse'].map((t) => isShape(t as never))).toEqual([false, false, true, true, true])
  })
})

describe('sketchSize', () => {
  it('gives the longer edge 1024 pixels at the panel aspect', () => {
    expect(sketchSize('2:3')).toEqual({ width: 683, height: 1024 })
    expect(sketchSize('16:9')).toEqual({ width: 1024, height: 576 })
    expect(sketchSize('1:1')).toEqual({ width: 1024, height: 1024 })
  })
})

describe('zoom steps', () => {
  it('steps by a quarter, stays within the limits, and lands on the fit when it passes near it', () => {
    expect(stepZoom(1, 1)).toBe(1.25)
    expect(stepZoom(1.25, -1)).toBe(1)
    expect(stepZoom(0.82, 1)).toBe(1)
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM)
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM)
    expect(clampZoom(10)).toBe(MAX_ZOOM)
    expect(clampZoom(0.1)).toBe(MIN_ZOOM)
  })
})
