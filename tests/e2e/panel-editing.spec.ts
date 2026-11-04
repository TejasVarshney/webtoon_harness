import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { createProjectAndSession, launchApp, openTab, readProjectJson, sendChat } from './helpers'

const shots = resolve(__dirname, '..', '..', 'test-results', 'panel-editing')

/** The page's viewport size. The specs are type-checked without the DOM's types, so `window` is reached through `globalThis`. */
const viewport = (page: Page): Promise<[number, number]> => page.evaluate(() => [(globalThis as any).innerWidth, (globalThis as any).innerHeight])

/** A locator's box. A bubble remounts when a save gives its line a new id, so a box read at that moment is retried. */
async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  let box: { x: number; y: number; width: number; height: number } | null = null
  await expect.poll(async () => (box = await locator.boundingBox()) !== null).toBe(true)
  return box!
}

/** Sets the window's outer size, and waits until the page has its new content size. */
async function setWindowSize(app: ElectronApplication, page: Page, width: number, height: number): Promise<void> {
  const [w, h] = await app.evaluate(({ BrowserWindow }, [w, h]) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setSize(w, h)
    return win.getContentSize()
  }, [width, height])
  await expect.poll(() => viewport(page)).toEqual([w, h])
}

// Panel editing checkpoint (spec §1): click a card, retype its bubble and drag it to a new spot, change the panel's
// layout, add a character and an item, ask the panel chat to fix the line, go back. The strip shows the chat's text in
// the user's spot, on the card the user left from, and none of it drew a new version.
// The panel chat's state names no ids for the mock to resolve refs from, so a first launch makes the cast, the item
// and the panel, and a second one, on the same folders, has a script that names Mina's id outright.
test('edit a panel in editing mode and find the changes on the strip', async () => {
  const mina = { $character: 'Mina' }
  const first = await launchApp({
    script: {
      turns: [
        {
          toolCalls: [
            { name: 'create_character', input: { name: 'Mina', role: 'protagonist', appearanceLock: 'Teenage girl, silver bob haircut, amber eyes, red bomber jacket.' } },
            { name: 'create_character', input: { name: 'Jun', role: 'supporting', appearanceLock: 'Tall teenage boy, messy black hair, round glasses, green hoodie.' } },
            { name: 'create_item', input: { name: 'Kestrel blaster', appearanceLock: 'Compact matte-black sidearm the length of a hand, a cyan glowing slit along the barrel.' } }
          ]
        },
        { text: 'Cast ready.' },
        {
          toolCalls: [
            {
              name: 'create_panel',
              input: {
                episodeId: { $episode: 'current' },
                description: 'Mina looks up at the moon.',
                setting: 'Rooftop at night',
                shot: 'medium',
                characters: [{ characterId: mina, variationId: { $variation: ['Mina', 'Base'] } }],
                dialogue: [{ speakerId: mina, kind: 'speech', text: 'Is that the moon?' }]
              }
            }
          ]
        },
        { text: 'Drew panel 1.' }
      ]
    }
  })
  const { projectsRoot } = first
  await createProjectAndSession(first.page, 'Moon Diary')
  await sendChat(first.page, 'Make Mina, Jun and the blaster', 'Cast ready.')
  await sendChat(first.page, 'Draw panel 1', 'Drew panel 1.')
  await openTab(first.page, 'webtoon')
  await expect(first.page.getByTestId('panel-card').locator('img')).toHaveCount(1)
  await first.app.close()
  const characters = await readProjectJson(projectsRoot, 'characters')
  const idOf = (name: string): string => characters.find((c: { name: string }) => c.name === name).id
  for (const c of characters) expect(c.variations[0].status, `${c.name}'s base look is ready`).toBe('ready')
  const [item] = await readProjectJson(projectsRoot, 'items')
  expect(item.usages[0].status).toBe('ready')

  const fixed = "It's so huge!"
  const { app, page } = await launchApp({
    userDataDir: first.userDataDir,
    projectsRoot,
    script: {
      turns: [
        // The panel chat turn fixes the line. It leaves placement out, so the user's spot is kept.
        { toolCalls: [{ name: 'update_panel_fields', input: { dialogue: [{ speakerId: idOf('Mina'), kind: 'speech', text: fixed }] } }] },
        { text: 'Fixed the line.' }
      ]
    }
  })
  await page.getByTestId('session-item').click()
  await openTab(page, 'webtoon')
  const card = page.getByTestId('panel-card').first()
  await expect(card.locator('img')).toHaveCount(1)
  const panelId = (await card.getAttribute('data-panel-id'))!
  const stored = () => readProjectJson(projectsRoot, `panels/${panelId}.json`)
  const versions = (await stored()).versions.length

  // 1. Editing mode, at a laptop size.
  await setWindowSize(app, page, 1440, 900)
  await card.click()
  const workspace = page.getByTestId('panel-workspace')
  await expect(workspace).toBeVisible()
  await expect(workspace.getByRole('heading', { level: 1 })).toHaveText('Panel 1 of 1')
  const stage = workspace.getByTestId('panel-stage')
  const bubble = stage.locator('.bubble')
  await expect(bubble).toHaveText('Is that the moon?')

  // 2. Retype the bubble in place.
  await bubble.dblclick()
  const text = stage.locator('.bubble-editor')
  await expect(text).toBeFocused()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type("It's huge!")
  await page.keyboard.press('Enter')
  await expect(text).toHaveCount(0)
  await expect(bubble).toHaveText("It's huge!")
  await expect.poll(async () => (await stored()).dialogue[0].text).toBe("It's huge!")

  // 3. Drag it to a quarter across and three quarters down the panel. Placement is a fraction of the panel itself,
  // not of the stage's gutter field around it, and the press is at the bubble's centre, so nothing is grabbed off it.
  const from = await boxOf(bubble)
  const media = await boxOf(stage.locator('.panel-media'))
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(media.x + media.width * 0.25, media.y + media.height * 0.75, { steps: 12 })
  await page.mouse.up()
  await expect(stage.locator('.dialogue-placed .bubble')).toHaveText("It's huge!")
  const near = (p: { x: number; y: number } | null): boolean => p !== null && Math.abs(p.x - 0.25) <= 0.02 && Math.abs(p.y - 0.75) <= 0.02
  await expect.poll(async () => near((await stored()).dialogue[0].placement), { message: 'line 0 is placed at 25% / 75%' }).toBe(true)

  // 4. A layout change saves without a redraw.
  await workspace.getByRole('tab', { name: 'Scene' }).click()
  await workspace.getByLabel('Gutter').selectOption('black')
  await expect.poll(async () => (await stored()).gutter).toBe('black')
  expect((await stored()).versions).toHaveLength(versions)
  await expect(workspace.getByTestId('panel-version-label')).toHaveText('v1 / 1')

  // 5. Jun joins the cast, and the blaster the items, each saved on its own.
  await workspace.getByRole('tab', { name: 'Cast' }).click()
  await workspace.getByRole('button', { name: 'Add character', exact: true }).click()
  await workspace.getByLabel('Character').last().selectOption({ label: 'Jun' })
  await expect(workspace.getByLabel('Variation').last().locator('option:checked')).toHaveText('Base')
  await expect.poll(async () => (await stored()).characters.map((c: { characterId: string }) => c.characterId)).toEqual([idOf('Mina'), idOf('Jun')])
  await workspace.getByRole('tab', { name: 'Items' }).click()
  await workspace.getByRole('button', { name: 'Add item', exact: true }).click()
  await workspace.getByLabel('Item', { exact: true }).selectOption({ label: 'Kestrel blaster' })
  await expect.poll(async () => (await stored()).items.map((i: { itemId: string }) => i.itemId)).toEqual([item.id])
  expect((await stored()).versions).toHaveLength(versions)

  // 6. The panel chat fixes the line: its text changes, the user's spot stays, and nothing is redrawn.
  await workspace.getByTestId('composer-input').fill('Make her line say it is so huge')
  await workspace.getByTestId('composer-send').click()
  await expect(workspace.getByTestId('message-assistant').last()).toContainText('Fixed the line.')
  await expect.poll(async () => (await stored()).dialogue[0].text).toBe(fixed)
  expect(near((await stored()).dialogue[0].placement)).toBe(true)
  expect((await stored()).versions).toHaveLength(versions)
  await expect(stage.locator('.dialogue-placed .bubble')).toHaveText(fixed)
  await expect(workspace.getByTestId('panel-version-label')).toHaveText('v1 / 1')

  // 7. How it looks, at a laptop size and at a small one.
  await mkdir(shots, { recursive: true })
  const size = async () => (await viewport(page)).join('x')
  console.log(`editor-1440 viewport: ${await size()}`)
  await page.screenshot({ path: resolve(shots, 'editor-1440.png'), animations: 'disabled' })
  const fitWidth = () => stage.locator('.stage-fit').evaluate((el) => el.getBoundingClientRect().width)
  const wide = await fitWidth()
  await setWindowSize(app, page, 1100, 720)
  await expect.poll(fitWidth).not.toBe(wide)
  console.log(`editor-1100 viewport: ${await size()}`)
  await page.screenshot({ path: resolve(shots, 'editor-1100.png'), animations: 'disabled' })

  // 8. Back to the strip: the card the user left from has the focus, and its bubble has the chat's text in the
  // user's spot.
  await workspace.getByRole('button', { name: 'Back to the strip' }).click()
  await expect(workspace).toHaveCount(0)
  await expect(card).toBeFocused()
  const placed = card.locator('.dialogue-placed .bubble')
  await expect(placed).toHaveText(fixed)
  const left = await placed.evaluate((el: any) => el.style.left as string)
  expect(left).toMatch(/%$/)
  expect(Math.abs(parseFloat(left) - 25)).toBeLessThanOrEqual(2)
  await app.close()
})

// A lower line, whose row is out of sight under the tabs: selecting its bubble scrolls the row into view inside the
// tabs' own scroll area, so the stage stays put. A double-click's open text stays in sight and saves, and a dragged
// bubble's stage does not move after the drop.
test("a lower line's bubble is retyped and dragged without the stage moving", async () => {
  const mina = { $character: 'Mina' }
  const texts = ['Is that the moon?', 'It looks closer tonight.', 'Closer than ever.', 'Do you hear that?', 'A hum, from above.', 'It is calling me.', 'Then answer it.']
  const last = texts.length - 1
  const { app, page, projectsRoot } = await launchApp({
    script: {
      turns: [
        { toolCalls: [{ name: 'create_character', input: { name: 'Mina', role: 'protagonist', appearanceLock: 'Teenage girl, silver bob haircut, amber eyes, red bomber jacket.' } }] },
        { text: 'Created Mina.' },
        {
          toolCalls: [
            {
              name: 'create_panel',
              input: {
                episodeId: { $episode: 'current' },
                description: 'Mina looks up at the moon.',
                setting: 'Rooftop at night',
                shot: 'medium',
                characters: [{ characterId: mina, variationId: { $variation: ['Mina', 'Base'] } }],
                dialogue: texts.map((text) => ({ speakerId: mina, kind: 'speech', text }))
              }
            }
          ]
        },
        { text: 'Drew panel 1.' }
      ]
    }
  })
  await createProjectAndSession(page, 'Moon Diary')
  await sendChat(page, 'Create Mina', 'Created Mina.')
  await sendChat(page, 'Draw panel 1', 'Drew panel 1.')
  await page.getByTestId('tab-webtoon').click()
  const card = page.getByTestId('panel-card').first()
  await expect(card.locator('img')).toHaveCount(1)
  const panelId = (await card.getAttribute('data-panel-id'))!
  const stored = () => readProjectJson(projectsRoot, `panels/${panelId}.json`)

  await setWindowSize(app, page, 1440, 900)
  await card.click()
  const workspace = page.getByTestId('panel-workspace')
  const stage = workspace.getByTestId('panel-stage')
  const area = workspace.getByRole('tabpanel')
  const row = area.getByRole('listitem').nth(last)
  const bubble = stage.locator(`[data-line="${last}"]`)
  await expect(stage.locator('.bubble')).toHaveCount(texts.length)
  const top = async (l: Locator) => (await boxOf(l)).y
  // The row starts out of sight, below the tabs' scroll area.
  const [width, height] = await viewport(page)
  /** Where the tabs' area stops being visible: its bottom, or the window's. */
  const shownBottom = async (): Promise<number> => Math.min(height, await area.evaluate((el) => el.getBoundingClientRect().bottom))
  expect(await top(row)).toBeGreaterThan(await shownBottom())
  const stageTop = await top(stage)

  // A double-click opens the text in place, and it is still in sight once the row has been brought into view.
  await bubble.dblclick()
  const editor = stage.locator('.bubble-editor')
  await expect(editor).toBeFocused()
  await page.waitForTimeout(600)
  const box = await boxOf(editor)
  expect(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height, 'the open text is inside the window').toBe(true)
  expect(await top(stage)).toBe(stageTop)
  const areaBox = await area.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom }
  })
  const rowBox = await boxOf(row)
  expect(rowBox.y >= areaBox.top - 1 && rowBox.y < Math.min(areaBox.bottom, height), 'the row is in the scroll area, in sight').toBe(true)
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Then answer it, Mina.')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await stored()).dialogue[last].text).toBe('Then answer it, Mina.')

  // A drag of the last bubble while another line is selected, so the press selects it and its row is scrolled to: the
  // stage is where it was after the drop, the placement is saved, and the row came into view inside the tabs.
  await stage.locator('[data-line="0"]').click()
  await expect.poll(async () => (await boxOf(row)).y > (await shownBottom())).toBe(true)
  const from = await boxOf(bubble)
  const media = await boxOf(stage.locator('.panel-media'))
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(media.x + media.width * 0.3, media.y + media.height * 0.3, { steps: 12 })
  await page.mouse.up()
  await expect.poll(async () => (await stored()).dialogue[last].placement).not.toBeNull()
  await page.waitForTimeout(600)
  expect(await top(stage)).toBe(stageTop)
  const shown = await area.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom }
  })
  const dropped = await boxOf(row)
  expect(dropped.y >= shown.top - 1 && dropped.y < Math.min(shown.bottom, height), 'the row came into view in the scroll area').toBe(true)
  await app.close()
})
