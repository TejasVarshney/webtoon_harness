import { expect, test, type Locator, type Page } from '@playwright/test'
import { createProjectAndSession, launchApp, openFirstProject, openTab, readProjectJson, sendChat } from './helpers'

// Undo and redo on the strip, in the real window: a drag is undone to the flowing strip it came from (every placement
// null again, the old order), redone, a Layout arrangement is one step, a bubble move is undone, Ctrl+Z in a text field
// is the field's own, and a relaunch starts with nothing to undo. The window keeps Electron's Edit menu, whose Undo has
// the same accelerator: with no field focused Ctrl+Z still reaches the strip, and in a field it undoes the typing.
// The keys are Playwright's (sent through the DevTools protocol), not a key pressed on the keyboard.
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

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps })
  await page.mouse.up()
}

test('the strip undoes and redoes a drag, a layout and a bubble move, and leaves a text field its own undo', async () => {
  const first = await launchApp({ script })
  const { app, page, projectsRoot, userDataDir } = first
  await createProjectAndSession(page, 'Moon Diary')
  await sendChat(page, 'Create Mina', 'Created Mina.')
  await sendChat(page, 'Draw two panels', 'Drew two panels.')
  await openTab(page, 'webtoon')
  const cards = page.getByTestId('panel-card')
  await expect(cards.locator('img')).toHaveCount(2)
  const [episode] = await readProjectJson(projectsRoot, 'episodes')
  const ids: string[] = episode.panelIds
  /** Every panel's stored placement and the episode's order, as on disk now. */
  const strip = async () => ({
    order: (await readProjectJson(projectsRoot, 'episodes'))[0].panelIds as string[],
    placements: await Promise.all(ids.map(async (id) => (await readProjectJson(projectsRoot, `panels/${id}.json`)).placement))
  })
  const undo = page.getByRole('button', { name: 'Undo', exact: true })
  const redo = page.getByRole('button', { name: 'Redo', exact: true })
  const flowing = { order: ids, placements: [null, null] }
  expect(await strip()).toEqual(flowing)
  await expect(undo).toBeDisabled()
  await expect(undo).toHaveAttribute('title', 'Nothing to undo')

  // 1. Drag the second panel down: every panel is frozen. Ctrl+Z puts the strip back as it was, flowing; Ctrl+Shift+Z
  // places it again.
  const scale = (await page.locator('.strip-canvas').evaluate((el: any) => el.getBoundingClientRect().width)) / 440
  await cards.nth(1).scrollIntoViewIfNeeded()
  const card = await boxOf(cards.nth(1))
  const centre = { x: card.x + card.width / 2, y: card.y + card.height / 2 }
  await drag(page, centre, { x: centre.x, y: centre.y + 40 * scale })
  // The step is recorded once main has written every panel and the order, so the strip on disk is whole from then on.
  await expect(undo).toHaveAttribute('title', 'Undo move (Ctrl+Z)')
  const dragged = await strip()
  expect(dragged.placements.every((p) => p !== null)).toBe(true)
  await page.keyboard.press('Control+z')
  await expect.poll(strip).toEqual(flowing)
  await expect(redo).toHaveAttribute('title', 'Redo move (Ctrl+Shift+Z)')
  await page.keyboard.press('Control+Shift+z')
  await expect.poll(strip).toEqual(dragged)

  // 2. A Layout arrangement moves both panels, and is one step: one Ctrl+Z takes back the layout and only the layout.
  // Away from the caption at the panel's top left.
  await cards.nth(0).click({ position: { x: 200, y: 300 } })
  await page.getByRole('button', { name: 'Layout', exact: true }).click()
  await page.getByRole('dialog', { name: 'Layout' }).getByRole('group', { name: 'Layouts' }).getByRole('button', { name: 'Two across' }).click()
  await expect(undo).toHaveAttribute('title', 'Undo layout (Ctrl+Z)')
  const arranged = await strip()
  expect(arranged).not.toEqual(dragged)
  expect(arranged.placements[0]!.y).toBe(arranged.placements[1]!.y)
  // With the Layout popover still open: the click is undone where it was made.
  await expect(page.getByRole('dialog', { name: 'Layout' })).toBeVisible()
  await page.keyboard.press('Control+z')
  await expect.poll(strip).toEqual(dragged)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Layout' })).toHaveCount(0)
  await expect(redo).toHaveAttribute('title', 'Redo layout (Ctrl+Shift+Z)')
  await expect(undo).toHaveAttribute('title', 'Undo move (Ctrl+Z)')
  // Settled, and still one step: one press undid one step.
  await page.waitForTimeout(300)
  expect(await strip()).toEqual(dragged)

  // 3. A bubble moved on its panel, then undone with the bar's button.
  const firstPanel = async () => readProjectJson(projectsRoot, `panels/${ids[0]}.json`)
  expect((await firstPanel()).dialogue[0].placement).toBeNull()
  const bubble = page.getByTestId('strip-bubbles').first().locator('.bubble')
  await expect(bubble).toHaveText('Down here.')
  await bubble.scrollIntoViewIfNeeded()
  const from = await boxOf(bubble)
  await drag(page, { x: from.x + from.width / 2, y: from.y + from.height / 2 }, { x: from.x + from.width / 2 + 30, y: from.y + from.height / 2 + 60 }, 2)
  await expect.poll(async () => (await firstPanel()).dialogue[0].placement).not.toBeNull()
  await expect(undo).toHaveAttribute('title', 'Undo lettering (Ctrl+Z)')
  await undo.click()
  await expect.poll(async () => (await firstPanel()).dialogue[0].placement).toBeNull()
  expect((await firstPanel()).dialogue[0].text).toBe('Down here.')
  await expect(redo).toHaveAttribute('title', 'Redo lettering (Ctrl+Shift+Z)')

  // 4. Ctrl+Z in a text field is the field's: the typing goes, and no panel changes.
  const field = page.getByTestId('composer-input')
  await field.click()
  await page.keyboard.type('hello')
  await expect(field).toHaveValue('hello')
  const untouched = await Promise.all(ids.map((id) => readProjectJson(projectsRoot, `panels/${id}.json`)))
  await page.keyboard.press('Control+z')
  await expect(field).not.toHaveValue('hello')
  await page.waitForTimeout(300)
  expect(await Promise.all(ids.map((id) => readProjectJson(projectsRoot, `panels/${id}.json`)))).toEqual(untouched)
  await expect(undo).toHaveAttribute('title', 'Undo move (Ctrl+Z)')
  await expect(redo).toHaveAttribute('title', 'Redo lettering (Ctrl+Shift+Z)')

  // 5. A relaunch starts with nothing to undo.
  await app.close()
  const second = await launchApp({ userDataDir, projectsRoot })
  try {
    await openFirstProject(second.page)
    await openTab(second.page, 'webtoon')
    await expect(second.page.getByTestId('panel-card')).toHaveCount(2)
    await expect(second.page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
    await expect(second.page.getByRole('button', { name: 'Undo', exact: true })).toHaveAttribute('title', 'Nothing to undo')
    await expect(second.page.getByRole('button', { name: 'Redo', exact: true })).toHaveAttribute('title', 'Nothing to redo')
  } finally {
    await second.app.close()
  }
})
