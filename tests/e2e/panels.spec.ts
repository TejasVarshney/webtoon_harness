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
