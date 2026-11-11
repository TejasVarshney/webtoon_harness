import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { createProjectAndSession, launchApp, openFirstProject, openSessions, openTab, readProjectJson, sendChat } from './helpers'

// The free strip from the home page to an export: two drawn panels are dragged, a bubble is dragged off its panel, the
// background gets a gradient, both panels are chosen as references of a new one on the Generate page (which has no
// chat), the new panel lands on the strip selected, and the export ends at the last panel's bottom. Positions and the
// background are still there after a relaunch, which starts on the home page.
const mina = { $character: 'Mina' }
const panel = (description: string, dialogue: unknown[]) => ({
  name: 'create_panel',
  input: {
    episodeId: { $episode: 'current' },
    description,
    setting: 'Rooftop at night',
    shot: 'medium',
    characters: [{ characterId: mina, variationId: { $variation: ['Mina', 'Base'] } }],
    dialogue
  }
})
const script = {
  turns: [
    { toolCalls: [{ name: 'create_character', input: { name: 'Mina', role: 'protagonist', appearanceLock: 'Teenage girl, silver bob haircut, amber eyes, red bomber jacket.' } }] },
    { text: 'Created Mina.' },
    { toolCalls: [panel('Mina looks up.', [{ speakerId: null, kind: 'narration', text: 'Down here.' }]), panel('Mina runs.', [])] },
    { text: 'Drew two panels.' }
  ]
}

const boxOf = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => (await locator.boundingBox())!

/** A card's rectangle in strip px, whatever the pane's scale or scroll. */
const stripBox = (page: Page, index: number) =>
  page.getByTestId('panel-card').nth(index).evaluate((el: any) => {
    const canvas = el.closest('.strip-canvas').getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const scale = canvas.width / 440
    return { x: Math.round((r.left - canvas.left) / scale), y: Math.round((r.top - canvas.top) / scale), width: Math.round(r.width / scale) }
  })

/** Every card's bottom below the canvas top, in CSS px. */
const cardBottoms = (page: Page): Promise<number[]> =>
  page.evaluate(`(() => {
    const top = document.querySelector('.strip-canvas').getBoundingClientRect().top
    return [...document.querySelectorAll('.strip-canvas > [data-testid="panel-card"]')].map((card) => card.getBoundingClientRect().bottom - top)
  })()`) as Promise<number[]>

/** Presses at `from`, moves in `steps` and releases at `to`. A bubble is only grabbed if the pointer is still on it when the drag starts, so its drags use small steps. */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps })
  await page.mouse.up()
}

test('a strip is arranged, drawn from on the Generate page, exported and found again after a relaunch', async () => {
  const target = await mkdtemp(join(tmpdir(), 'webtoon-free-strip-'))
  // At scale 1 so a card's CSS px are the export window's.
  const first = await launchApp({ script, exportTarget: target, deviceScaleFactor: 1 })
  const { page, projectsRoot, userDataDir } = first
  await expect(page.getByTestId('project-card')).toHaveCount(0)
  await createProjectAndSession(page, 'Moon Diary')
  await sendChat(page, 'Create Mina', 'Created Mina.')
  await sendChat(page, 'Draw two panels', 'Drew two panels.')
  await openTab(page, 'webtoon')
  const cards = page.getByTestId('panel-card')
  await expect(cards.locator('img')).toHaveCount(2)
  const [episode] = await readProjectJson(projectsRoot, 'episodes')
  const [firstId, secondId]: string[] = episode.panelIds
  const stored = async (id: string) => (await readProjectJson(projectsRoot, `panels/${id}.json`)).placement
  const scale = (await page.locator('.strip-canvas').evaluate((el: any) => el.getBoundingClientRect().width)) / 440

  // 1. Drag the second panel down: its place is stored, and a drag does not open focus mode.
  await cards.nth(1).scrollIntoViewIfNeeded()
  const before = await stripBox(page, 1)
  const card = await boxOf(cards.nth(1))
  await drag(page, { x: card.x + card.width / 2, y: card.y + card.height / 2 }, { x: card.x + card.width / 2, y: card.y + card.height / 2 + 40 * scale })
  await expect.poll(() => stored(secondId)).toBeTruthy()
  expect(Math.abs((await stored(secondId)).y - (before.y + 40))).toBeLessThanOrEqual(2)
  await expect(page.getByTestId('panel-workspace')).toHaveCount(0)
  const moved = await stripBox(page, 1)

  // 2. Drag the first panel's bubble onto the second panel: the bubble keeps its owner and its place leaves the panel.
  const bubble = page.getByTestId('strip-bubbles').first().locator('.bubble')
  await expect(bubble).toHaveText('Down here.')
  // Selected first: a press that also changes the selection scrolls the panel's tools into view, under the pointer.
  await cards.nth(0).click({ position: { x: 200, y: 300 } })
  await expect(page.getByRole('toolbar', { name: 'Panel tools' })).toBeVisible()
  // The strip scrolled to its top, with the bubble well clear of the bar above it.
  await page.mouse.move(120, 400)
  await page.mouse.wheel(0, -2000)
  await expect.poll(async () => Math.round((await boxOf(bubble)).y), { intervals: [300] }).toBeGreaterThan(180)
  const from = await boxOf(bubble)
  // The panels are taller than the pane: the bubble goes down its own panel first, the strip scrolls, and a second drag
  // takes it past the panel's bottom.
  const x = from.x + from.width / 2
  await drag(page, { x, y: from.y + from.height / 2 }, { x, y: from.y + from.height / 2 + 430 }, 80)
  await expect.poll(async () => (await readProjectJson(projectsRoot, `panels/${firstId}.json`)).dialogue[0].placement).not.toBeNull()
  await page.mouse.wheel(0, 250)
  await expect.poll(() => bubble.evaluate((el: any) => Math.round(el.getBoundingClientRect().top))).toBeLessThan(420)
  const lower = await boxOf(bubble)
  await drag(page, { x, y: lower.y + lower.height / 2 }, { x, y: 700 }, 80)
  await expect.poll(async () => (await readProjectJson(projectsRoot, `panels/${firstId}.json`)).dialogue[0].placement?.y ?? 0).toBeGreaterThan(1)

  // 3. A gradient from the preset list, saved on the episode.
  await page.getByTestId('background-open').click()
  await page.getByRole('radio', { name: 'Linear' }).click()
  await page.getByRole('button', { name: 'Dusk' }).click()
  await expect.poll(async () => (await readProjectJson(projectsRoot, 'episodes'))[0].background?.kind).toBe('linear')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Background' })).toHaveCount(0)

  // 4. Shift-click both panels and go to the Generate page, which has no chat.
  await cards.nth(0).click()
  await cards.nth(1).click({ modifiers: ['Shift'] })
  await expect(cards.nth(0)).toHaveAttribute('data-selected', 'true')
  await expect(cards.nth(1)).toHaveAttribute('data-selected', 'true')
  await page.getByRole('button', { name: 'Generate from 2 panels' }).click()
  const generate = page.getByTestId('generate-page')
  await expect(generate).toBeVisible()
  await expect(generate.getByTestId('reference-row')).toHaveCount(2)
  await expect(page.getByTestId('composer-input')).toHaveCount(0)
  await expect(page.getByTestId('pane-chat')).toHaveCount(0)

  // 5. A character, a sketch and a prompt of the user's own.
  const tile = generate.getByTestId('library-character').filter({ hasText: 'Mina' })
  await tile.getByRole('button', { name: /Mina/ }).first().click()
  await expect(tile).toHaveAttribute('data-selected', 'true')
  const canvas = await boxOf(generate.getByTestId('generate-sketch-canvas'))
  await page.mouse.move(canvas.x + canvas.width * 0.2, canvas.y + canvas.height * 0.3)
  await page.mouse.down()
  await page.mouse.move(canvas.x + canvas.width * 0.6, canvas.y + canvas.height * 0.5, { steps: 8 })
  await page.mouse.move(canvas.x + canvas.width * 0.4, canvas.y + canvas.height * 0.8, { steps: 8 })
  await page.mouse.up()
  await generate.getByLabel('Description').fill('Mina reaches the edge of the roof.')
  await generate.getByLabel('Prompt', { exact: true }).fill('Mina at the roof edge, wind in her jacket, looking down at the city.')
  await expect(generate.getByRole('button', { name: 'Reset to automatic' })).toBeVisible()
  await generate.getByTestId('generate-submit').click()

  // 6. The page closes and the new, third panel is selected on the strip.
  await expect(generate).toHaveCount(0)
  await expect(cards).toHaveCount(3)
  await expect(page.locator('[data-testid="panel-card"][data-selected="true"]')).toHaveCount(1)
  await expect(cards.nth(2)).toHaveAttribute('data-selected', 'true')
  await expect(cards.locator('img')).toHaveCount(3)
  const [afterEpisode] = await readProjectJson(projectsRoot, 'episodes')
  expect(afterEpisode.panelIds).toHaveLength(3)
  const third = await readProjectJson(projectsRoot, `panels/${afterEpisode.panelIds[2]}.json`)
  expect(third.referencePanelIds).toEqual([firstId, secondId])
  expect(third.promptOverride).toContain('wind in her jacket')
  expect(third.versions[0].referenceImagePaths.length).toBeGreaterThanOrEqual(2)

  // 7. Export: the image ends at the bottom of the lowest panel, scaled 800 / 440.
  const lowest = Math.max(...(await cardBottoms(page)))
  await page.getByTestId('export-open').click()
  const dialog = page.getByTestId('export-dialog')
  await dialog.getByTestId('export-preset').selectOption('webtoon')
  await dialog.getByTestId('export-start').click()
  await expect(dialog.getByText('Exported.')).toBeVisible({ timeout: 90_000 })
  await dialog.getByRole('button', { name: 'Close' }).click()
  const folder = (await readdir(target)).filter((n) => n.startsWith('Moon Diary - 01 - '))
  expect(folder).toHaveLength(1)
  const names = (await readdir(join(target, folder[0]))).filter((n) => /\.jpe?g$/i.test(n)).sort()
  const heights = await Promise.all(names.map((n) => first.app.evaluate(({ nativeImage }, p) => nativeImage.createFromPath(p).getSize().height, join(target, folder[0], n))))
  const total = heights.reduce((sum, h) => sum + h, 0)
  expect(Math.abs(total - (lowest * 800) / 440)).toBeLessThanOrEqual(4)

  const placed = [await stripBox(page, 0), await stripBox(page, 1), await stripBox(page, 2)]
  expect(placed[1]).toEqual(moved)
  await first.app.close()

  // 8. A relaunch starts on the home page; the project's panels and gradient are as they were left.
  const again = await launchApp({ userDataDir, projectsRoot })
  await expect(again.page.getByTestId('project-card')).toHaveCount(1)
  await expect(again.page.getByTestId('pane-chat')).toHaveCount(0)
  await openFirstProject(again.page)
  await openSessions(again.page)
  await again.page.getByTestId('session-item').click()
  await openTab(again.page, 'webtoon')
  await expect(again.page.getByTestId('panel-card')).toHaveCount(3)
  expect([await stripBox(again.page, 0), await stripBox(again.page, 1), await stripBox(again.page, 2)]).toEqual(placed)
  expect((await readProjectJson(projectsRoot, 'episodes'))[0].background.kind).toBe('linear')
  expect(await again.page.locator('.strip-canvas').evaluate((el: any) => el.style.background || el.style.backgroundImage)).toContain('linear-gradient')
  await again.app.close()
})
