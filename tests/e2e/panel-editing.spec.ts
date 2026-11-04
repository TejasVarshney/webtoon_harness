import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createProjectAndSession, launchApp, readProjectJson, sendChat } from './helpers'

const shots = resolve(__dirname, '..', '..', 'test-results', 'panel-editing')

/** The page's viewport size. The specs are type-checked without the DOM's types, so `window` is reached through `globalThis`. */
const viewport = (page: Page): Promise<[number, number]> => page.evaluate(() => [(globalThis as any).innerWidth, (globalThis as any).innerHeight])

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
// layout, ask the panel chat for an edit, go back. The strip shows the new text in the new spot, on the card the user
// left from, and only the chat's edit drew a new version.
test('edit a panel in editing mode and find the changes on the strip', async () => {
  const mina = { $character: 'Mina' }
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
                dialogue: [{ speakerId: mina, kind: 'speech', text: 'Is that the moon?' }]
              }
            }
          ]
        },
        { text: 'Drew panel 1.' },
        { toolCalls: [{ name: 'edit_image', input: { instruction: 'make her smile' } }] }, // panel chat turn
        { text: 'Updated.' }
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
  const from = (await bubble.boundingBox())!
  const media = (await stage.locator('.panel-media').boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(media.x + media.width * 0.25, media.y + media.height * 0.75, { steps: 12 })
  await page.mouse.up()
  await expect(stage.locator('.dialogue-placed .bubble')).toHaveText("It's huge!")
  const near = (p: { x: number; y: number } | null): boolean => p !== null && Math.abs(p.x - 0.25) <= 0.02 && Math.abs(p.y - 0.75) <= 0.02
  await expect.poll(async () => near((await stored()).dialogue[0].placement), { message: 'line 0 is placed at 25% / 75%' }).toBe(true)

  // 4. A layout change saves without a redraw.
  const versions = (await stored()).versions.length
  await workspace.getByRole('tab', { name: 'Scene' }).click()
  await workspace.getByLabel('Gutter').selectOption('black')
  await expect.poll(async () => (await stored()).gutter).toBe('black')
  expect((await stored()).versions).toHaveLength(versions)
  await expect(workspace.getByTestId('panel-version-label')).toHaveText('v1 / 1')

  // 5. The panel chat edits the image: a new version.
  await workspace.getByTestId('composer-input').fill('make her smile')
  await workspace.getByTestId('composer-send').click()
  await expect(workspace.getByTestId('panel-version-label')).toHaveText('v2 / 2')
  await expect(workspace.getByTestId('message-assistant').last()).toContainText('Updated.')

  // 6. How it looks, at a laptop size and at a small one.
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

  // 7. Back to the strip: the card the user left from has the focus, and its bubble has the new text in the new spot.
  await workspace.getByRole('button', { name: 'Back to the strip' }).click()
  await expect(workspace).toHaveCount(0)
  await expect(card).toBeFocused()
  const placed = card.locator('.dialogue-placed .bubble')
  await expect(placed).toHaveText("It's huge!")
  const left = await placed.evaluate((el: any) => el.style.left as string)
  expect(left).toMatch(/%$/)
  expect(Math.abs(parseFloat(left) - 25)).toBeLessThanOrEqual(2)
  await app.close()
})
