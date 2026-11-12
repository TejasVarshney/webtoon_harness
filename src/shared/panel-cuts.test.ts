import { describe, expect, it } from 'vitest'
import { cutPoints, cutStyle, PANEL_CUTS } from '@shared/panel-cuts'
import { PanelCutSchema } from '@shared/schemas'

describe('panel cuts', () => {
  it('offers every cut there is, once', () => {
    expect(PANEL_CUTS.map((c) => c.cut).sort()).toEqual([...PanelCutSchema.options].sort())
  })

  it('cuts a falling top as a polygon over the slope, and the picture 2.5px inside it', () => {
    expect(cutStyle('top-down')).toEqual({
      '--cut': 'polygon(0% 0%, 100% calc(0% + var(--slant)), 100% 100%, 0% 100%)',
      '--cut-inner': 'polygon(calc(0% + 2.5px) calc(0% + 2.5px), calc(100% - 2.5px) calc(0% + var(--slant) + 2.5px), calc(100% - 2.5px) calc(100% - 2.5px), calc(0% + 2.5px) calc(100% - 2.5px))'
    })
  })

  it('leans a side by the slope across, not down', () => {
    expect(cutStyle('left-edge')['--cut']).toBe('polygon(calc(0% + var(--slant)) 0%, 100% 0%, 100% 100%, 0% 100%)')
  })

  it('keeps the automatic wedges as they were', () => {
    expect(cutStyle('left')).toEqual(cutStyle('narrow-right'))
    expect(cutStyle('right')).toEqual(cutStyle('narrow-left'))
    expect(cutStyle('left')['--cut']).toBe('polygon(0% 0%, 100% calc(0% + var(--slant)), 100% calc(100% - var(--slant)), 0% 100%)')
  })

  it('draws a cut for a button', () => {
    expect(cutPoints('top-up', 20, 26, 5)).toBe('0,5 20,0 20,26 0,26')
    expect(cutPoints('lean-left', 20, 26, 5)).toBe('0,0 15,0 20,26 5,26')
  })
})
