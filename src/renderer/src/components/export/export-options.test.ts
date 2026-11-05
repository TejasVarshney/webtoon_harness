import { describe, expect, it } from 'vitest'
import { visibleOptions } from './export-options'

describe('visibleOptions', () => {
  it('webtoon offers image type and resolution', () => {
    expect(visibleOptions('webtoon', 1)).toEqual({ imageType: true, paper: false, resolution: true, combine: false })
  })
  it('long-image offers image type and resolution', () => {
    expect(visibleOptions('long-image', 1)).toEqual({ imageType: true, paper: false, resolution: true, combine: false })
  })
  it('pdf-reading offers resolution only', () => {
    expect(visibleOptions('pdf-reading', 1)).toEqual({ imageType: false, paper: false, resolution: true, combine: false })
  })
  it('pdf-print offers paper and hides resolution', () => {
    expect(visibleOptions('pdf-print', 1)).toEqual({ imageType: false, paper: true, resolution: false, combine: false })
  })
  it('cbz offers resolution only', () => {
    expect(visibleOptions('cbz', 1)).toEqual({ imageType: false, paper: false, resolution: true, combine: false })
  })
  it('combine only with two or more episodes on pdf and cbz', () => {
    for (const p of ['pdf-reading', 'pdf-print', 'cbz'] as const) {
      expect(visibleOptions(p, 1).combine).toBe(false)
      expect(visibleOptions(p, 2).combine).toBe(true)
    }
    for (const p of ['webtoon', 'long-image'] as const) expect(visibleOptions(p, 3).combine).toBe(false)
  })
})
