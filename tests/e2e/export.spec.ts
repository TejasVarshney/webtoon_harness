import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { readZip } from '../../src/main/test/read-zip'
import { createProjectAndSession, launchApp, openTab, readProjectJson, sendChat, writeProjectJson } from './helpers'

/** Runs the export dialog for the active episode with one preset, confirms the "unfinished panels" warning when `expectUnfinished` (and asserts it is absent otherwise), and waits for it to finish. */
async function exportActiveEpisode(page: Page, preset: string, expectUnfinished: boolean): Promise<void> {
  await page.getByTestId('export-open').click()
  const dialog = page.getByTestId('export-dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByTestId('export-preset').selectOption(preset)
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
          panel('Mina looks up.'),
          panel('Mina runs.', { frame: 'slanted' }),
          panel('Mina stops.', { beside: false }),
          panel('Mina is in the dark.', { gutter: 'black' })
        ]
      },
      { text: 'Drew four panels.' }
    ]
  }
  const targetA = await mkdtemp(join(tmpdir(), 'webtoon-export-a-'))
  const targetB = await mkdtemp(join(tmpdir(), 'webtoon-export-b-'))

  // 1. Four panels, then a webtoon export to folder A.
  const first = await launchApp({ script, exportTarget: targetA })
  const { projectsRoot, userDataDir } = first
  await createProjectAndSession(first.page, 'Moon Diary')
  await sendChat(first.page, 'Create Mina', 'Created Mina.')
  await sendChat(first.page, 'Draw four panels', 'Drew four panels.')
  await openTab(first.page, 'webtoon')
  await expect(first.page.getByTestId('panel-card').locator('img')).toHaveCount(4)
  const [episode] = await readProjectJson(projectsRoot, 'episodes')
  expect(episode.panelIds).toHaveLength(4)
  const thirdId: string = episode.panelIds[2]

  await exportActiveEpisode(first.page, 'webtoon', false)
  const folderA = (await readdir(targetA)).filter((n) => n.startsWith('Moon Diary - 01 - '))
  expect(folderA).toHaveLength(1)
  const slicesA = await slicesOf(first.app, join(targetA, folderA[0]))
  expect(slicesA.length).toBeGreaterThan(0)
  for (const s of slicesA) {
    expect(s.width).toBe(800)
    expect(s.height).toBeLessThanOrEqual(1280)
  }
  const heightA = total(slicesA)

  // The last 40 px of the strip are panel 4's black gap (a normal gap is at least 40 px).
  const last = slicesA[slicesA.length - 1]
  expect(last.height).toBeGreaterThan(20)
  for (const x of [100, 400, 700]) {
    const bgra = await first.app.evaluate(({ nativeImage }, [p, x, y]) => nativeImage.createFromPath(p as string).crop({ x: x as number, y: y as number, width: 1, height: 1 }).toBitmap(), [last.path, x, last.height - 20])
    const [b, g, r] = Array.from(bgra as Uint8Array)
    expect(Math.max(r, g, b), `pixel at x=${x} is black`).toBeLessThan(16)
  }

  // 2. Quit, fail panel 3 by hand, and relaunch on the same folders.
  await first.app.close()
  const stored = await readProjectJson(projectsRoot, `panels/${thirdId}.json`)
  const version = stored.versions.find((v: { id: string }) => v.id === stored.currentVersionId) ?? stored.versions[0]
  await writeProjectJson(projectsRoot, `panels/${thirdId}.json`, {
    ...stored,
    versions: [{ ...version, status: 'failed', imagePath: null }],
    currentVersionId: null
  })

  const { app, page } = await launchApp({ userDataDir, projectsRoot, exportTarget: targetB, script: { turns: [{ text: 'Unused.' }] } })
  await page.getByTestId('session-item').click()
  await openTab(page, 'webtoon')
  await expect(page.getByTestId('panel-card')).toHaveCount(4)

  // 3. Panel 3's row is gone from the webtoon export.
  await exportActiveEpisode(page, 'webtoon', true)
  const folderB = (await readdir(targetB)).filter((n) => n.startsWith('Moon Diary - 01 - ') && !n.endsWith('.cbz') && !n.endsWith('.pdf'))
  expect(folderB).toHaveLength(1)
  const slicesB = await slicesOf(app, join(targetB, folderB[0]))
  expect(slicesB.length).toBeGreaterThan(0)
  expect(total(slicesB)).toBeLessThan(heightA)

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
