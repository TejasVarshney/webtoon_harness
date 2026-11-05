import { describe, expect, it } from 'vitest'
import { longImagePartHeight, pageHeightCss, planSlices, printPageHeightCss } from './slice-plan'

describe('planSlices', () => {
  it('cuts anywhere into page-height slices with a short last one', () => {
    expect(planSlices({ totalHeight: 2985, rows: [], pageHeight: 1280, breaks: 'anywhere' })).toEqual([
      { top: 0, height: 1280 },
      { top: 1280, height: 1280 },
      { top: 2560, height: 425 }
    ])
  })

  it('breaks between rows, packing rows that fit', () => {
    const rows = [
      { top: 0, bottom: 500 },
      { top: 500, bottom: 1100 },
      { top: 1100, bottom: 1900 }
    ]
    expect(planSlices({ totalHeight: 1900, rows, pageHeight: 1280, breaks: 'rows' })).toEqual([
      { top: 0, height: 1100 },
      { top: 1100, height: 800 }
    ])
  })

  it('cuts a row taller than the page anywhere inside it', () => {
    const slices = planSlices({ totalHeight: 3000, rows: [{ top: 0, bottom: 3000 }], pageHeight: 1280, breaks: 'rows' })
    expect(slices.map((s) => s.height)).toEqual([1280, 1280, 440])
    expect(slices.map((s) => s.top)).toEqual([0, 1280, 2560])
  })

  it('returns no slices for an empty strip', () => {
    expect(planSlices({ totalHeight: 0, rows: [], pageHeight: 1280, breaks: 'anywhere' })).toEqual([])
    expect(planSlices({ totalHeight: 0, rows: [], pageHeight: 1280, breaks: 'rows' })).toEqual([])
  })

  it('splits a long image into parts of at most 65,000 output px, in CSS px of the 440 px view', () => {
    // 65000 / scale output px, at 440 / 800 CSS px per output px.
    expect(longImagePartHeight(1)).toBe(35750)
    const pageHeight = longImagePartHeight(2)
    expect(pageHeight).toBe(17875)
    const slices = planSlices({ totalHeight: 40000, rows: [], pageHeight, breaks: 'anywhere' })
    expect(slices).toHaveLength(3)
    expect(Math.max(...slices.map((s) => s.height))).toBeLessThanOrEqual(17875)
    expect(slices.reduce((sum, s) => sum + s.height, 0)).toBe(40000)
  })

  it('gives every page height in whole CSS px of the 440 px view', () => {
    expect(pageHeightCss('webtoon')).toBe(704)
    expect(pageHeightCss('pdf-reading')).toBe(704)
    expect(pageHeightCss('cbz')).toBe(704)
    expect(printPageHeightCss('a4')).toBe(647)
    expect(printPageHeightCss('letter')).toBe(586)
  })
})
