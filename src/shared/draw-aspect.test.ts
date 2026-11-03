import { describe, expect, it } from 'vitest'
import { drawAspect, isTallAspect } from '@shared/draw-aspect'
import { DrawAspectSchema, PanelAspectSchema } from '@shared/schemas'

describe('drawAspect', () => {
  it('draws the tall aspects at 9:16', () => {
    expect(drawAspect('1:2')).toBe('9:16')
    expect(drawAspect('1:3')).toBe('9:16')
  })

  it('keeps every other aspect as it is', () => {
    for (const aspect of DrawAspectSchema.options) expect(drawAspect(aspect)).toBe(aspect)
  })

  it('only ever returns an aspect a model can draw', () => {
    for (const aspect of PanelAspectSchema.options) expect(DrawAspectSchema.options).toContain(drawAspect(aspect))
  })
})

describe('isTallAspect', () => {
  it('is true only for 1:2 and 1:3', () => {
    expect(PanelAspectSchema.options.filter(isTallAspect)).toEqual(['1:2', '1:3'])
  })
})
