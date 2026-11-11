import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StripBackground } from '@shared/strip-background'
import { STRIP_CSS_WIDTH } from '@shared/strip-width'
import type { DialogueLine, ExportSnapshot } from '@shared/types'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialCharactersState, useCharactersStore } from '../../stores/characters-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { PROJECT_ID as projectId, character } from '../../test/character-fixtures'
import { EPISODE_ID, episode, panel, panelVersion } from '../../test/panel-fixtures'
import { ExportView } from './ExportView'
import { waitForPaintAndMeasure } from './measure'

const line: DialogueLine = { id: 'dlg_0000000001', kind: 'speech', speakerId: null, text: 'Hello there', placement: null } as DialogueLine

const done = panel({ id: 'pnl_00000000aa', dialogue: [line], gutter: 'black', gapAfter: 'long' })
const unfinished = panel({ id: 'pnl_00000000bb', versions: [], currentVersionId: null })
const failing = panel({
  id: 'pnl_00000000cc',
  versions: [panelVersion({ id: 'ver_0000000009', status: 'failed', error: 'boom', imagePath: null })],
  currentVersionId: null
})
const second = panel({ id: 'pnl_00000000dd', gutter: 'black', gapAfter: 'tight' })
// Placed panels: `low` ends at 600, `high` at 200, and the unfinished `farBelow` at 1100.
const low = panel({ id: 'pnl_00000000ee', aspect: '1:1', placement: { x: 0, y: 500, width: 100 } })
const high = panel({ id: 'pnl_00000000ff', aspect: '1:1', placement: { x: 0, y: 0, width: 200 } })
const farBelow = panel({ id: 'pnl_00000000gg', aspect: '1:1', versions: [], currentVersionId: null, placement: { x: 0, y: 900, width: 200 } })

function snapshot(o: Partial<ExportSnapshot> = {}): ExportSnapshot {
  return { projectId, episode: episode(), panels: [done, unfinished, second], characters: [character()], lettering: true, ...o }
}

const canvasOf = (container: HTMLElement): HTMLElement | null => container.querySelector<HTMLElement>('.strip-canvas')

beforeEach(() => {
  // The export window has no preload: window.api does not exist, so any call through it throws.
  Reflect.deleteProperty(window, 'api')
  useAppStore.setState({ ...initialAppState, projectId })
  usePanelsStore.setState({ ...initialPanelsState })
  useCharactersStore.setState({ ...initialCharactersState, projectId, characters: [character()], loaded: true })
})

afterEach(() => {
  document.body.style.background = ''
  document.documentElement.style.removeProperty('--export-strip-width')
})

/** A stylesheet's text, whitespace collapsed. The web tsconfig has no node types, and a ?raw import of CSS comes back empty under vitest. */
async function cssOf(file: string): Promise<string> {
  const specifier: string = 'node:fs'
  const fs = (await import(/* @vite-ignore */ specifier)) as { readFileSync(file: string, encoding: 'utf8'): string }
  return fs.readFileSync(file, 'utf8').replace(/\s+/g, ' ')
}

describe('ExportView', () => {
  it('draws no add-panel, status, Retry or No image yet', () => {
    const { container } = render(<ExportView snapshot={snapshot({ panels: [done, unfinished, failing, second] })} />)
    expect(container.querySelector('.insert-panel')).toBeNull()
    expect(container.querySelector('.panel-empty')).toBeNull()
    expect(screen.queryByTestId('panel-status')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText('No image yet')).toBeNull()
    expect(container.querySelector('.panel-tools')).toBeNull()
    expect(screen.queryByTestId('add-panel')).toBeNull()
    const card = screen.getAllByTestId('panel-card')[0]
    expect(card.hasAttribute('tabindex')).toBe(false)
    expect(card.getAttribute('data-selected')).toBeNull()
  })

  it('draws no bubbles when lettering is off and draws them when on', () => {
    const on = render(<ExportView snapshot={snapshot()} />)
    expect(on.container.querySelectorAll('.bubble').length).toBeGreaterThan(0)
    on.unmount()
    const off = render(<ExportView snapshot={snapshot({ lettering: false })} />)
    expect(off.container.querySelectorAll('.bubble').length).toBe(0)
    expect(off.container.querySelector('.dialogue-overlay')).toBeNull()
    expect(off.container.querySelector('.strip-bubbles')).toBeNull()
  })

  it('leaves unfinished panels out and numbers the rest by their place in the episode', () => {
    render(<ExportView snapshot={snapshot()} />)
    const cards = screen.getAllByTestId('panel-card')
    expect(cards.map((c) => c.getAttribute('data-panel-id'))).toEqual([done.id, second.id])
    // The position is the panel's place in the full list, unfinished ones counted.
    expect(cards.map((c) => c.getAttribute('data-position'))).toEqual(['1', '3'])
  })

  it('sizes the strip to the last panel and hides what is below', () => {
    const canvas = canvasOf(render(<ExportView snapshot={snapshot({ panels: [low, high, farBelow] })} />).container)
    expect(canvas?.style.height).toBe('600px')
    expect(canvas?.style.overflow).toBe('hidden')
    expect(canvas?.style.width).toBe(`${STRIP_CSS_WIDTH}px`)
    expect(screen.getAllByTestId('panel-card')).toHaveLength(2)
  })

  it('paints the episode background', () => {
    const background: StripBackground = { kind: 'solid', color: '#123456' }
    const canvas = canvasOf(render(<ExportView snapshot={snapshot({ episode: episode({ background }), panels: [low] })} />).container)
    expect(canvas?.style.backgroundColor).toBe('rgb(18, 52, 86)')
  })

  it('paints a background image from the project, as the screen does', () => {
    const background: StripBackground = { kind: 'image', path: `episode-backgrounds/${EPISODE_ID}/x.png`, fit: 'width', opacity: 1, color: '#ffffff' }
    const canvas = canvasOf(render(<ExportView snapshot={snapshot({ episode: episode({ background }), panels: [low] })} />).container)
    expect(canvas?.style.backgroundImage).toContain(`webtoon-asset://${projectId}/episode-backgrounds/${EPISODE_ID}/x.png`)
  })

  it('a gradient spans the on-screen content, not the crop', () => {
    const background: StripBackground = {
      kind: 'linear',
      angle: 180,
      repeatEvery: null,
      stops: [
        { color: '#000000', at: 0 },
        { color: '#ffffff', at: 1 }
      ]
    }
    const canvas = canvasOf(render(<ExportView snapshot={snapshot({ episode: episode({ background }), panels: [low, high, farBelow] })} />).container)
    // The unfinished panel ends at 1100: the gradient runs that far, though the output stops at 600.
    expect(canvas?.style.height).toBe('600px')
    expect(canvas?.style.backgroundSize).toBe('100% 1100px')
  })

  it('without a stored background the old gutters still paint it, as on screen', () => {
    const black = { ...low, gutter: 'black' as const }
    const canvas = canvasOf(render(<ExportView snapshot={snapshot({ panels: [black] })} />).container)
    expect(canvas?.style.backgroundColor).toBe('rgb(0, 0, 0)')
  })

  it("paints the page with the canvas's colour, so a fractional bottom leaves no light line under a dark background", () => {
    const background: StripBackground = { kind: 'solid', color: '#101820' }
    render(<ExportView snapshot={snapshot({ episode: episode({ background }), panels: [low] })} />)
    expect(document.body.style.background).toBe('rgb(16, 24, 32)')
  })

  it('letters the bubbles over the cards where they are on screen, and a bubble below the last panel is cut off', () => {
    const below = { ...line, id: 'dlg_0000000002', text: 'Down here', placement: { x: 0.5, y: 3 } } as DialogueLine
    const lettered = { ...low, dialogue: [line, below] }
    const { container } = render(<ExportView snapshot={snapshot({ panels: [lettered] })} />)
    const layer = container.querySelector<HTMLElement>('.strip-bubbles')
    expect(layer?.style.top).toBe('500px')
    expect(layer?.style.left).toBe('0px')
    // Three panel heights below its panel's top, so well past the strip's end: drawn, then cut by the canvas.
    const placed = [...container.querySelectorAll<HTMLElement>('.bubble-placed')]
    expect(placed.map((b) => b.style.top)).toEqual(['300%'])
    expect(canvasOf(container)?.style.overflow).toBe('hidden')
    // The lettering is the strip's layer, not the card's.
    expect(container.querySelector('.panel-card .bubble')).toBeNull()
  })

  it('draws the bubbles of finished panels only', () => {
    const unfinishedLettered = { ...farBelow, dialogue: [{ ...line, id: 'dlg_0000000003', text: 'Unseen' } as DialogueLine] }
    render(<ExportView snapshot={snapshot({ panels: [{ ...low, dialogue: [line] }, unfinishedLettered] })} />)
    expect(screen.getByText('Hello there')).toBeInTheDocument()
    expect(screen.queryByText('Unseen')).toBeNull()
  })

  it('keeps a bubble inside the strip width, as on screen', () => {
    const far = { ...line, placement: { x: 40, y: 0.5 } } as DialogueLine
    // A 100 px wide panel at the left edge: the strip's right edge is 4.4 panel widths from the panel's left.
    const { container } = render(<ExportView snapshot={snapshot({ panels: [{ ...low, dialogue: [far] }] })} />)
    expect(parseFloat(container.querySelector<HTMLElement>('.bubble-placed')?.style.left ?? '')).toBeCloseTo(440, 6)
  })

  it('never calls window.api', () => {
    let reads = 0
    Object.defineProperty(window, 'api', {
      configurable: true,
      get() {
        reads += 1
        throw new Error('window.api must not be touched')
      }
    })
    try {
      const spoken = { ...done, dialogue: [{ ...line, speakerId: 'chr_0000000001' }] }
      render(<ExportView snapshot={snapshot({ panels: [spoken] })} />)
    } finally {
      Reflect.deleteProperty(window, 'api')
    }
    expect(reads).toBe(0)
  })

  it('lays the strip out at the on-screen strip width, 440 CSS px', async () => {
    render(<ExportView snapshot={snapshot()} />)
    expect(document.documentElement.style.getPropertyValue('--export-strip-width')).toBe(`${STRIP_CSS_WIDTH}px`)
    expect(STRIP_CSS_WIDTH).toBe(440)
    // styles.css is the source of truth on screen: the canvas is that wide.
    const app = await cssOf('src/renderer/src/styles.css')
    expect(app).toMatch(new RegExp(String.raw`\.strip-canvas \{[^}]*width: ${STRIP_CSS_WIDTH}px[^}]*container-type: inline-size`))
  })

  it('the export stylesheet makes the page that width and has no bands or gutters', async () => {
    const css = await cssOf('src/renderer/src/export.css')
    expect(css).toMatch(/html, body \{[^}]*width: var\(--export-strip-width\)[^}]*overflow: hidden[^}]*background: #fff/)
    expect(css).toMatch(/html, body, #root \{ height: auto; \}/)
    expect(css).not.toMatch(/strip-band|strip-row|strip-gap|webtoon-strip/)
  })
})

describe('waitForPaintAndMeasure', () => {
  function strip(): HTMLElement {
    const root = document.createElement('div')
    root.innerHTML =
      '<div class="strip-canvas"><article class="panel-card" data-position="1"><img></article><article class="panel-card" data-position="4"><img></article><article class="panel-card" data-position="5"><img></article></div>'
    // Document-relative [top, bottom] of each card, in fractional CSS px as layout gives them. The second overlaps the
    // first, so they are one band; the third starts below it.
    const geometry = [
      [0, 100.2],
      [60, 140],
      [150.5, 151.5]
    ]
    // The page is scrolled 20 px, so each rect is 20 px above its document position: measuring adds scrollY back.
    const scrollY = 20
    const rect = (top: number, bottom: number): DOMRect =>
      ({ top: top - scrollY, bottom: bottom - scrollY, height: bottom - top, left: 0, right: 800, width: 800, x: 0, y: top - scrollY }) as DOMRect
    root.querySelectorAll<HTMLElement>('.panel-card').forEach((card, i) => {
      card.getBoundingClientRect = () => rect(geometry[i][0], geometry[i][1])
    })
    // jsdom loads nothing: an <img> counts as still loading, so only decode() decides.
    root.querySelectorAll('img').forEach((img) => Object.defineProperty(img, 'complete', { value: false }))
    // The strip ends at 151.5 px. A short strip leaves the document as tall as the 1280 px viewport, which must not count.
    root.getBoundingClientRect = () => rect(0, 151.5)
    Object.defineProperty(window, 'scrollY', { configurable: true, value: scrollY })
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 1280 })
    return root
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    Reflect.deleteProperty(document.documentElement, 'scrollHeight')
    Reflect.deleteProperty(window, 'scrollY')
  })

  it('measures each band of panels (top down, bottom up) after decoding every image, and ends at the strip, not the viewport', async () => {
    const root = strip()
    for (const img of root.querySelectorAll('img')) img.decode = () => Promise.resolve()
    expect(await waitForPaintAndMeasure(root)).toEqual({
      totalHeight: 152,
      rows: [
        { top: 0, bottom: 140 },
        { top: 150, bottom: 152 }
      ]
    })
    // Padded to the whole pixel it reports, so the page scrolls all the way to the last slice's top.
    expect(root.style.minHeight).toBe('152px')
  })

  it('cuts no bubble: one that bridges two bands joins them, and one hanging below a panel extends its band', async () => {
    const root = strip()
    for (const img of root.querySelectorAll('img')) img.decode = () => Promise.resolve()
    // Cards: [0, 100.2], [60, 140] (one band) and [150.5, 151.5]. A bubble from 130 to 155 bridges them (and ends past
    // the strip's 151.5, so it is clipped to it); one from 99 to 112 sits inside the first band.
    const rect = (top: number, bottom: number): DOMRect => ({ top: top - 20, bottom: bottom - 20, height: bottom - top, left: 0, right: 10, width: 10, x: 0, y: top - 20 }) as DOMRect
    const layer = document.createElement('div')
    layer.className = 'strip-bubbles'
    layer.innerHTML = '<div class="bubble"></div><div class="bubble"></div>'
    const [bridge, inside] = layer.querySelectorAll<HTMLElement>('.bubble')
    bridge.getBoundingClientRect = () => rect(130, 155)
    inside.getBoundingClientRect = () => rect(99, 112)
    root.append(layer)
    expect((await waitForPaintAndMeasure(root)).rows).toEqual([{ top: 0, bottom: 152 }])
  })

  it('a bubble hanging below the last panel is clipped to the strip and extends nothing past it', async () => {
    const root = strip()
    for (const img of root.querySelectorAll('img')) img.decode = () => Promise.resolve()
    const layer = document.createElement('div')
    layer.className = 'strip-bubbles'
    layer.innerHTML = '<div class="bubble"></div>'
    layer.querySelector<HTMLElement>('.bubble')!.getBoundingClientRect = () => ({ top: 400 - 20, bottom: 500 - 20, height: 100, left: 0, right: 10, width: 10, x: 0, y: 380 }) as DOMRect
    root.append(layer)
    const layout = await waitForPaintAndMeasure(root)
    expect(layout.totalHeight).toBe(152)
    expect(layout.rows).toEqual([
      { top: 0, bottom: 140 },
      { top: 150, bottom: 152 }
    ])
  })

  describe('a background image', () => {
    const inCanvas = (root: HTMLElement): void => {
      const canvas = root.querySelector<HTMLElement>('.strip-canvas')!
      canvas.style.backgroundImage = 'linear-gradient(#ffffff00, #ffffff00), url("webtoon-asset://proj/episode-backgrounds/epi/x.png")'
    }
    const decodeAll = (root: HTMLElement): void => {
      for (const img of root.querySelectorAll('img')) img.decode = () => Promise.resolve()
    }

    it('is decoded before the measure resolves', async () => {
      const root = strip()
      decodeAll(root)
      inCanvas(root)
      const decoded: string[] = []
      let finish!: () => void
      vi.stubGlobal(
        'Image',
        class {
          src = ''
          decode(): Promise<void> {
            decoded.push(this.src)
            return new Promise<void>((resolve) => (finish = resolve))
          }
        }
      )
      let settled = false
      const pending = waitForPaintAndMeasure(root).then(() => (settled = true))
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(decoded).toEqual(['webtoon-asset://proj/episode-backgrounds/epi/x.png'])
      expect(settled).toBe(false)
      finish()
      await pending
      expect(settled).toBe(true)
    })

    it('rejects, naming the background, when it cannot be loaded', async () => {
      const root = strip()
      decodeAll(root)
      inCanvas(root)
      vi.stubGlobal(
        'Image',
        class {
          src = ''
          decode(): Promise<void> {
            return Promise.reject(new Error('missing'))
          }
        }
      )
      await expect(waitForPaintAndMeasure(root)).rejects.toThrow('The background image could not be loaded')
    })

    it('is not asked for when the background has no image', async () => {
      const root = strip()
      decodeAll(root)
      const image = vi.fn()
      vi.stubGlobal('Image', image)
      await waitForPaintAndMeasure(root)
      expect(image).not.toHaveBeenCalled()
    })
  })

  it('rejects naming the panel whose image failed to decode', async () => {
    const root = strip()
    const imgs = root.querySelectorAll('img')
    imgs[0].decode = () => Promise.resolve()
    imgs[1].decode = () => Promise.reject(new Error('decode'))
    imgs[2].decode = () => Promise.resolve()
    await expect(waitForPaintAndMeasure(root)).rejects.toThrow('Panel 4: the image could not be loaded')
  })
})
