import { expect, test } from '@playwright/test'
import { createProjectAndSession, launchApp, readProjectJson, sendChat } from './helpers'

// Milestone 3 checkpoint: the user draws the first panel by hand in the Webtoon tab, then asks the agent for the next one;
// the agent's panel is generated with the user's panel as its previous-panel reference.
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
  const editor = page.getByTestId('panel-editor')
  await editor.getByLabel('Description').fill('Mina stands on the rooftop.')
  await editor.getByLabel('Setting').fill('Rooftop at dusk')
  await editor.getByRole('button', { name: 'Add character' }).click()
  await editor.getByLabel('Character').selectOption({ label: 'Mina' })
  await editor.getByRole('button', { name: 'Create & generate' }).click()
  await expect(page.getByTestId('panel-card').locator('img')).toHaveCount(1)
  await sendChat(page, 'Draw the next panel', 'Drew panel 2.')
  await expect(page.getByTestId('panel-card').locator('img')).toHaveCount(2)
  const episode = (await readProjectJson(projectsRoot, 'episodes')).find(Boolean) // the helper returns the parsed files of a folder
  const [first, second] = await Promise.all(episode.panelIds.map((id: string) => readProjectJson(projectsRoot, `panels/${id}.json`)))
  expect(second.versions[0].referenceImagePaths).toContain(first.versions[0].imagePath)
  await app.close()
})

// Panel shapes: a panel set beside the previous one shares its row, and a slanted panel's toolbar is not cut off by
// the slant, so its Edit button still opens the editor.
test('a panel set beside and slanted in the editor joins the row and keeps its toolbar', async () => {
  const { app, page } = await launchApp()
  await createProjectAndSession(page, 'Moon Diary')
  await page.getByTestId('tab-webtoon').click()
  for (const description of ['Mina looks up.', 'Jun looks back.']) {
    await page.getByTestId('add-panel').last().click()
    const editor = page.getByTestId('panel-editor')
    await editor.getByLabel('Description').fill(description)
    await editor.getByRole('button', { name: 'Create without image' }).click()
    await expect(editor).toHaveCount(0)
  }
  const cards = page.getByTestId('panel-card')
  await expect(cards).toHaveCount(2)
  await expect(page.locator('.strip-row[data-row-size="1"]')).toHaveCount(2)

  await cards.nth(1).getByRole('button', { name: 'Edit' }).click()
  const editor = page.getByTestId('panel-editor')
  await editor.getByLabel('Frame').selectOption('slanted')
  await editor.getByLabel('Beside the previous panel').check()
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(editor).toHaveCount(0)

  await expect(page.locator('.strip-row[data-row-size="2"]')).toHaveCount(1)
  await expect(page.locator('.strip-row')).toHaveCount(1)
  const slanted = page.locator('.panel-card[data-frame="slanted"]')
  await expect(slanted).toHaveAttribute('data-beside', 'true')
  await slanted.getByRole('button', { name: 'Edit' }).click()
  await expect(editor).toBeVisible()
  await expect(editor.getByLabel('Frame')).toHaveValue('slanted')
  await app.close()
})

// The toolbar is wider than a narrow card. It grows towards the row, so the first card of a row (which has nothing to its
// left) must still show all of it, and its Edit button must still open the editor.
test('the toolbar of a narrow first card in a row stays inside the strip', async () => {
  const { app, page } = await launchApp()
  await createProjectAndSession(page, 'Moon Diary')
  await page.getByTestId('tab-webtoon').click()
  const specs = [
    { description: 'Mina looks up at the tower.', aspect: '1:3', beside: false },
    { description: 'Jun looks back at her.', aspect: '16:9', beside: true }
  ]
  for (const { description, aspect, beside } of specs) {
    await page.getByTestId('add-panel').last().click()
    const editor = page.getByTestId('panel-editor')
    await editor.getByLabel('Description').fill(description)
    await editor.getByLabel('Aspect').selectOption(aspect)
    if (beside) await editor.getByLabel('Beside the previous panel').check()
    await editor.getByRole('button', { name: 'Create without image' }).click()
    await expect(editor).toHaveCount(0)
  }
  await expect(page.locator('.strip-row[data-row-size="2"]')).toHaveCount(1)

  const first = page.getByTestId('panel-card').first()
  await first.hover()
  const toolbar = first.getByRole('group', { name: 'Panel actions' })
  // Hit-testing, not geometry: a button the pane clips (it cannot scroll left) is not what the pointer lands on.
  for (const name of ['Edit', 'Beside previous', 'Regenerate', 'Move up', 'Move down', 'Delete']) {
    const button = toolbar.getByRole('button', { name })
    const box = (await button.boundingBox())!
    const hit = await button.evaluate((el: any, [x, y]) => el.contains((globalThis as any).document.elementFromPoint(x, y)), [box.x + box.width / 2, box.y + box.height / 2])
    expect(hit, `${name} is reachable`).toBe(true)
  }
  await toolbar.getByRole('button', { name: 'Edit' }).click()
  await expect(page.getByTestId('panel-editor')).toBeVisible()
  await expect(page.getByTestId('panel-editor').getByLabel('Aspect')).toHaveValue('1:3')
  await app.close()
})
