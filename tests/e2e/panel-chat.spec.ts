import { expect, test } from '@playwright/test'
import { createProjectAndSession, launchApp, sendChat } from './helpers'

// Milestone 4 checkpoint: select a panel, edit it from the side chat, step back through its versions with the switcher.
// The mock script has one cursor for the whole app, so its turns are consumed in the order the runs ask for them.
test('select a panel, edit it from the side chat, revert', async () => {
  const { app, page } = await launchApp({
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
                characters: [{ characterId: { $character: 'Mina' }, variationId: { $variation: ['Mina', 'Base'] } }],
                dialogue: []
              }
            }
          ]
        },
        { text: 'Drew panel 1.' },
        { toolCalls: [{ name: 'edit_image', input: { instruction: 'make her smile' } }] }, // side chat turn
        { text: 'Updated.' },
        { text: 'Still here.' } // main chat turn, sent while the side chat is open
      ]
    }
  })
  await createProjectAndSession(page, 'Moon Diary')
  await sendChat(page, 'Create Mina', 'Created Mina.')
  await sendChat(page, 'Draw panel 1', 'Drew panel 1.')
  await page.getByTestId('tab-webtoon').click()
  await page.getByTestId('panel-card').first().click()
  const side = page.getByTestId('panel-side-chat')
  await expect(side).toBeVisible()
  await expect(side.getByTestId('panel-version-label')).toHaveText('v1 / 1')

  await side.getByTestId('composer-input').fill('make her smile')
  await side.getByTestId('composer-send').click()
  await expect(side.getByTestId('panel-version-label')).toHaveText('v2 / 2')
  await expect(side.getByTestId('message-assistant').last()).toContainText('Updated.')

  // The side chat is open below the main chat, and the main chat's helper still talks to the main chat only.
  await sendChat(page, 'Anything else?', 'Still here.')
  await expect(side.getByTestId('message-assistant')).toHaveCount(1)
  await expect(side).not.toContainText('Still here.')
  await expect(page.getByTestId('pane-chat').locator('.main-chat').getByTestId('message-assistant')).toHaveCount(3)

  await side.getByTestId('version-prev').click()
  await expect(side.getByTestId('panel-version-label')).toHaveText('v1 / 2')
  await expect(side.getByTestId('version-prev')).toBeDisabled()
  await expect(side.getByTestId('version-next')).toBeEnabled()

  await page.keyboard.press('Escape')
  await expect(side).toBeHidden()
  await app.close()
})
