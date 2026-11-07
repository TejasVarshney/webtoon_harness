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

/** Drags the selected bubble's tail dot, by its centre on screen, to a fraction of the panel. */
async function dragDot(page: Page, stage: Locator, x: number, y: number): Promise<void> {
  // Waits until the dot's position is the same on two reads in a row.
  let dot = await boxOf(stage.locator('.bubble-tail-handle'))
  await expect
    .poll(async () => {
      const next = await boxOf(stage.locator('.bubble-tail-handle'))
      const still = next.x === dot.x && next.y === dot.y
      dot = next
      return still
    })
    .toBe(true)
  const media = await boxOf(stage.locator('.panel-media'))
  await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2)
  await page.mouse.down()
  await page.mouse.move(media.x + media.width * x, media.y + media.height * y, { steps: 12 })
  await page.mouse.up()
}

/**
 * Drags the dot, and once more if `saved` does not then say the tail is stored. Now and then an injected drag stores
 * nothing, and may do nothing at all. A real OS pointer event during it is the likely cause: it ends the press at the
 * `(e.buttons & 1) === 0` guard in `useBubbleEditing`. `PanelStage.test.tsx` holds a press on the dot against the bubble's
 * remount in each order, which is the real guard on this path: one extra try here cannot hide a drag that mostly fails.
 */
async function pointDot(page: Page, stage: Locator, x: number, y: number, saved: () => Promise<boolean>): Promise<void> {
  const attempt = async (): Promise<void> => {
    await dragDot(page, stage, x, y)
    await expect.poll(saved, { timeout: 2500 }).toBe(true)
  }
  await attempt().catch(async () => {
    // Said out loud, so a drag that often fails shows in the run's output instead of passing unseen.
    console.log('pointDot: the first drag stored no tip, trying once more')
    await attempt()
  })
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

// Panel editing checkpoint: click a card, retype its bubble and drag it to a new spot, change the panel's
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

  // 5b. The line is styled and pointed, so the chat's fix lands on a styled line.
  await bubble.click()
  await workspace.getByRole('tab', { name: 'Lines' }).click()
  await workspace.getByLabel('Fill', { exact: true }).fill('#ffe066')
  await expect.poll(async () => (await stored()).dialogue[0].style?.fill).toBe('#ffe066')
  await pointDot(page, stage, 0.7, 0.92, async () => (await stored()).dialogue[0].tail !== null)
  const pointed = (await stored()).dialogue[0].tail

  // 6. The panel chat fixes the line: its text changes, the user's spot stays, and nothing is redrawn.
  await workspace.getByTestId('composer-input').fill('Make her line say it is so huge')
  await workspace.getByTestId('composer-send').click()
  await expect(workspace.getByTestId('message-assistant').last()).toContainText('Fixed the line.')
  await expect.poll(async () => (await stored()).dialogue[0].text).toBe(fixed)
  expect(near((await stored()).dialogue[0].placement)).toBe(true)
  expect((await stored()).dialogue[0].style.fill, 'the look survives the chat').toBe('#ffe066')
  expect((await stored()).dialogue[0].tail, 'the tail survives the chat').toEqual(pointed)
  expect((await stored()).versions).toHaveLength(versions)
  await expect(stage.locator('.dialogue-placed .bubble')).toHaveText(fixed)
  await expect(workspace.getByTestId('panel-version-label')).toHaveText('v1 / 1')

  // 7. How it looks, at a laptop size and at a small one.
  await mkdir(shots, { recursive: true })
  await page.screenshot({ path: resolve(shots, 'editor-1440.png'), animations: 'disabled' })
  const fitWidth = () => stage.locator('.stage-fit').evaluate((el) => el.getBoundingClientRect().width)
  const wide = await fitWidth()
  await setWindowSize(app, page, 1100, 720)
  await expect.poll(fitWidth).not.toBe(wide)
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

// A zoomed stage moves with a middle-button drag, or with Space held and a left drag; the hand shows while Space is
// held, Space presses no focused button, and neither drag touches the lines. Without Space a double-click still adds one.
test('a zoomed panel moves with the middle button, or with Space and a drag', async () => {
  const { app, page } = await launchApp()
  await createProjectAndSession(page, 'Moon Diary')
  await page.getByTestId('tab-webtoon').click()
  await page.getByTestId('add-panel').last().click()
  const workspace = page.getByTestId('panel-workspace')
  await workspace.getByRole('button', { name: 'Generate' }).click()
  const stage = workspace.getByTestId('panel-stage')
  await expect(stage.locator('img')).toHaveCount(1)

  const zoom = workspace.getByRole('group', { name: 'Zoom' })
  const level = zoom.getByRole('button', { name: /^Zoom \d+%/ })
  for (let i = 0; i < 4; i++) await zoom.getByRole('button', { name: 'Zoom in' }).click()
  await expect(level).toHaveText('244%')
  const viewport = workspace.getByTestId('stage-viewport')
  const scroll = (): Promise<[number, number]> => viewport.evaluate((el: any) => [el.scrollLeft, el.scrollTop])
  const room: [number, number] = await viewport.evaluate((el: any) => [el.scrollWidth - el.clientWidth, el.scrollHeight - el.clientHeight])
  expect(Math.max(...room), 'the zoomed panel overflows its stage').toBeGreaterThan(80)
  const view = (await viewport.boundingBox())!
  const cx = view.x + view.width / 2
  const cy = view.y + view.height / 2
  const big = room[0] >= room[1] ? 0 : 1
  /** After a drag by (40, 40): each axis went back by 40, or as far as its edge, and the one with the most room moved. */
  const movedBack = (from: [number, number], to: [number, number]): void => {
    for (const axis of [0, 1]) expect(Math.abs(Math.min(room[axis], Math.max(0, from[axis] - 40)) - to[axis]), `axis ${axis} followed the pointer`).toBeLessThanOrEqual(1)
    expect(to[big]).not.toBe(from[big])
  }

  // The middle button.
  let before = await scroll()
  await page.mouse.move(cx, cy)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(cx + 40, cy + 40, { steps: 5 })
  await page.mouse.up({ button: 'middle' })
  movedBack(before, await scroll())

  // The panel's edge stops it: a drag past the top left corner leaves it at the corner, still in sight.
  await viewport.evaluate((el: any) => {
    el.scrollLeft = 10
    el.scrollTop = 10
  })
  await page.mouse.move(cx, cy)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(cx + 200, cy + 200, { steps: 5 })
  await page.mouse.up({ button: 'middle' })
  expect(await scroll()).toEqual([0, 0])
  await viewport.evaluate((el: any, [left, top]) => {
    el.scrollLeft = left
    el.scrollTop = top
  }, [room[0] / 2, room[1] / 2])

  // Space and the left button: the Zoom in button still has the focus, and Space does not press it.
  before = await scroll()
  await page.mouse.move(cx, cy)
  await page.keyboard.down('Space')
  await expect(viewport).toHaveAttribute('data-pan', 'ready')
  expect(await stage.locator('.panel-media').evaluate((el: any) => (globalThis as any).getComputedStyle(el).cursor)).toBe('grab')
  await page.mouse.down()
  await expect(viewport).toHaveAttribute('data-pan', 'panning')
  await page.mouse.move(cx + 40, cy + 40, { steps: 5 })
  await page.mouse.up()
  movedBack(before, await scroll())
  // A double-click while Space is held is two pans, not a new line.
  await page.mouse.dblclick(cx, cy)
  await page.keyboard.up('Space')
  await expect(viewport).not.toHaveAttribute('data-pan')
  await expect(level).toHaveText('244%')
  await expect(stage.getByRole('textbox', { name: 'Line text' })).toHaveCount(0)

  // Without Space, a double-click on the panel adds a line, as before.
  await page.mouse.dblclick(cx, cy)
  await expect(stage.getByRole('textbox', { name: 'Line text' })).toBeFocused()
  await page.keyboard.press('Escape')
  await app.close()
})

// Add a Shout bubble from the stage, give it a font and a fill, point its tail with the dot, and find all of it on the
// strip: the card draws the shout in that fill with a tail, and the panel's JSON holds the look and the tail.
test('add, style and point a bubble, and find it on the strip', async () => {
  const { app, page, projectsRoot } = await launchApp()
  await createProjectAndSession(page, 'Moon Diary')
  await page.getByTestId('tab-webtoon').click()
  await page.getByTestId('add-panel').last().click()
  const workspace = page.getByTestId('panel-workspace')
  await workspace.getByRole('button', { name: 'Generate' }).click()
  const stage = workspace.getByTestId('panel-stage')
  await expect(stage.locator('img')).toHaveCount(1)
  await setWindowSize(app, page, 1440, 900)
  const stored = async () => (await readProjectJson(projectsRoot, 'panels'))[0]

  await workspace.getByRole('button', { name: 'Add bubble', exact: true }).click()
  await workspace.getByRole('menuitem', { name: 'Shout' }).click()
  await expect(stage.locator('.bubble-editor')).toBeFocused()
  await page.keyboard.type('BOOM!')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await stored()).dialogue[0]?.style).toEqual({ shape: 'shout' })

  await workspace.getByLabel('Font', { exact: true }).selectOption({ label: 'Anton' })
  await workspace.getByLabel('Fill', { exact: true }).fill('#ff8800')
  await expect.poll(async () => (await stored()).dialogue[0].style).toMatchObject({ shape: 'shout', font: 'impact', fill: '#ff8800' })

  await pointDot(page, stage, 0.75, 0.9, async () => (await stored()).dialogue[0].tail !== null)
  await expect(stage.locator('.bubble-tail path')).toHaveCount(1)

  await workspace.getByRole('button', { name: 'Back to the strip' }).click()
  const card = page.getByTestId('panel-card').first()
  const shout = card.locator('.bubble-shout')
  await expect(shout).toHaveText('BOOM!')
  expect(await shout.evaluate((el: any) => el.style.getPropertyValue('--bubble-fill'))).toBe('#ff8800')
  await expect(card.locator('.bubble-tail path')).toHaveCount(1)
  const line = (await stored()).dialogue[0]
  expect(line.style).toBeTruthy()
  expect(line.tail).toMatchObject({ x: expect.any(Number), y: expect.any(Number) })
  await app.close()
})

// In the smallest window the stage is short, and the menu must still show all six choices: each one is what a click at
// its centre reaches, and a real click on Speech opens the new bubble's text.
test('the Add bubble menu shows all six choices in the smallest window', async () => {
  const { app, page } = await launchApp()
  await createProjectAndSession(page, 'Moon Diary')
  await page.getByTestId('tab-webtoon').click()
  await page.getByTestId('add-panel').last().click()
  const workspace = page.getByTestId('panel-workspace')
  await workspace.getByRole('button', { name: 'Generate' }).click()
  const stage = workspace.getByTestId('panel-stage')
  await expect(stage.locator('img')).toHaveCount(1)
  await setWindowSize(app, page, 960, 600)

  await workspace.getByRole('button', { name: 'Add bubble', exact: true }).click()
  const names = ['Speech', 'Shout', 'Whisper', 'Thought', 'Caption', 'Sound effect']
  for (const name of names) {
    const box = await boxOf(page.getByRole('menuitem', { name, exact: true }))
    const hit = await page.evaluate(([x, y]) => {
      const el = (globalThis as any).document.elementFromPoint(x, y)
      return el?.closest('[role="menuitem"]')?.textContent ?? null
    }, [box.x + box.width / 2, box.y + box.height / 2])
    expect(hit, `${name} is what a click at its centre reaches`).toBe(name)
  }
  await page.getByRole('menuitem', { name: 'Speech', exact: true }).click()
  await expect(stage.locator('.bubble-editor')).toBeFocused()
  await page.keyboard.press('Escape')
  await app.close()
})

/** A panel the mock draws with these lines and no cast, open in the editor at a laptop size. */
async function openPanelWith(dialogue: object[]) {
  const { app, page, projectsRoot } = await launchApp({
    script: {
      turns: [
        { toolCalls: [{ name: 'create_panel', input: { episodeId: { $episode: 'current' }, description: 'An empty street.', setting: 'Street at night', shot: 'wide', characters: [], dialogue } }] },
        { text: 'Drew panel 1.' }
      ]
    }
  })
  await createProjectAndSession(page, 'Moon Diary')
  await sendChat(page, 'Draw panel 1', 'Drew panel 1.')
  await page.getByTestId('tab-webtoon').click()
  const card = page.getByTestId('panel-card').first()
  await expect(card.locator('img')).toHaveCount(1)
  const panelId = (await card.getAttribute('data-panel-id'))!
  await setWindowSize(app, page, 1440, 900)
  await card.click()
  const workspace = page.getByTestId('panel-workspace')
  const stage = workspace.getByTestId('panel-stage')
  await expect(stage.locator('.bubble')).toHaveCount(dialogue.length)
  const stored = async (): Promise<any[]> => (await readProjectJson(projectsRoot, `panels/${panelId}.json`)).dialogue
  return { app, page, workspace, stage, stored }
}

// A press focuses a button before it is released. If that focus selected the row, its style block would open and the
// button would move from under the pointer, or a block above would close and move it up, and no click would fire. So
// these are real clicks, on rows that are not selected.
test("a row's buttons take the first click, and a lower row's text takes the focus, with a block open above or not", async () => {
  const spot = { x: 0.5, y: 0.5 }
  const narrated = (text: string, placement: object | null = null) => ({ speakerId: null, kind: 'narration', text, placement })
  const { app, workspace, page, stored } = await openPanelWith([narrated('One'), narrated('Two', spot), narrated('Three', spot), narrated('Four'), narrated('Five'), narrated('Six')])
  const area = workspace.getByRole('tabpanel')
  const row = (i: number): Locator => area.locator('.line-row').nth(i)
  const texts = async (): Promise<string[]> => (await stored()).map((l) => l.text)

  // Nothing is selected: Remove and Reset to auto act on the first click, and open no block.
  await expect(area.locator('.bubble-style')).toHaveCount(0)
  await row(5).getByRole('button', { name: 'Remove' }).click()
  await expect.poll(texts).toEqual(['One', 'Two', 'Three', 'Four', 'Five'])
  await row(1).getByRole('button', { name: 'Reset to auto' }).click()
  await expect.poll(async () => (await stored())[1].placement).toBeNull()
  await expect(area.locator('.bubble-style')).toHaveCount(0)

  // With a block open on the first row, the same goes for the rows below it, and the block stays where it is.
  await row(0).getByLabel('Text', { exact: true }).click()
  await expect(row(0).locator('.bubble-style')).toBeVisible()
  await row(4).getByRole('button', { name: 'Remove' }).click()
  await expect.poll(texts).toEqual(['One', 'Two', 'Three', 'Four'])
  await row(2).getByRole('button', { name: 'Reset to auto' }).click()
  await expect.poll(async () => (await stored())[2].placement).toBeNull()
  await expect(row(0).locator('.bubble-style')).toBeVisible()

  // The text of a lower row moves up as the block above it closes, under the press: it still has the focus, and what
  // is typed lands in that row.
  const lower = row(3).getByLabel('Text', { exact: true })
  await lower.click()
  await expect(lower).toBeFocused()
  await expect(row(3).locator('.bubble-style')).toBeVisible()
  await expect(row(0).locator('.bubble-style')).toHaveCount(0)
  await page.keyboard.type(' typed')
  await expect.poll(async () => (await stored())[3].text).toContain('typed')
  expect((await texts()).slice(0, 3)).toEqual(['One', 'Two', 'Three'])
  await app.close()
})

// A removal is not a reason to scroll: the user is working where they clicked. Row 0 is selected and off screen, and a
// Remove near the bottom must leave the Lines area where it is.
test('Remove leaves the Lines list where it was scrolled, with the selected row off screen', async () => {
  const names = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine']
  const { app, workspace, stored } = await openPanelWith(names.map((text) => ({ speakerId: null, kind: 'narration', text, placement: null })))
  const area = workspace.getByRole('tabpanel')
  const row = (i: number): Locator => area.locator('.line-row').nth(i)

  await row(0).getByLabel('Text', { exact: true }).click()
  await expect(row(0)).toHaveAttribute('aria-current', 'true')
  const scrollTop = (): Promise<number> => area.evaluate((el: any) => el.scrollTop)
  await area.evaluate((el: any) => {
    el.scrollTop = el.scrollHeight
  })
  const before = await scrollTop()
  expect(before).toBeGreaterThan(0)
  const rowHeight = (await boxOf(row(7))).height

  // Twice: it must not come back on the second, either.
  for (const left of [8, 7]) {
    await row(left - 1).getByRole('button', { name: 'Remove' }).click()
    await expect.poll(async () => (await stored()).length).toBe(left)
    await expect(area.locator('.line-row')).toHaveCount(left)
    // The browser clamps the position to the shorter list: at the bottom, that is all that may change. A scroll back to
    // the selected row would land near 0.
    const furthest = await area.evaluate((el: any) => el.scrollHeight - el.clientHeight)
    expect(Math.abs((await scrollTop()) - Math.min(before, furthest))).toBeLessThanOrEqual(rowHeight)
    expect(await scrollTop()).toBeGreaterThan(rowHeight * 3)
    await expect(row(0)).toHaveAttribute('aria-current', 'true')
    await expect(row(0).getByLabel('Text', { exact: true })).toHaveValue('One')
  }
  await app.close()
})

// Selection is by index, so a removal above the selected line would leave the block on the next one.
test('Remove above the selected row keeps its style block on the same line', async () => {
  const names = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven']
  const { app, workspace, stage, stored } = await openPanelWith(names.map((text) => ({ speakerId: null, kind: 'narration', text, placement: null })))
  const area = workspace.getByRole('tabpanel')
  const row = (i: number): Locator => area.locator('.line-row').nth(i)
  const open = area.locator('.line-row:has(.bubble-style)')

  await row(3).getByLabel('Text', { exact: true }).click()
  await expect(open).toHaveCount(1)
  await expect(open.getByLabel('Text', { exact: true })).toHaveValue('Four')
  await row(1).getByRole('button', { name: 'Remove' }).click()
  await expect.poll(async () => (await stored()).map((l) => l.text)).toEqual(['One', 'Three', 'Four', 'Five', 'Six', 'Seven'])
  await expect(open).toHaveCount(1)
  await expect(open.getByLabel('Text', { exact: true })).toHaveValue('Four')
  await expect(stage.locator('.bubble[data-selected="true"]')).toHaveText('Four')

  // The same with the last line selected.
  await row(5).getByLabel('Text', { exact: true }).click()
  await expect(open.getByLabel('Text', { exact: true })).toHaveValue('Seven')
  await row(0).getByRole('button', { name: 'Remove' }).click()
  await expect.poll(async () => (await stored()).length).toBe(5)
  await expect(open).toHaveCount(1)
  await expect(open.getByLabel('Text', { exact: true })).toHaveValue('Seven')
  await expect(stage.locator('.bubble[data-selected="true"]')).toHaveText('Seven')
  await app.close()
})

/** Presses a bubble at its centre and drags it to a point of the panel, in fractions; beyond 1 is past its edge. */
async function dragBubble(page: Page, stage: Locator, bubble: Locator, x: number, y: number): Promise<void> {
  const from = await boxOf(bubble)
  const media = await boxOf(stage.locator('.panel-media'))
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(media.x + media.width * x, media.y + media.height * y, { steps: 12 })
  await page.mouse.up()
}

// A bubble at the panel's edge has its resting dot held inside the panel, where a press can reach it, and focus on the
// dot scrolls nothing: the art stays in its frame.
test("a resting dot at the panel's edge can be pressed and tabbed to, and the art stays put", async () => {
  const spot = { x: 0.5, y: 0.5 }
  const { app, page, stage, stored } = await openPanelWith([
    { speakerId: null, kind: 'speech', text: 'Low', placement: spot, tail: 'none' },
    // No speaker in the cast: its automatic tail leaves through the top of the frame.
    { speakerId: null, kind: 'speech', text: 'High', placement: { x: 0.5, y: 0.3 } }
  ])
  const dot = stage.locator('.bubble-tail-handle')
  const scrolled = (): Promise<number> => stage.locator('.panel-media').evaluate((el: any) => el.scrollTop)
  const dotTakesThePress = async (): Promise<string | null> => {
    const box = await boxOf(dot)
    return page.evaluate(([x, y]) => (globalThis as any).document.elementFromPoint(x, y)?.className ?? null, [box.x + box.width / 2, box.y + box.height / 2])
  }

  // At the bottom edge, with no tail: the dot rests below the bubble, or would.
  const low = stage.locator('[data-line="0"]')
  await dragBubble(page, stage, low, 0.5, 1.1)
  await expect.poll(async () => (await stored())[0].placement.y).toBeGreaterThan(0.85)
  await expect.poll(dotTakesThePress).toBe('bubble-tail-handle')
  await low.focus()
  await page.keyboard.press('Tab')
  await expect(dot).toBeFocused()
  expect(await scrolled()).toBe(0)

  // A drag from it points the tail.
  await pointDot(page, stage, 0.25, 0.5, async () => typeof (await stored())[0].tail === 'object')
  const tip = (await stored())[0].tail
  expect(Math.abs(tip.x - 0.25)).toBeLessThanOrEqual(0.02)
  expect(Math.abs(tip.y - 0.5)).toBeLessThanOrEqual(0.02)
  expect(await scrolled()).toBe(0)

  // A stored tip stays where it was put, even at the very edge with half its dot cut off, and focus on it scrolls nothing.
  await pointDot(page, stage, 0.5, 1.05, async () => (await stored())[0].tail.y > 0.99)
  await low.focus()
  await page.keyboard.press('Tab')
  await expect(dot).toBeFocused()
  expect(await scrolled()).toBe(0)

  // At the top edge, with a tail that leaves through the frame: the dot would rest above the panel.
  const high = stage.locator('[data-line="1"]')
  await dragBubble(page, stage, high, 0.5, -0.1)
  await expect.poll(async () => (await stored())[1].placement.y).toBeLessThan(0.15)
  await expect.poll(dotTakesThePress).toBe('bubble-tail-handle')
  await high.focus()
  await page.keyboard.press('Tab')
  await expect(dot).toBeFocused()
  expect(await scrolled()).toBe(0)
  await app.close()
})

// The look of it is checked by eye; this holds the rule. Each side of the fill's wedge sits 1.5 outline widths in from the
// outline's wedge, and with no outline there is no wedge of it to show.
test("an automatic tail's sides follow the outline's width", async () => {
  const line = (text: string, strokeWidth?: number) => ({ speakerId: null, kind: 'speech', text, placement: { x: 0.5, y: 0.5 }, style: strokeWidth === undefined ? null : { strokeWidth } })
  const { app, stage } = await openPanelWith([line('None', 0), line('Usual'), line('Heavy', 6)])
  const wedges = (i: number): Promise<{ outline: number; fill: number }> =>
    stage.locator(`[data-line="${i}"]`).evaluate((el: any) => {
      const width = (pseudo: string): number => parseFloat((globalThis as any).getComputedStyle(el, pseudo).width)
      return { outline: width('::before'), fill: width('::after') }
    })
  const [none, usual, heavy] = [await wedges(0), await wedges(1), await wedges(2)]
  expect(none.outline).toBe(0)
  expect(none.fill).toBeGreaterThan(0)
  expect(usual.outline - usual.fill).toBeCloseTo(6)
  expect(heavy.outline - heavy.fill).toBeCloseTo(18)
  expect(heavy.outline).toBeCloseTo(usual.outline)
  await app.close()
})

// The right handle of a bubble is dragged just after a fill is picked in its row: the stored width is the share it was
// dragged to, the fill is kept, and the bubble is drawn that wide against its panel, on the stage and on the strip.
test("a bubble's width is set by dragging its handle", async () => {
  const { app, page, workspace, stage, stored } = await openPanelWith([{ speakerId: null, kind: 'speech', text: 'A line long enough to wrap in a narrow bubble', placement: { x: 0.5, y: 0.4 } }])
  const bubble = stage.locator('[data-line="0"]')
  const handle = bubble.locator('.bubble-width-handle[data-edge="right"]')
  await bubble.click()
  await expect(handle).toBeVisible()
  // A press at the handle's centre reaches the handle, not the bubble's text under it.
  const at = await boxOf(handle)
  const grip = { x: at.x + at.width / 2, y: at.y + at.height / 2 }
  const hit = await page.evaluate(([x, y]) => (globalThis as any).document.elementFromPoint(x, y)?.className ?? null, [grip.x, grip.y])
  expect(hit).toBe('bubble-width-handle')

  await workspace.getByLabel('Fill', { exact: true }).fill('#ffe066')
  const share = 0.6
  const from = await boxOf(bubble)
  const media = await boxOf(stage.locator('.panel-media'))
  await page.mouse.move(grip.x, grip.y)
  await page.mouse.down()
  await page.mouse.move(from.x + media.width * share, grip.y, { steps: 12 })
  await page.mouse.up()
  await expect.poll(async () => (await stored())[0].style?.width ?? null).not.toBeNull()
  const { style } = (await stored())[0]
  expect(Math.abs(style.width - share), 'the width is the share dragged to').toBeLessThanOrEqual(0.01)
  expect(style.fill, 'the fill picked just before is kept').toBe('#ffe066')

  /** The bubble's width over its panel's, as drawn. */
  const drawn = async (scope: Locator): Promise<number> => (await boxOf(scope.locator('.bubble').first())).width / (await boxOf(scope.locator('.panel-media'))).width
  await expect.poll(async () => Math.abs((await drawn(stage)) - style.width) <= 0.02, { message: 'the stage draws the width' }).toBe(true)

  await workspace.getByRole('button', { name: 'Back to the strip' }).click()
  const card = page.getByTestId('panel-card').first()
  await expect(card.locator('.bubble-sized')).toHaveCount(1)
  expect(Math.abs((await drawn(card)) - style.width), 'the strip draws the width').toBeLessThanOrEqual(0.02)
  await app.close()
})

// The handles' hit areas are mostly outside the bubble's sides, so a short selected bubble is still moved by a press on
// it a little off its centre, either side, and its width is left alone.
test('a press near the middle of a short selected bubble moves it and leaves its width alone', async () => {
  const { app, page, stage, stored } = await openPanelWith([{ speakerId: null, kind: 'speech', text: 'Hi', placement: { x: 0.5, y: 0.5 } }])
  const bubble = stage.locator('[data-line="0"]')
  await bubble.click()
  await expect(bubble.locator('.bubble-width-handle')).toHaveCount(2)
  for (const [dx, to] of [
    [-8, 0.3],
    [8, 0.6]
  ]) {
    const box = await boxOf(bubble)
    const media = await boxOf(stage.locator('.panel-media'))
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(media.x + media.width * to, media.y + media.height * to, { steps: 12 })
    await page.mouse.up()
    // Grabbed `dx` px off its centre, so its centre lands that far from the pointer.
    const want = { x: to - dx / media.width, y: to }
    const near = (p: { x: number; y: number } | null): boolean => p !== null && Math.abs(p.x - want.x) <= 0.01 && Math.abs(p.y - want.y) <= 0.01
    await expect.poll(async () => near((await stored())[0].placement), { message: `moved by a press ${dx} px off its centre` }).toBe(true)
    expect((await stored())[0].style, 'its width is left alone').toBeNull()
  }
  await app.close()
})

// Two bubbles on one spot: the one underneath, selected from its row, comes to the front and takes the press.
test('a selected bubble under another takes the press', async () => {
  const spot = { x: 0.5, y: 0.5 }
  const { app, page, workspace, stage, stored } = await openPanelWith([
    { speakerId: null, kind: 'narration', text: 'The line underneath it', placement: spot },
    { speakerId: null, kind: 'narration', text: 'The line drawn on top', placement: spot }
  ])
  const under = stage.locator('[data-line="0"]')
  const box = await boxOf(under)
  const at = [box.x + box.width / 2, box.y + box.height / 2]
  const lineUnderPointer = (): Promise<string | null> => page.evaluate(([x, y]) => (globalThis as any).document.elementFromPoint(x, y)?.closest('[data-line]')?.getAttribute('data-line') ?? null, at)
  expect(await lineUnderPointer(), 'the later line is drawn on top').toBe('1')

  await workspace.getByRole('tabpanel').locator('.line-row').first().getByLabel('Text', { exact: true }).click()
  await expect(under).toHaveAttribute('data-selected', 'true')
  await expect.poll(lineUnderPointer).toBe('0')

  await dragBubble(page, stage, under, 0.3, 0.3)
  await expect.poll(async () => (await stored())[0].placement.y).toBeLessThan(0.4)
  expect((await stored())[1].placement).toEqual(spot)
  await app.close()
})
