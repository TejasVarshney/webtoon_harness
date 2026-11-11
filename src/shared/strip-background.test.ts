import { describe, expect, it } from 'vitest'
import { makePanel } from '../main/test/factories'
import { resolveStrip } from './strip-canvas'
import { effectiveBackground, legacyBackground, StripBackgroundSchema, stripBackgroundStyle } from './strip-background'

let next = 0
function panel(o: Parameters<typeof makePanel>[0] = {}) {
  next += 1
  return makePanel({ id: `pnl_${String(next).padStart(10, '0')}`, ...o })
}

describe('stripBackgroundStyle', () => {
  const stops = [
    { color: '#000000', at: 0 },
    { color: '#ffffff', at: 1 }
  ]

  it('paints a solid colour', () => {
    expect(stripBackgroundStyle({ kind: 'solid', color: '#abcdef' }, { imageUrl: null, bottom: 1000 })).toEqual({ backgroundColor: '#abcdef' })
  })

  it('draws a linear gradient over the whole content', () => {
    expect(stripBackgroundStyle({ kind: 'linear', angle: 180, repeatEvery: null, stops }, { imageUrl: null, bottom: 1000 })).toEqual({
      backgroundColor: '#ffffff',
      backgroundImage: 'linear-gradient(180deg, #000000 0%, #ffffff 100%)',
      backgroundSize: '100% 1000px',
      backgroundRepeat: 'no-repeat'
    })
  })

  it('lets the last stop colour continue past the gradient', () => {
    const black = [
      { color: '#ffffff', at: 0 },
      { color: '#000000', at: 1 }
    ]
    expect(stripBackgroundStyle({ kind: 'linear', angle: 180, repeatEvery: null, stops: black }, { imageUrl: null, bottom: 1000 }).backgroundColor).toBe('#000000')
    expect(stripBackgroundStyle({ kind: 'radial', repeatEvery: null, stops: black }, { imageUrl: null, bottom: 1000 }).backgroundColor).toBe('#000000')
    expect(stripBackgroundStyle({ kind: 'conic', angle: 0, repeatEvery: null, stops: black }, { imageUrl: null, bottom: 1000 }).backgroundColor).toBe('#000000')
  })

  it('repeats a gradient when asked', () => {
    expect(stripBackgroundStyle({ kind: 'linear', angle: 90, repeatEvery: 400, stops }, { imageUrl: null, bottom: 1000 })).toMatchObject({
      backgroundSize: '100% 400px',
      backgroundRepeat: 'repeat-y'
    })
  })

  it('draws radial and conic gradients', () => {
    expect(stripBackgroundStyle({ kind: 'radial', repeatEvery: null, stops }, { imageUrl: null, bottom: 500 }).backgroundImage).toBe('radial-gradient(#000000 0%, #ffffff 100%)')
    expect(stripBackgroundStyle({ kind: 'conic', angle: 45, repeatEvery: null, stops }, { imageUrl: null, bottom: 500 }).backgroundImage).toBe('conic-gradient(from 45deg, #000000 0%, #ffffff 100%)')
  })

  it('tints an image by its opacity', () => {
    expect(stripBackgroundStyle({ kind: 'image', path: 'x', fit: 'width', opacity: 0.5, color: '#112233' }, { imageUrl: 'asset://x', bottom: 900 }).backgroundImage).toBe(
      'linear-gradient(#11223380, #11223380), url("asset://x")'
    )
  })

  it('sizes an image by its fit', () => {
    const at = { imageUrl: 'asset://x', bottom: 900 }
    const image = (fit: 'width' | 'tile' | 'stretch') => stripBackgroundStyle({ kind: 'image', path: 'x', fit, opacity: 1, color: '#ffffff' }, at)
    expect(image('width')).toMatchObject({ backgroundSize: '100% auto', backgroundRepeat: 'repeat-y', backgroundColor: '#ffffff' })
    expect(image('tile')).toMatchObject({ backgroundSize: 'auto', backgroundRepeat: 'repeat' })
    expect(image('stretch')).toMatchObject({ backgroundSize: '100% 900px', backgroundRepeat: 'no-repeat' })
  })

  it('shows only the colour while an image has no URL', () => {
    expect(stripBackgroundStyle({ kind: 'image', path: 'x', fit: 'width', opacity: 1, color: '#123456' }, { imageUrl: null, bottom: 900 })).toEqual({ backgroundColor: '#123456' })
  })
})

describe('legacyBackground', () => {
  it('an old all-white episode stays white', () => {
    expect(legacyBackground(resolveStrip([panel({ aspect: '1:1' }), panel({ aspect: '1:1' })]))).toEqual({ kind: 'solid', color: '#ffffff' })
    expect(legacyBackground([])).toEqual({ kind: 'solid', color: '#ffffff' })
  })

  it('an old episode keeps its black bands', () => {
    const bg = legacyBackground(resolveStrip([panel({ aspect: '1:1', gutter: 'white' }), panel({ aspect: '1:1', gutter: 'black' })]))
    expect(bg).toEqual({
      kind: 'linear',
      angle: 180,
      repeatEvery: null,
      stops: [
        { color: '#ffffff', at: 0 },
        { color: '#ffffff', at: 488 / 928 },
        { color: '#000000', at: 488 / 928 },
        { color: '#000000', at: 1 }
      ]
    })
  })

  it('a row of panels takes the gutter of its last panel', () => {
    const bg = legacyBackground(resolveStrip([panel({ aspect: '1:1', gutter: 'black' }), panel({ aspect: '1:1', beside: true, gutter: 'white' })]))
    expect(bg).toEqual({ kind: 'solid', color: '#ffffff' })
  })

  it('reads each placed panel own gutter', () => {
    const bg = legacyBackground(
      resolveStrip([
        panel({ aspect: '1:1', gutter: 'black', placement: { x: 0, y: 0, width: 200 } }),
        panel({ aspect: '1:1', gutter: 'white', placement: { x: 0, y: 500, width: 200 } })
      ])
    )
    expect(bg).toMatchObject({ kind: 'linear', stops: [{ color: '#000000', at: 0 }, { color: '#000000', at: 500 / 700 }, { color: '#ffffff', at: 500 / 700 }, { color: '#ffffff', at: 1 }] })
  })
})

describe('effectiveBackground', () => {
  it('keeps a stored background and reads the old gutters otherwise', () => {
    const placed = resolveStrip([panel({ gutter: 'black' })])
    const stored = { kind: 'solid' as const, color: '#123456' }
    expect(effectiveBackground(stored, placed)).toBe(stored)
    expect(effectiveBackground(null, placed)).toEqual({ kind: 'solid', color: '#000000' })
  })
})

describe('StripBackgroundSchema', () => {
  it('fills the defaults and refuses a bad colour or a lone stop', () => {
    expect(StripBackgroundSchema.parse({ kind: 'image', path: 'episode-backgrounds/epi_1/p.png' })).toEqual({ kind: 'image', path: 'episode-backgrounds/epi_1/p.png', fit: 'width', opacity: 1, color: '#ffffff' })
    for (const path of ['characters/x.png', 'episode-backgrounds/epi_1/../x.png', 'episode-backgrounds/x.png', '/episode-backgrounds/epi_1/x.png']) {
      expect(StripBackgroundSchema.safeParse({ kind: 'image', path }).success).toBe(false)
    }
    expect(StripBackgroundSchema.safeParse({ kind: 'solid', color: 'red' }).success).toBe(false)
    expect(StripBackgroundSchema.safeParse({ kind: 'linear', stops: [{ color: '#000000', at: 0 }] }).success).toBe(false)
    expect(StripBackgroundSchema.safeParse({ kind: 'linear', stops: [{ color: '#000000', at: 0 }, { color: '#ffffff', at: 2 }] }).success).toBe(false)
  })
})
