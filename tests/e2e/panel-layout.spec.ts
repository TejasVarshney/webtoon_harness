import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { createProjectAndSession, launchApp, openTab, readProjectJson, sendChat } from './helpers'

// The panel tools' Layout arranges a panel and the one after it side by side, in place, and stores where both went.
const mina = { $character: 'Mina' }
const panel = (description: string) => ({
  name: 'create_panel',
  input: {
    episodeId: { $episode: 'current' },
    description,
    setting: 'Rooftop at night',
    shot: 'medium',
    characters: [{ characterId: mina, variationId: { $variation: ['Mina', 'Base'] } }],
    dialogue: []
  }
})
const shots = resolve(__dirname, '..', '..', 'test-results', 'panel-layout')
const script = {
  turns: [
    { toolCalls: [{ name: 'create_character', input: { name: 'Mina', role: 'protagonist', appearanceLock: 'Teenage girl, silver bob haircut, amber eyes, red bomber jacket.' } }] },
    { text: 'Created Mina.' },
    { toolCalls: [panel('Mina looks up.'), panel('Mina runs.')] },
    { text: 'Drew two panels.' }
  ]
}

test('Layout puts a panel and the next one side by side', async () => {
  const { app, page, projectsRoot } = await launchApp({ script })
  await createProjectAndSession(page, 'Moon Diary')
  await sendChat(page, 'Create Mina', 'Created Mina.')
  await sendChat(page, 'Draw two panels', 'Drew two panels.')
  await openTab(page, 'webtoon')
  const cards = page.getByTestId('panel-card')
  await expect(cards.locator('img')).toHaveCount(2)
  const [episode] = await readProjectJson(projectsRoot, 'episodes')
  const [firstId, secondId]: string[] = episode.panelIds
  const placement = async (id: string) => (await readProjectJson(projectsRoot, `panels/${id}.json`)).placement

  await cards.nth(0).click({ position: { x: 20, y: 20 } })
  await page.getByRole('button', { name: 'Layout', exact: true }).click()
  const layouts = page.getByRole('dialog', { name: 'Layout' }).getByRole('group', { name: 'Layouts' })
  await expect(layouts.getByRole('button', { name: 'Three across' })).toBeDisabled()
  await layouts.getByRole('button', { name: 'Two across' }).click()
  await expect.poll(() => placement(secondId)).toEqual({ x: 223, y: 0, width: 217 })
  expect(await placement(firstId)).toEqual({ x: 0, y: 0, width: 217 })
  // Side by side on the screen too.
  const [a, b] = [(await cards.nth(0).boundingBox())!, (await cards.nth(1).boundingBox())!]
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1)
  expect(b.x).toBeGreaterThan(a.x + a.width)
  await expect(page.getByTestId('panel-workspace')).toHaveCount(0)

  // The Layout popover moves anywhere by its head, and stays there while it is used.
  const dialog = page.getByRole('dialog', { name: 'Layout' })
  const before = (await dialog.boundingBox())!
  const grip = (await dialog.getByRole('button', { name: 'Move Layout' }).boundingBox())!
  await page.mouse.move(grip.x + 30, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + 30 + 400, grip.y + grip.height / 2 - 120, { steps: 6 })
  await page.mouse.up()
  const after = (await dialog.boundingBox())!
  expect(Math.round(after.x - before.x)).toBe(400)
  expect(Math.round(after.y - before.y)).toBe(-120)

  // A slanted cut from the Layout's frames: the top falls to the right, the picture is cut to it, nothing is redrawn.
  const frames = page.getByRole('dialog', { name: 'Layout' }).getByRole('group', { name: 'Panel frame' })
  await frames.getByRole('button', { name: 'Top falls' }).click()
  const stored = async (id: string) => readProjectJson(projectsRoot, `panels/${id}.json`)
  await expect.poll(async () => ((await stored(firstId)) as { cut: string }).cut).toBe('top-down')
  expect((await stored(firstId)).frame).toBe('slanted')
  expect((await stored(firstId)).versions).toHaveLength(1)
  await expect(cards.nth(0)).toHaveAttribute('data-slant', 'top-down')
  await expect(frames.getByRole('button', { name: 'Top falls' })).toHaveAttribute('aria-pressed', 'true')
  expect(Math.round((await dialog.boundingBox())!.x)).toBe(Math.round(after.x))
  await page.screenshot({ path: resolve(shots, 'frames.png'), animations: 'disabled' })
  await page.keyboard.press('Escape')
  await cards.nth(1).click({ position: { x: 20, y: 40 } })
  await page.getByRole('button', { name: 'Layout', exact: true }).click()
  await page.getByRole('dialog', { name: 'Layout' }).getByRole('group', { name: 'Panel frame' }).getByRole('button', { name: 'Leans left' }).click()
  await expect(cards.nth(1)).toHaveAttribute('data-slant', 'lean-left')
  await page.keyboard.press('Escape')
  const pane = (await page.locator('.strip-canvas').boundingBox())!
  await page.mouse.move(pane.x + pane.width / 2, pane.y + 300)
  await page.mouse.wheel(0, -3000)
  await page.screenshot({ path: resolve(shots, 'cut-strip.png'), animations: 'disabled' })
  await app.close()
})
