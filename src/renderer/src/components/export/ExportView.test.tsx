import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { STRIP_CSS_WIDTH } from '@shared/strip-width'
import type { DialogueLine, ExportSnapshot } from '@shared/types'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialCharactersState, useCharactersStore } from '../../stores/characters-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { PROJECT_ID as projectId, character } from '../../test/character-fixtures'
import { episode, panel, panelVersion } from '../../test/panel-fixtures'
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

function snapshot(o: Partial<ExportSnapshot> = {}): ExportSnapshot {
  return { projectId, episode: episode(), panels: [done, unfinished, second], characters: [character()], lettering: true, ...o }
}

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
    const card = screen.getAllByTestId('panel-card')[0]
    expect(card.hasAttribute('tabindex')).toBe(false)
    expect(card.getAttribute('data-selected')).toBeNull()
  })

  it('keeps strip-gap bands with their data-gap and data-gutter', () => {
    const { container } = render(<ExportView snapshot={snapshot({ panels: [done, second] })} />)
    const bands = [...container.querySelectorAll('.strip-band')]
    expect(bands.map((b) => b.getAttribute('data-gutter'))).toEqual(['black', 'black'])
    expect(bands.map((b) => b.querySelector('.strip-gap')?.getAttribute('data-gap'))).toEqual(['long', 'tight'])
  })

  it('draws no bubbles when lettering is off and draws them when on', () => {
    const on = render(<ExportView snapshot={snapshot()} />)
    expect(on.container.querySelectorAll('.bubble').length).toBeGreaterThan(0)
    on.unmount()
    const off = render(<ExportView snapshot={snapshot({ lettering: false })} />)
    expect(off.container.querySelectorAll('.bubble').length).toBe(0)
    expect(off.container.querySelector('.dialogue-overlay')).toBeNull()
  })

  it('leaves unfinished panels out (exportRows)', () => {
    render(<ExportView snapshot={snapshot()} />)
    const cards = screen.getAllByTestId('panel-card')
    expect(cards.map((c) => c.getAttribute('data-panel-id'))).toEqual([done.id, second.id])
    // The position is the panel's place in the full list, unfinished ones counted.
    expect(cards.map((c) => c.getAttribute('data-position'))).toEqual(['1', '3'])
  })

  it('sets the page background from the first row gutter', () => {
    const { unmount } = render(<ExportView snapshot={snapshot()} />)
    expect(document.body.style.background).toBe('rgb(0, 0, 0)')
    unmount()
    render(<ExportView snapshot={snapshot({ panels: [panel()] })} />)
    expect(document.body.style.background).toBe('rgb(255, 255, 255)')
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

  it('lays the strip out at the on-screen row width, 440 CSS px', async () => {
    render(<ExportView snapshot={snapshot()} />)
    expect(document.documentElement.style.getPropertyValue('--export-strip-width')).toBe(`${STRIP_CSS_WIDTH}px`)
    expect(STRIP_CSS_WIDTH).toBe(440)
    // styles.css is the source of truth on screen: its rows and gaps are at most that wide.
    const app = await cssOf('src/renderer/src/styles.css')
    expect(app).toMatch(new RegExp(String.raw`\.strip-row \{[^}]*width: min\(100%, ${STRIP_CSS_WIDTH}px\)[^}]*container-type: inline-size`))
    expect(app).toMatch(new RegExp(String.raw`\.strip-gap \{[^}]*width: min\(100%, ${STRIP_CSS_WIDTH}px\)`))
  })

  it('the export stylesheet makes the page and the strip that width, with rows and gaps across it', async () => {
    const css = await cssOf('src/renderer/src/export.css')
    expect(css).toMatch(/html, body \{[^}]*width: var\(--export-strip-width\)[^}]*overflow: hidden[^}]*background: #fff/)
    expect(css).toMatch(/html, body, #root \{ height: auto; \}/)
    expect(css).toMatch(/\.webtoon-strip \{[^}]*padding: 0[^}]*width: var\(--export-strip-width\)/)
    expect(css).toMatch(/\.strip-band \{[^}]*padding: 0[^}]*background: #fff/)
    expect(css).toMatch(/\.strip-band\[data-gutter='black'\] \{[^}]*background: #000/)
    expect(css).toMatch(/\.strip-row, \.strip-gap \{[^}]*width: 100%/)
  })
})

describe('waitForPaintAndMeasure', () => {
  function strip(): HTMLElement {
    const root = document.createElement('div')
    root.innerHTML =
      '<div class="strip-band"><article data-position="1"><img></article></div><div class="strip-band"><article data-position="4"><img></article></div>'
    // Document-relative [top, bottom] of each band, in fractional CSS px as layout gives them.
    const geometry = [
      [0, 100.2],
      [100.2, 151.5]
    ]
    // The page is scrolled 20 px, so each rect is 20 px above its document position: measuring adds scrollY back.
    const scrollY = 20
    const rect = (top: number, bottom: number): DOMRect =>
      ({ top: top - scrollY, bottom: bottom - scrollY, height: bottom - top, left: 0, right: 800, width: 800, x: 0, y: top - scrollY }) as DOMRect
    root.querySelectorAll<HTMLElement>('.strip-band').forEach((band, i) => {
      band.getBoundingClientRect = () => rect(geometry[i][0], geometry[i][1])
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
    Reflect.deleteProperty(document.documentElement, 'scrollHeight')
    Reflect.deleteProperty(window, 'scrollY')
  })

  it('measures each band (top down, bottom up) after decoding every image, and ends at the strip, not the viewport', async () => {
    const root = strip()
    for (const img of root.querySelectorAll('img')) img.decode = () => Promise.resolve()
    expect(await waitForPaintAndMeasure(root)).toEqual({
      totalHeight: 152,
      rows: [
        { top: 0, bottom: 101 },
        { top: 100, bottom: 152 }
      ]
    })
    // Padded to the whole pixel it reports, so the page scrolls all the way to the last slice's top.
    expect(root.style.minHeight).toBe('152px')
  })

  it('rejects naming the panel whose image failed to decode', async () => {
    const root = strip()
    const imgs = root.querySelectorAll('img')
    imgs[0].decode = () => Promise.resolve()
    imgs[1].decode = () => Promise.reject(new Error('decode'))
    await expect(waitForPaintAndMeasure(root)).rejects.toThrow('Panel 4: the image could not be loaded')
  })
})
