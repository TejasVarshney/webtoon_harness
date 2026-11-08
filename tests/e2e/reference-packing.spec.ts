import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { createProjectAndSession, launchApp, openTab, readProjectJson, sendChat } from './helpers'

// Reference packing on the real offscreen canvas. Four cast members and the previous panel are one reference over the
// mock image model's cap of 4, so the last two cast sheets are drawn onto one image, side by side under their names.
// Then the cap is lowered to 2 in Settings → Models, and the next panel packs all four sheets in a 2 × 2 grid.
const names = ['Mina', 'Jin', 'Kai', 'Ara']
const character = (name: string) => ({ name, role: 'supporting', appearanceLock: `${name}, a teenager in a plain jacket.` })
const castEntry = (name: string) => ({ characterId: { $character: name }, variationId: { $variation: [name, 'Base'] } })
const panelInput = (description: string, cast: string[]) => ({
  episodeId: { $episode: 'current' },
  description,
  setting: 'Rooftop at night',
  shot: 'wide',
  characters: cast.map(castEntry),
  dialogue: []
})

const script = {
  turns: [
    { toolCalls: names.map((name) => ({ name: 'create_character', input: character(name) })) },
    { text: 'Cast ready.' },
    {
      toolCalls: [
        { name: 'create_panel', input: panelInput('Mina waits on the roof.', ['Mina']) },
        { name: 'create_panel', input: panelInput('The other three join Mina.', names) }
      ]
    },
    { text: 'Panels drawn.' },
    { toolCalls: [{ name: 'create_panel', input: panelInput('All four look up.', names) }] },
    { text: 'Third panel drawn.' }
  ]
}

/** Reads pixels of a PNG in the main process: the RGB at each point, and the dark pixels along each row span (the letters of a name). */
async function probe(app: ElectronApplication, path: string, points: [number, number][], rows: [number, number, number][]) {
  return app.evaluate(
    ({ nativeImage }, [file, pts, spans]) => {
      const img = nativeImage.createFromPath(file)
      const { width, height } = img.getSize()
      const bgra = img.toBitmap()
      const at = ([x, y]: [number, number]) => {
        const i = (y * width + x) * 4
        return [bgra[i + 2], bgra[i + 1], bgra[i]]
      }
      const ink = ([x0, x1, y]: [number, number, number]) => {
        let n = 0
        for (let x = x0; x < x1; x++) if (at([x, y]).every((c) => c < 100)) n++
        return n
      }
      return { width, height, colors: pts.map(at), ink: spans.map(ink) }
    },
    [path, points, rows] as const
  )
}

/** The color at the middle of a sheet. */
async function sheetColor(app: ElectronApplication, path: string) {
  return app.evaluate(({ nativeImage }, file) => {
    const s = nativeImage.createFromPath(file)
    const { width: w, height: h } = s.getSize()
    const b = s.toBitmap()
    const i = (Math.floor(h / 2) * w + Math.floor(w / 2)) * 4
    return [b[i + 2], b[i + 1], b[i]]
  }, path)
}

test('a panel over the reference cap is drawn from a packed, labeled image, and a lower cap set in Settings packs more', async () => {
  const { app, page, projectsRoot } = await launchApp({ script })
  await createProjectAndSession(page, 'Packing Test')
  await sendChat(page, 'Make the cast', 'Cast ready.')
  await sendChat(page, 'Draw the panels', 'Panels drawn.')
  await openTab(page, 'webtoon')
  await expect(page.getByTestId('panel-card').locator('img')).toHaveCount(2)

  const [episode] = await readProjectJson(projectsRoot, 'episodes')
  const first = await readProjectJson(projectsRoot, `panels/${episode.panelIds[0]}.json`)
  const second = await readProjectJson(projectsRoot, `panels/${episode.panelIds[1]}.json`)
  const characters: { name: string; variations: { imagePath: string }[] }[] = await readProjectJson(projectsRoot, 'characters')
  const sheet = (name: string) => characters.find((c) => c.name === name)!.variations[0].imagePath
  const version = second.versions[0]
  expect(version.status).toBe('ready')
  const pack: string = version.referenceImagePaths[2]
  expect(pack).toMatch(new RegExp(`^panels/${second.id}/pack-[0-9a-f]{16}\\.png$`))
  expect(version.referenceImagePaths).toEqual([sheet('Mina'), sheet('Jin'), pack, first.versions[0].imagePath])
  expect(version.prompt).toContain("[CHARACTERS] Reference image 3 holds 2 character sheets, each labeled with the person's name")
  expect(version.prompt).toContain('- Ara (reference image 3, the sheet labeled Ara): ')

  const projectDir = join(projectsRoot, (await readdir(projectsRoot)).find((n) => n.startsWith('prj_'))!)
  const abs = (rel: string) => join(projectDir, ...rel.split('/'))
  const color = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await sheetColor(app, abs(sheet(n)))] as const)))
  // Each mock sheet has its own color, so a sheet in the wrong cell shows.
  expect(new Set(Object.values(color).map(String)).size).toBe(4)

  const side = await probe(
    app,
    abs(pack),
    [
      [4, 4],
      [768, 700],
      [376, 712],
      [1159, 712]
    ],
    [
      [0, 753, 73],
      [783, 1536, 73]
    ]
  )
  expect([side.width, side.height]).toEqual([1536, 1277])
  const [bandCorner, gap, leftSheet, rightSheet] = side.colors
  expect(bandCorner).toEqual([255, 255, 255])
  expect(gap).toEqual([255, 255, 255])
  // Kai's sheet on the left, Ara's on the right, in cast order.
  expect(leftSheet).toEqual(color.Kai)
  expect(rightSheet).toEqual(color.Ara)
  expect(side.ink[0]).toBeGreaterThan(10)
  expect(side.ink[1]).toBeGreaterThan(10)

  // The user lowers the image model's cap to 2.
  await page.getByTestId('settings-open').click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByTestId('model-row-mdl_000000000b').getByRole('button', { name: 'Edit' }).click()
  const form = settings.getByRole('form', { name: 'Edit model' })
  const field = form.getByLabel('Max reference images')
  await expect(field).toHaveAccessibleDescription(
    "The most images sent with one request. When drawing a panel needs more, character sheets are stitched onto one image, each under the character's name, and whatever still does not fit is left out."
  )
  await field.fill('2')
  await form.getByRole('button', { name: 'Save model' }).click()
  await expect(form).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)

  await sendChat(page, 'Draw one more', 'Third panel drawn.')
  await expect(page.getByTestId('panel-card').locator('img')).toHaveCount(3)
  const third = await readProjectJson(projectsRoot, `panels/${(await readProjectJson(projectsRoot, 'episodes'))[0].panelIds[2]}.json`)
  const grid: string = third.versions[0].referenceImagePaths[0]
  expect(third.versions[0].status).toBe('ready')
  expect(third.versions[0].referenceImagePaths).toEqual([grid, second.versions[0].imagePath])
  expect(grid).toMatch(new RegExp(`^panels/${third.id}/pack-[0-9a-f]{16}\\.png$`))
  expect(third.versions[0].prompt).toContain("[CHARACTERS] Reference image 1 holds 4 character sheets, each labeled with the person's name")
  expect(third.versions[0].prompt).toContain('- Mina (reference image 1, the sheet labeled Mina): ')

  // The 2 × 2 grid of PACK_LAYOUT, scaled so its long edge (the height) is 1536.
  const s = 1536 / (2 * (200 + 1536) + 40)
  const px = (v: number) => Math.round(v * s)
  const sheetMiddle = (column: number, row: number): [number, number] => [px(column * 1064 + 512), px(row * 1776 + 200 + 768)]
  const bandRow = (column: number, row: number): [number, number, number] => [px(column * 1064), px(column * 1064 + 1024), px(row * 1776 + 100)]
  const square = await probe(
    app,
    abs(grid),
    [sheetMiddle(0, 0), sheetMiddle(1, 0), sheetMiddle(0, 1), sheetMiddle(1, 1), [px(1044), px(868)], [px(512), px(1756)]],
    [bandRow(0, 0), bandRow(1, 0), bandRow(0, 1), bandRow(1, 1)]
  )
  expect([square.width, square.height]).toEqual([px(2 * 1024 + 40), 1536])
  // Row by row in cast order: Mina and Jin on top, Kai and Ara below, a white gap between columns and between rows.
  expect(square.colors).toEqual([color.Mina, color.Jin, color.Kai, color.Ara, [255, 255, 255], [255, 255, 255]])
  for (const n of square.ink) expect(n).toBeGreaterThan(10)
  await app.close()
})
