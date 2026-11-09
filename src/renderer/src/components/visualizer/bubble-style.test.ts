import { describe, expect, it } from 'vitest'
import { bubbleDefaults, bubbleStyleProps, withStyleChange } from './bubble-style'

describe('bubble style', () => {
  it("knows each shape's default look", () => {
    expect(bubbleDefaults('speech')).toEqual({ font: 'comic', size: 1, bold: true, italic: false, caps: true, align: 'center', color: '#111111', fill: '#ffffff', stroke: '#111111', strokeWidth: 2, padding: 1 })
    expect(bubbleDefaults('whisper').bold).toBe(false)
    expect(bubbleDefaults('thought').bold).toBe(false)
    expect(bubbleDefaults('caption').align).toBe('left')
    expect(bubbleDefaults('sfx')).toMatchObject({ font: 'bangers', bold: false, color: '#ffffff' })
  })

  it('draws a burst dark with white lettering', () => {
    expect(bubbleDefaults('burst')).toMatchObject({ fill: '#111111', color: '#ffffff' })
  })

  it('sets nothing for a line with no style', () => {
    expect(bubbleStyleProps(null)).toEqual({})
  })

  it('turns a style into variables and text properties', () => {
    expect(bubbleStyleProps({ size: 1.5, fill: '#ff0000', stroke: '#00ff00', strokeWidth: 5, color: '#0000ff' })).toEqual({
      '--bubble-size': '1.5',
      '--bubble-fill': '#ff0000',
      '--bubble-stroke': '#00ff00',
      '--bubble-stroke-width': '5px',
      '--bubble-color': '#0000ff'
    })
    expect(bubbleStyleProps({ bold: false, italic: true, caps: false, align: 'right' })).toEqual({ fontWeight: 400, fontStyle: 'italic', textTransform: 'none', textAlign: 'right' })
    expect(bubbleStyleProps({ bold: true }).fontWeight).toBe(700)
    expect(bubbleStyleProps({ font: 'impact' }).fontFamily).toContain('Anton')
  })

  it('stores only what differs from the default, and nothing when nothing does', () => {
    const d = bubbleDefaults('speech')
    expect(withStyleChange(null, { bold: false }, d)).toEqual({ bold: false })
    expect(withStyleChange({ bold: false }, { bold: true }, d)).toBeNull()
    expect(withStyleChange({ shape: 'shout', fill: '#ff0000' }, { shape: undefined }, d)).toEqual({ fill: '#ff0000' })
  })

  it('draws a padding as a variable and drops it at the default', () => {
    expect(bubbleStyleProps({ padding: 1.5 })).toEqual({ '--bubble-padding': '1.5' })
    expect(withStyleChange({ padding: 1.5 }, { padding: 1 }, bubbleDefaults('speech'))).toBeNull()
  })

  it('draws a width as a share of the panel, keeps it through other changes, and drops it when cleared', () => {
    const d = bubbleDefaults('speech')
    expect(bubbleStyleProps({ width: 0.42 })).toEqual({ '--bubble-width': '42%' })
    expect(withStyleChange({ width: 0.4 }, { bold: false }, d)).toEqual({ width: 0.4, bold: false })
    expect(withStyleChange({ width: 0.4 }, { width: undefined }, d)).toBeNull()
  })
})
