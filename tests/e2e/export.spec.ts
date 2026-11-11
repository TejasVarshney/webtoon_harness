import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { readZip } from '../../src/main/test/read-zip'
import { createProjectAndSession, launchApp, openFirstProject, openSessions, openTab, readProjectJson, sendChat, writeProjectJson } from './helpers'

/** Runs the export dialog for the active episode with one preset, confirms the "unfinished panels" warning when `expectUnfinished` (and asserts it is absent otherwise), and waits for it to finish. */
async function exportActiveEpisode(page: Page, preset: string, expectUnfinished: boolean, withoutLettering = false): Promise<void> {
  await page.getByTestId('export-open').click()
  const dialog = page.getByTestId('export-dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByTestId('export-preset').selectOption(preset)
  if (withoutLettering) await dialog.getByLabel('Without lettering').check()
  const start = dialog.getByTestId('export-start')
  await expect(start).toBeEnabled()
  await start.click()
  const anyway = dialog.getByTestId('export-anyway')
  if (expectUnfinished) {
    await expect(anyway).toBeVisible()
    await anyway.click()
  } else {
    // Not export-progress: it is gone again once a short job is done.
    await expect(anyway).toHaveCount(0)
  }
  await expect(dialog.getByText('Exported.')).toBeVisible({ timeout: 90_000 })
  await expect(dialog.getByTestId('export-reveal')).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toHaveCount(0)
}

/** The sorted JPEG slices of an exported folder, with their sizes read in the main process. */
async function slicesOf(app: ElectronApplication, dir: string): Promise<{ path: string; width: number; height: number }[]> {
  const names = (await readdir(dir)).filter((n) => /\.jpe?g$/i.test(n)).sort()
  return Promise.all(
    names.map(async (name) => {
      const path = join(dir, name)
      const size = await app.evaluate(({ nativeImage }, p) => nativeImage.createFromPath(p).getSize(), path)
      return { path, ...size }
    })
  )
}

const total = (slices: { height: number }[]): number => slices.reduce((sum, s) => sum + s.height, 0)

/**
 * The strip canvas's width, and its first bubble's height, font size and panel height, in CSS px; the first tail's
 * path, whether the Anton face the styled line asks for has loaded, and the width of the bubble that has one over its
 * panel's.
 */
type Geometry = { stripWidth: number; canvasHeight: number; bubbleHeight: number; panelHeight: number; fontSize: number; tail: string | null; anton: boolean; sized: number | null }

/** Run in a page (the main window or the export window): measures the strip as it is drawn there. */
const MEASURE_STRIP = `(() => {
  const bubble = document.querySelector('.bubble')
  const media = bubble && bubble.closest('.panel-media')
  if (!bubble || !media) return null
  const sized = document.querySelector('.bubble-sized')
  const sizedPanel = sized && sized.closest('.panel-media')
  return {
    stripWidth: document.querySelector('.strip-canvas').getBoundingClientRect().width,
    canvasHeight: document.querySelector('.strip-canvas').getBoundingClientRect().height,
    bubbleHeight: bubble.getBoundingClientRect().height,
    panelHeight: media.getBoundingClientRect().height,
    fontSize: parseFloat(getComputedStyle(bubble.querySelector('.bubble-text')).fontSize),
    tail: document.querySelector('.bubble-tail path')?.getAttribute('d') ?? null,
    // Not document.fonts.check, which also says true when no such face is registered.
    anton: [...document.fonts].some((f) => f.family.replace(/["']/g, '') === 'Anton' && f.status === 'loaded'),
    sized: sized && sizedPanel ? sized.getBoundingClientRect().width / sizedPanel.getBoundingClientRect().width : null
  }
})()`

/**
 * Measures the next export window's strip as soon as it has drawn its first episode, before any capture: it wraps
 * that window's `executeJavaScript`, so `exportGeometry` can read the result after the export. `measure` is the script to
 * run there, `MEASURE_STRIP` unless a test measures something else.
 */
async function recordExportGeometry(app: ElectronApplication, measure: string = MEASURE_STRIP): Promise<void> {
  await app.evaluate(({ app }, measure) => {
    const g = globalThis as { __exportGeometry?: unknown }
    g.__exportGeometry = null
    app.once('browser-window-created', (_e, w) => {
      const wc = w.webContents
      const run = wc.executeJavaScript.bind(wc)
      wc.executeJavaScript = (async (code: string, gesture?: boolean) => {
        const result: unknown = await run(code, gesture)
        if (g.__exportGeometry === null && code.includes('webtoonExport.render')) g.__exportGeometry = await run(measure)
        return result
      }) as typeof wc.executeJavaScript
    })
  }, measure)
}

/** Run on the main window's strip: each card's bottom below the canvas top, in CSS px, in strip order. */
const CARD_BOTTOMS = `(() => {
  const top = document.querySelector('.strip-canvas').getBoundingClientRect().top
  return [...document.querySelectorAll('.strip-canvas > [data-testid="panel-card"]')].map((card) => card.getBoundingClientRect().bottom - top)
})()`

/** The output height that ends at `bottom` CSS px of the 440 px strip: it is captured at 800 / 440. */
const outputHeight = (bottom: number): number => (bottom * 800) / 440

/**
 * How far a bordered card's drawn bottom is above the bottom the strip's layout gives it, in CSS px: the layout
 * takes the picture's height at the card's full width, and the 2.5 px border on each side takes some of it back.
 */
const FRAME_SLACK = 3

const exportGeometry = <T = Geometry>(app: ElectronApplication): Promise<T | null> =>
  app.evaluate(() => (globalThis as { __exportGeometry?: unknown }).__exportGeometry ?? null) as Promise<T | null>

test('exports webtoon slices, a cbz and a reading pdf that match the strip', async () => {
  const mina = { $character: 'Mina' }
  const panel = (description: string, extra: Record<string, unknown> = {}) => ({
    name: 'create_panel',
    input: {
      episodeId: { $episode: 'current' },
      description,
      setting: 'Rooftop at night',
      shot: 'medium',
      characters: [{ characterId: mina, variationId: { $variation: ['Mina', 'Base'] } }],
      dialogue: [],
      ...extra
    }
  })
  const script = {
    turns: [
      { toolCalls: [{ name: 'create_character', input: { name: 'Mina', role: 'protagonist', appearanceLock: 'Teenage girl, silver bob haircut, amber eyes, red bomber jacket.' } }] },
      { text: 'Created Mina.' },
      {
        toolCalls: [
          panel('Mina looks up.', { dialogue: [{ speakerId: mina, kind: 'speech', text: 'We made it to the roof. Can you see the city lights from up here?' }] }),
          panel('Mina runs.', { frame: 'slanted' }),
          panel('Mina stops.', {
            beside: false,
            dialogue: [{ speakerId: mina, kind: 'speech', text: 'Over here!', style: { font: 'impact', fill: '#fff4c2', width: 0.5 }, tail: { x: 0.2, y: 0.9 } }]
          }),
          panel('Mina is in the dark.', { gutter: 'black' })
        ]
      },
      { text: 'Drew four panels.' }
    ]
  }
  const targetA = await mkdtemp(join(tmpdir(), 'webtoon-export-a-'))
  const targetB = await mkdtemp(join(tmpdir(), 'webtoon-export-b-'))

  // 1. Four panels, then a webtoon export to folder A.
  // At scale 1 so the strip's panels are as wide as in the export window, which the tail comparison below needs.
  const first = await launchApp({ script, exportTarget: targetA, deviceScaleFactor: 1 })
  const { projectsRoot, userDataDir } = first
  await createProjectAndSession(first.page, 'Moon Diary')
  await sendChat(first.page, 'Create Mina', 'Created Mina.')
  await sendChat(first.page, 'Draw four panels', 'Drew four panels.')
  await openTab(first.page, 'webtoon')
  await expect(first.page.getByTestId('panel-card').locator('img')).toHaveCount(4)
  const [episode] = await readProjectJson(projectsRoot, 'episodes')
  expect(episode.panelIds).toHaveLength(4)
  const lastId: string = episode.panelIds[3]

  await recordExportGeometry(first.app)
  await exportActiveEpisode(first.page, 'webtoon', false)

  // The export lays the strip out at the on-screen row width, 440 CSS px, so the lettering keeps its size against the
  // art: the bubble is as tall relative to its panel, and its text as large, as on screen.
  const onScreen = (await first.page.evaluate(MEASURE_STRIP)) as Geometry | null
  const inExport = await exportGeometry(first.app)
  expect(onScreen).not.toBeNull()
  expect(inExport).not.toBeNull()
  expect(inExport!.stripWidth).toBe(440)
  expect(onScreen!.stripWidth).toBe(440)
  expect(inExport!.fontSize).toBe(onScreen!.fontSize)
  expect(inExport!.bubbleHeight / inExport!.panelHeight).toBeCloseTo(onScreen!.bubbleHeight / onScreen!.panelHeight, 2)
  // Both lay out at 440 px, so a tail measured before the fonts settled would differ from the one on screen.
  expect(inExport!.tail).not.toBeNull()
  expect(inExport!.tail).toBe(onScreen!.tail)
  expect(inExport!.anton).toBe(true)
  // The line with a width is as wide against its panel in the export as on screen: half of the panel's width.
  expect(onScreen!.sized).toBeGreaterThan(0.4)
  expect(onScreen!.sized).toBeLessThanOrEqual(0.5)
  expect(inExport!.sized).not.toBeNull()
  expect(Math.abs(inExport!.sized! - onScreen!.sized!)).toBeLessThanOrEqual(0.01)
  const folderA = (await readdir(targetA)).filter((n) => n.startsWith('Moon Diary - 01 - '))
  expect(folderA).toHaveLength(1)
  const slicesA = await slicesOf(first.app, join(targetA, folderA[0]))
  expect(slicesA.length).toBeGreaterThan(0)
  for (const s of slicesA) {
    expect(s.width).toBe(800)
    expect(s.height).toBeLessThanOrEqual(1280)
  }
  // 704 CSS px of the 440 px view captured at 800 / 440: every slice but the last is exactly 1280 px.
  expect(slicesA.length).toBeGreaterThan(1)
  for (const s of slicesA.slice(0, -1)) expect(s.height).toBe(1280)
  const heightA = total(slicesA)

  // The image ends at the bottom of the last panel: no gap, background or bubble room below it.
  const bottoms = (await first.page.evaluate(CARD_BOTTOMS)) as number[]
  expect(bottoms).toHaveLength(4)
  // The export's page is as tall as the last panel (to the whole pixel it is padded to), and the image as that page.
  expect(inExport!.canvasHeight - bottoms[3]).toBeGreaterThanOrEqual(0)
  expect(inExport!.canvasHeight - bottoms[3]).toBeLessThanOrEqual(FRAME_SLACK)
  expect(Math.abs(heightA - outputHeight(Math.ceil(inExport!.canvasHeight)))).toBeLessThanOrEqual(2)

  // 2. Quit, fail the last panel by hand, and relaunch on the same folders.
  await first.app.close()
  const stored = await readProjectJson(projectsRoot, `panels/${lastId}.json`)
  const version = stored.versions.find((v: { id: string }) => v.id === stored.currentVersionId) ?? stored.versions[0]
  await writeProjectJson(projectsRoot, `panels/${lastId}.json`, {
    ...stored,
    versions: [{ ...version, status: 'failed', imagePath: null }],
    currentVersionId: null
  })

  const { app, page } = await launchApp({ userDataDir, projectsRoot, exportTarget: targetB, script: { turns: [{ text: 'Unused.' }] } })
  await openFirstProject(page)
  await openSessions(page)
  await page.getByTestId('session-item').click()
  await openTab(page, 'webtoon')
  await expect(page.getByTestId('panel-card')).toHaveCount(4)

  // 3. The failed panel is left out, so the image now ends at panel 3's bottom.
  await exportActiveEpisode(page, 'webtoon', true)
  const folderB = (await readdir(targetB)).filter((n) => n.startsWith('Moon Diary - 01 - ') && !n.endsWith('.cbz') && !n.endsWith('.pdf'))
  expect(folderB).toHaveLength(1)
  const slicesB = await slicesOf(app, join(targetB, folderB[0]))
  expect(slicesB.length).toBeGreaterThan(0)
  expect(total(slicesB)).toBeLessThan(heightA)
  expect(Math.abs(total(slicesB) - outputHeight(bottoms[2]))).toBeLessThanOrEqual(outputHeight(FRAME_SLACK + 1))

  // 4. The CBZ holds numbered JPEGs and a ComicInfo.xml.
  await exportActiveEpisode(page, 'cbz', true)
  const cbz = (await readdir(targetB)).filter((n) => n.endsWith('.cbz'))
  expect(cbz).toHaveLength(1)
  const entries = readZip(await readFile(join(targetB, cbz[0])))
  const names = entries.map((e) => e.name)
  expect(names).toContain('ComicInfo.xml')
  const images = names.filter((n) => n !== 'ComicInfo.xml')
  expect(images.length).toBeGreaterThan(0)
  expect(images).toEqual(images.map((_, i) => `${String(i + 1).padStart(3, '0')}.jpg`))
  expect(entries.find((e) => e.name === 'ComicInfo.xml')!.data.toString('utf8')).toContain('<Number>1</Number>')

  // 5. The reading PDF has one page per slice.
  await exportActiveEpisode(page, 'pdf-reading', true)
  const pdf = (await readdir(targetB)).filter((n) => n.endsWith('.pdf'))
  expect(pdf).toHaveLength(1)
  const pdfText = (await readFile(join(targetB, pdf[0]))).toString('latin1')
  expect(pdfText.startsWith('%PDF-')).toBe(true)
  expect((pdfText.match(/\/Type \/Page\b/g) ?? []).length).toBe(slicesB.length)
  await app.close()
})

test('an export draws overlapping bubbles as one balloon', async () => {
  // A wide outline to sample, and short lines in wide padding so that no lettering lies on the sampled pixels.
  const style = { strokeWidth: 6, padding: 2 }
  const script = {
    turns: [
      {
        toolCalls: [
          {
            name: 'create_panel',
            input: {
              episodeId: { $episode: 'current' },
              description: 'An empty street.',
              setting: 'Street at night',
              shot: 'wide',
              characters: [],
              dialogue: [
                { speakerId: null, kind: 'speech', text: 'Yo', placement: { x: 0.4, y: 0.4 }, style },
                { speakerId: null, kind: 'speech', text: 'Hi', placement: { x: 0.55, y: 0.4 }, style }
              ]
            }
          }
        ]
      },
      { text: 'Drew a panel.' }
    ]
  }
  const target = await mkdtemp(join(tmpdir(), 'webtoon-export-merged-'))
  const { app, page } = await launchApp({ script, exportTarget: target })
  await createProjectAndSession(page, 'Moon Diary')
  await sendChat(page, 'Draw a panel', 'Drew a panel.')
  await openTab(page, 'webtoon')
  await expect(page.getByTestId('panel-card').locator('img')).toHaveCount(1)

  type Box = { left: number; top: number; width: number; height: number }
  await recordExportGeometry(
    app,
    `(() => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top + scrollY, width: r.width, height: r.height } }
      return { layer: document.querySelectorAll('.dialogue-merge').length, merged: document.querySelectorAll('.bubble-merged').length, bubbles: [...document.querySelectorAll('.dialogue-placed > .bubble')].map(box) }
    })()`
  )
  await exportActiveEpisode(page, 'webtoon', false)
  const geometry = await exportGeometry<{ layer: number; merged: number; bubbles: Box[] }>(app)
  expect(geometry).toMatchObject({ layer: 1, merged: 2 })
  const [first, second] = geometry!.bubbles

  const folder = (await readdir(target)).find((n) => n.startsWith('Moon Diary - 01 - '))!
  const slices = await slicesOf(app, join(target, folder))
  const scale = slices[0].width / 440
  /** The brightest channel of the output pixel at this point of the export's page, in CSS px. */
  const brightness = async (x: number, y: number): Promise<number> => {
    const outY = Math.round(y * scale)
    const slice = slices[Math.floor(outY / 1280)]
    const bgra = await app.evaluate(({ nativeImage }, [p, x, y]) => nativeImage.createFromPath(p as string).crop({ x: x as number, y: y as number, width: 1, height: 1 }).toBitmap(), [slice.path, Math.round(x * scale), outY % 1280])
    return Math.max(...Array.from(bgra as Uint8Array).slice(0, 3))
  }
  const middle = first.top + first.height / 2
  // The middle of the first bubble's left edge, which nothing overlaps: this is what an outline looks like here.
  expect(await brightness(first.left + 3, middle), 'an outline outside the overlap is dark').toBeLessThan(64)
  // The later bubble's left edge inside the first: drawn in front of it, separately, this would be just as dark.
  expect(await brightness(second.left + 3, middle), 'no outline runs through the overlap').toBeGreaterThan(200)
  await app.close()
})

test('Without lettering draws no bubble and no tail', async () => {
  const mina = { $character: 'Mina' }
  const script = {
    turns: [
      { toolCalls: [{ name: 'create_character', input: { name: 'Mina', role: 'protagonist', appearanceLock: 'Teenage girl, silver bob haircut, amber eyes, red bomber jacket.' } }] },
      { text: 'Created Mina.' },
      {
        toolCalls: [
          {
            name: 'create_panel',
            input: {
              episodeId: { $episode: 'current' },
              description: 'Mina stops.',
              setting: 'Rooftop at night',
              shot: 'medium',
              characters: [{ characterId: mina, variationId: { $variation: ['Mina', 'Base'] } }],
              dialogue: [{ speakerId: mina, kind: 'speech', text: 'Over here!', style: { font: 'impact', fill: '#fff4c2' }, tail: { x: 0.2, y: 0.9 } }]
            }
          }
        ]
      },
      { text: 'Drew a panel.' }
    ]
  }
  const target = await mkdtemp(join(tmpdir(), 'webtoon-export-bare-'))
  const { app, page } = await launchApp({ script, exportTarget: target })
  await createProjectAndSession(page, 'Moon Diary')
  await sendChat(page, 'Create Mina', 'Created Mina.')
  await sendChat(page, 'Draw a panel', 'Drew a panel.')
  await openTab(page, 'webtoon')
  await expect(page.getByTestId('panel-card').locator('img')).toHaveCount(1)

  await recordExportGeometry(
    app,
    `({ panels: document.querySelectorAll('.panel-media').length, bubbles: document.querySelectorAll('.bubble').length, tails: document.querySelectorAll('.bubble-tail').length })`
  )
  await exportActiveEpisode(page, 'webtoon', false, true)
  // Counting the panel keeps this from passing when nothing was drawn at all.
  expect(await exportGeometry<{ panels: number; bubbles: number; tails: number }>(app)).toEqual({ panels: 1, bubbles: 0, tails: 0 })
  await app.close()
})

test("the image is as tall as the last panel's bottom at 800/440 scale", async () => {
  const panel = (description: string) => ({
    name: 'create_panel',
    input: { episodeId: { $episode: 'current' }, description, setting: 'Street at night', shot: 'wide', characters: [], dialogue: [] }
  })
  const script = { turns: [{ toolCalls: [panel('An empty street.'), panel('A lamp.')] }, { text: 'Drew two panels.' }] }
  const target = await mkdtemp(join(tmpdir(), 'webtoon-export-height-'))
  const { app, page } = await launchApp({ script, exportTarget: target, deviceScaleFactor: 1 })
  await createProjectAndSession(page, 'Moon Diary')
  await sendChat(page, 'Draw two panels', 'Drew two panels.')
  await openTab(page, 'webtoon')
  await expect(page.getByTestId('panel-card').locator('img')).toHaveCount(2)
  const bottoms = (await page.evaluate(CARD_BOTTOMS)) as number[]
  await recordExportGeometry(app, `({ canvasHeight: document.querySelector('.strip-canvas').getBoundingClientRect().height })`)
  await exportActiveEpisode(page, 'webtoon', false)
  const inExport = await exportGeometry<{ canvasHeight: number }>(app)

  const folder = (await readdir(target)).find((n) => n.startsWith('Moon Diary - 01 - '))!
  const slices = await slicesOf(app, join(target, folder))
  expect(inExport).not.toBeNull()
  expect(inExport!.canvasHeight - bottoms[1]).toBeLessThanOrEqual(FRAME_SLACK)
  expect(Math.abs(total(slices) - outputHeight(Math.ceil(inExport!.canvasHeight)))).toBeLessThanOrEqual(2)
  // Nothing is left under the last panel: well short of what one more gap and panel would add.
  expect(total(slices)).toBeLessThan(outputHeight(bottoms[1] + 40))
  await app.close()
})
