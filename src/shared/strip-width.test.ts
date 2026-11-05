import { describe, expect, it } from 'vitest'
import { captureScaleFactor, cssFromPx, EXPORT_PX_WIDTH, STRIP_CSS_WIDTH } from './strip-width'

describe('strip width', () => {
  it('lays the export out at the on-screen row width and outputs 800 px', () => {
    expect(STRIP_CSS_WIDTH).toBe(440)
    expect(EXPORT_PX_WIDTH).toBe(800)
  })

  it('converts output px at scale 1 to whole CSS px, rounding down', () => {
    expect(cssFromPx(1280)).toBe(704)
    expect(cssFromPx(65000)).toBe(35750)
    expect(cssFromPx(32500)).toBe(17875)
    // Print pages round down, so a page's image never overflows the printable height.
    expect(cssFromPx(1177)).toBe(647)
    expect(cssFromPx(1067)).toBe(586)
  })

  it('captures 440 CSS px as 800 device px, or 1600 at High', () => {
    expect(STRIP_CSS_WIDTH * captureScaleFactor(1)).toBeCloseTo(800, 9)
    expect(STRIP_CSS_WIDTH * captureScaleFactor(2)).toBeCloseTo(1600, 9)
    expect(704 * captureScaleFactor(1)).toBeCloseTo(1280, 9)
  })
})
