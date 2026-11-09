import { expect, test, type Page } from '@playwright/test'
import { createProjectAndSession, launchApp, openFirstProject, readProjectJson, sendChat } from './helpers'

// Milestone 3 checkpoint: the user draws the first panel by hand in the Webtoon tab (the "+" opens a blank panel in editing
// mode), then asks the agent for the next one; the agent's panel is generated with the user's panel as its previous-panel
// reference.
test('user creates a panel manually, agent continues from it', async () => {
  const mina = { $character: 'Mina' }
  const minaBase = { $variation: ['Mina', 'Base'] }
  const { app, page, projectsRoot } = await launchApp({
    script: {
      turns: [
        { toolCalls: [{ name: 'create_character', input: { name: 'Mina', role: 'protagonist', appearanceLock: 'Teenage girl, silver bob haircut, amber eyes, red bomber jacket.' } }] },
        { text: 'Created Mina.' },
        // second user message: refs resolve from its <project_state>
        {
          toolCalls: [
            {
              name: 'create_panel',
              input: {
                episodeId: { $episode: 'current' },
                description: 'She turns toward the door.',
                setting: 'Rooftop at dusk',
                shot: 'medium',
                characters: [{ characterId: mina, variationId: minaBase, action: 'turning', expression: 'curious' }],
                dialogue: []
              }
            }
          ]
        },
        { text: 'Drew panel 2.' }
      ]
    }
  })
  await createProjectAndSession(page, 'Moon Diary')
  await sendChat(page, 'Create Mina', 'Created Mina.')
  await page.getByTestId('tab-webtoon').click()
  await page.getByTestId('add-panel').last().click()
  const workspace = page.getByTestId('panel-workspace')
  await workspace.getByRole('tab', { name: 'Scene' }).click()
  await workspace.getByLabel('Description').fill('Mina stands on the rooftop.')
  await workspace.getByLabel('Setting').fill('Rooftop at dusk')
  await workspace.getByRole('tab', { name: 'Cast' }).click()
  await workspace.getByRole('button', { name: 'Add character' }).click()
  await workspace.getByLabel('Character').selectOption({ label: 'Mina' })
  await workspace.getByRole('button', { name: 'Generate' }).click()
  await expect(workspace.getByTestId('panel-stage').locator('img')).toHaveCount(1)
  await workspace.getByRole('button', { name: 'Back to the strip' }).click()
  await expect(page.getByTestId('panel-card').locator('img')).toHaveCount(1)
  await sendChat(page, 'Draw the next panel', 'Drew panel 2.')
  await expect(page.getByTestId('panel-card').locator('img')).toHaveCount(2)
  const episode = (await readProjectJson(projectsRoot, 'episodes')).find(Boolean) // the helper returns the parsed files of a folder
  const [first, second] = await Promise.all(episode.panelIds.map((id: string) => readProjectJson(projectsRoot, `panels/${id}.json`)))
  expect(second.versions[0].referenceImagePaths).toContain(first.versions[0].imagePath)
  await app.close()
})

/** Adds two blank panels from the strip's "+" and returns to the strip. */
async function addTwoPanels(page: Page): Promise<void> {
  for (const description of ['Mina looks up.', 'Jun looks back.']) {
    await page.getByTestId('add-panel').last().click()
    const editor = page.getByTestId('panel-workspace')
    await editor.getByRole('tab', { name: 'Scene' }).click()
    await editor.getByLabel('Description').fill(description)
    await editor.getByRole('button', { name: 'Back to the strip' }).click()
    await expect(editor).toHaveCount(0)
  }
  await expect(page.getByTestId('panel-card')).toHaveCount(2)
}

/** A card's box in strip px: its place on the canvas, whatever the pane's scale or scroll. */
async function stripBox(page: Page, index: number): Promise<{ x: number; y: number; width: number }> {
  return page.getByTestId('panel-card').nth(index).evaluate((el: any) => {
    const canvas = el.closest('.strip-canvas').getBoundingClientRect()
    const r = el.getBoundingClientRect()
    const scale = canvas.width / 440
    return { x: Math.round((r.left - canvas.left) / scale), y: Math.round((r.top - canvas.top) / scale), width: Math.round(r.width / scale) }
  })
}

// A click on a card selects it, only a double-click opens focus mode, and the tools' buttons are what the pointer
// lands on.
test('a click selects a panel, a double-click opens it, and its tools are reachable', async () => {
  const { app, page } = await launchApp()
  await createProjectAndSession(page, 'Moon Diary')
  await page.getByTestId('tab-webtoon').click()
  await addTwoPanels(page)
  const cards = page.getByTestId('panel-card')
  const workspace = page.getByTestId('panel-workspace')

  await cards.nth(1).click()
  await expect(cards.nth(1)).toHaveAttribute('data-selected', 'true')
  await expect(workspace).toHaveCount(0)

  const toolbar = cards.nth(1).getByRole('toolbar', { name: 'Panel tools' })
  for (const name of ['Lines', 'Cast', 'Items', 'Scene', 'Versions', 'Upload image', 'Redraw', 'Sketch', 'Focus', 'Delete']) {
    const button = toolbar.getByRole('button', { name })
    const box = (await button.boundingBox())!
    const hit = await button.evaluate((el: any, [x, y]) => el.contains((globalThis as any).document.elementFromPoint(x, y)), [box.x + box.width / 2, box.y + box.height / 2])
    expect(hit, `${name} is reachable`).toBe(true)
  }

  await cards.nth(1).dblclick()
  await expect(workspace.getByRole('heading', { level: 1 })).toHaveText('Panel 2 of 2')
  await workspace.getByRole('button', { name: 'Back to the strip' }).click()
  await app.close()
})

// A drag puts a panel where the pointer left it, saves that place, and a resize keeps the shape. The place survives a
// relaunch.
test('a dragged panel stays where it was put after a relaunch', async () => {
  const first = await launchApp()
  const { page, projectsRoot, userDataDir } = first
  await createProjectAndSession(page, 'Moon Diary')
  await page.getByTestId('tab-webtoon').click()
  await addTwoPanels(page)

  const before = await stripBox(page, 1)
  const card = page.getByTestId('panel-card').nth(1)
  const box = (await card.boundingBox())!
  const canvasScale = (await page.locator('.strip-canvas').evaluate((el: any) => el.getBoundingClientRect().width)) / 440
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 24 * canvasScale, from.y + 40 * canvasScale, { steps: 8 })
  await page.mouse.up()

  const id = (await card.getAttribute('data-panel-id'))!
  // x is held inside the strip, and y moves by the drag.
  await expect.poll(async () => (await readProjectJson(projectsRoot, `panels/${id}.json`)).placement).toBeTruthy()
  const stored = (await readProjectJson(projectsRoot, `panels/${id}.json`)).placement
  expect(stored.width).toBe(before.width)
  expect(Math.abs(stored.y - (before.y + 40))).toBeLessThanOrEqual(2)
  const moved = await stripBox(page, 1)
  expect(moved).toEqual({ x: stored.x, y: stored.y, width: stored.width })
  // A drag is not a click: nothing opened.
  await expect(page.getByTestId('panel-workspace')).toHaveCount(0)

  // Resize from the corner: the width follows the pointer.
  await card.hover()
  const handle = (await card.getByTestId('panel-resize').boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + handle.width / 2 - 40 * canvasScale, handle.y + handle.height / 2, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await readProjectJson(projectsRoot, `panels/${id}.json`)).placement.width).toBeLessThan(stored.width - 30)
  const resized = (await readProjectJson(projectsRoot, `panels/${id}.json`)).placement
  const settled = await stripBox(page, 1)
  expect(settled).toEqual({ x: resized.x, y: resized.y, width: resized.width })

  await first.app.close()
  const again = await launchApp({ userDataDir, projectsRoot })
  await openFirstProject(again.page)
  await again.page.getByTestId('tab-webtoon').click()
  await expect(again.page.getByTestId('panel-card')).toHaveCount(2)
  expect(await stripBox(again.page, 1)).toEqual(settled)
  await again.app.close()
})

// A new panel opens on a blank sketch: what the user scribbles there is stored as the panel's sketch and sent with the
// next generation as its layout reference, and the picture replaces the sketch on the stage once it lands.
test('a sketch drawn on a new panel is the layout reference of its generation', async () => {
  const { app, page, projectsRoot } = await launchApp()
  await createProjectAndSession(page, 'Moon Diary')
  await page.getByTestId('tab-webtoon').click()
  await page.getByTestId('add-panel').last().click()
  const workspace = page.getByTestId('panel-workspace')
  const canvas = workspace.getByTestId('sketch-canvas')
  await expect(canvas).toBeVisible()
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 8 })
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.8, { steps: 8 })
  await page.mouse.up()

  const episode = (await readProjectJson(projectsRoot, 'episodes')).find(Boolean)
  const id: string = episode.panelIds[0]
  await expect.poll(async () => (await readProjectJson(projectsRoot, `panels/${id}.json`)).sketchPath ?? '').toMatch(/^panels\/pnl_[0-9a-f]+\/sketch-[a-z0-9]+\.png$/)
  // The strip shows the sketch until there is a picture, and reopening the panel brings it back onto the canvas.
  await workspace.getByRole('button', { name: 'Back to the strip' }).click()
  await expect(page.getByTestId('panel-sketch-preview')).toHaveCount(1)
  await page.getByTestId('panel-card').dblclick()
  const inked = await workspace.getByTestId('sketch-canvas').evaluate(async (el: any) => {
    for (let i = 0; i < 50; i++) {
      const { data } = el.getContext('2d').getImageData(0, 0, el.width, el.height)
      for (let p = 3; p < data.length; p += 4) if (data[p] > 128) return true
      await new Promise((r) => setTimeout(r, 50))
    }
    return false
  })
  expect(inked).toBe(true)
  // A new aspect keeps the reopened sketch, fitted into the new shape.
  await workspace.getByRole('tab', { name: 'Scene' }).click()
  await workspace.getByLabel('Aspect').selectOption('16:9')
  await expect.poll(() => workspace.getByTestId('sketch-canvas').evaluate((el: any) => el.width)).toBe(1024)
  await expect.poll(() => workspace.getByTestId('sketch-canvas').evaluate((el: any) => el.height)).toBe(576)
  const stillInked = await workspace.getByTestId('sketch-canvas').evaluate((el: any) => {
    const { data } = el.getContext('2d').getImageData(0, 0, el.width, el.height)
    for (let p = 3; p < data.length; p += 4) if (data[p] > 128) return true
    return false
  })
  expect(stillInked).toBe(true)

  await workspace.getByRole('button', { name: 'Generate' }).click()
  await expect(workspace.getByTestId('panel-stage').locator('img')).toHaveCount(1)
  const panel = await readProjectJson(projectsRoot, `panels/${id}.json`)
  expect(panel.versions[0].referenceImagePaths).toEqual([panel.sketchPath])
  expect(panel.versions[0].prompt).toContain('[LAYOUT] Follow the rough composition of the sketch (reference image 1)')
  await app.close()
})

// The sketch's shapes land where they are dragged, and a zoomed sketch scrolls and still draws under the pointer.
test('sketch shapes and zoom draw where the pointer is', async () => {
  const { app, page } = await launchApp()
  await createProjectAndSession(page, 'Moon Diary')
  await page.getByTestId('tab-webtoon').click()
  await page.getByTestId('add-panel').last().click()
  const workspace = page.getByTestId('panel-workspace')
  const canvas = workspace.getByTestId('sketch-canvas')
  await expect(canvas).toBeVisible()
  /** Whether the canvas pixel at (fx, fy), as fractions of the canvas, is ink. */
  const inkAt = (fx: number, fy: number): Promise<boolean> =>
    canvas.evaluate((el: any, [x, y]) => el.getContext('2d').getImageData(Math.round(x * el.width), Math.round(y * el.height), 1, 1).data[3] > 128, [fx, fy])

  await workspace.getByRole('button', { name: 'Rectangle' }).click()
  let box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 6 })
  await page.mouse.up()
  expect(await inkAt(0.4, 0.2)).toBe(true) // the top edge
  expect(await inkAt(0.2, 0.35)).toBe(true) // the left edge
  expect(await inkAt(0.4, 0.35)).toBe(false) // an outline: the inside stays paper

  const zoom = workspace.getByRole('group', { name: 'Zoom' })
  await zoom.getByRole('button', { name: 'Zoom in' }).click()
  await zoom.getByRole('button', { name: 'Zoom in' }).click()
  await expect(zoom.getByRole('button', { name: /^Zoom \d+%/ })).toHaveText('156%')
  const zoomed = (await canvas.boundingBox())!
  expect(zoomed.width / box.width).toBeCloseTo(1.5625, 1)
  const viewport = workspace.getByTestId('sketch-viewport')
  expect(await viewport.evaluate((el: any) => el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)).toBe(true)

  // Ctrl + wheel zooms further, at the pointer.
  const view = (await viewport.boundingBox())!
  await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -200)
  await page.keyboard.up('Control')
  await expect.poll(async () => parseInt((await zoom.getByRole('button', { name: /^Zoom \d+%/ }).textContent()) ?? '0', 10)).toBeGreaterThan(156)

  // A pen dot in the middle of the visible part lands on the canvas pixel under the pointer.
  await workspace.getByRole('button', { name: 'Pen' }).click()
  box = (await canvas.boundingBox())!
  const x = view.x + view.width / 2
  const y = view.y + view.height / 2
  await page.mouse.click(x, y)
  expect(await inkAt((x - box.x) / box.width, (y - box.y) / box.height)).toBe(true)

  await zoom.getByRole('button', { name: /^Zoom \d+%/ }).click()
  await expect(zoom.getByRole('button', { name: /^Zoom \d+%/ })).toHaveText('100%')
  await app.close()
})

// A drawn panel zooms on its stage, and its sketch is drawn over its picture, shown faintly to trace; the stored sketch
// is the ink alone on white paper. New sketch wipes it and forgets it.
test('a drawn panel zooms, and is sketched over its picture', async () => {
  const { app, page, projectsRoot } = await launchApp()
  await createProjectAndSession(page, 'Moon Diary')
  await page.getByTestId('tab-webtoon').click()
  await page.getByTestId('add-panel').last().click()
  const workspace = page.getByTestId('panel-workspace')
  await workspace.getByRole('button', { name: 'Generate' }).click()
  const stage = workspace.getByTestId('panel-stage')
  await expect(stage.locator('img')).toHaveCount(1)

  // Zoom on the picture: the panel grows and scrolls.
  const before = (await stage.locator('.panel-shape').boundingBox())!
  const zoom = workspace.getByRole('group', { name: 'Zoom' })
  await zoom.getByRole('button', { name: 'Zoom in' }).click()
  await zoom.getByRole('button', { name: 'Zoom in' }).click()
  await expect(zoom.getByRole('button', { name: /^Zoom \d+%/ })).toHaveText('156%')
  const after = (await stage.locator('.panel-shape').boundingBox())!
  expect(after.width / before.width).toBeCloseTo(1.5625, 1)
  expect(await workspace.getByTestId('stage-viewport').evaluate((el: any) => el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)).toBe(true)
  await zoom.getByRole('button', { name: /^Zoom \d+%/ }).click()

  // Sketch over it.
  await workspace.getByRole('button', { name: 'Sketch' }).click()
  await expect(workspace.getByTestId('sketch-underlay')).toBeVisible()
  const sketch = workspace.getByTestId('sketch-stage')
  await expect(sketch.getByRole('button', { name: 'New sketch' })).toBeDisabled()
  const canvas = workspace.getByTestId('sketch-canvas')
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.6, { steps: 8 })
  await page.mouse.up()

  const episode = (await readProjectJson(projectsRoot, 'episodes')).find(Boolean)
  const id: string = episode.panelIds[0]
  await expect.poll(async () => (await readProjectJson(projectsRoot, `panels/${id}.json`)).sketchPath ?? '').toMatch(/sketch-/)
  // The stored sketch: white paper at a corner, ink on the stroke, and nothing of the picture.
  const projectId: string = (await readProjectJson(projectsRoot, 'project.json')).id
  const pixels = await page.evaluate(
    async ([pid, pnl]) => {
      const url: string = await (globalThis as any).window.api.invoke('panels:readSketch', { projectId: pid, panelId: pnl })
      const image = new (globalThis as any).Image()
      await new Promise((resolve) => {
        image.onload = resolve
        image.src = url
      })
      const c = (globalThis as any).document.createElement('canvas')
      c.width = image.width
      c.height = image.height
      const ctx = c.getContext('2d')
      ctx.drawImage(image, 0, 0)
      const at = (fx: number, fy: number) => [...ctx.getImageData(Math.round(fx * c.width), Math.round(fy * c.height), 1, 1).data]
      return { corner: at(0.02, 0.02), stroke: at(0.5, 0.45) }
    },
    [projectId, id]
  )
  expect(pixels.corner).toEqual([255, 255, 255, 255])
  expect(pixels.stroke[0]).toBeLessThan(128)

  // New sketch wipes it all and forgets the stored sketch.
  await sketch.getByRole('button', { name: 'New sketch' }).click()
  await expect.poll(async () => (await readProjectJson(projectsRoot, `panels/${id}.json`)).sketchPath).toBeNull()
  await expect(sketch.getByRole('button', { name: 'New sketch' })).toBeDisabled()
  await app.close()
})
