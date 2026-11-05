import { expect, test } from '@playwright/test'
import { createProjectAndSession, launchApp, sendChat } from './helpers'

// Milestone 4 checkpoint: open a panel, edit it from its panel chat, step back through its versions with the switcher.
// The mock script has one cursor for the whole app, so its turns are consumed in the order the runs ask for them.
test('open a panel, edit it from the panel chat, revert', async () => {
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
        { toolCalls: [{ name: 'edit_image', input: { instruction: 'make her smile' } }] }, // panel chat turn
        { text: 'Updated.' },
        { text: 'Still here.' } // main chat turn, sent after going back to the strip
      ]
    }
  })
  await createProjectAndSession(page, 'Moon Diary')
  await sendChat(page, 'Create Mina', 'Created Mina.')
  await sendChat(page, 'Draw panel 1', 'Drew panel 1.')
  await page.getByTestId('tab-webtoon').click()
  const card = page.getByTestId('panel-card').first()
  await card.click()
  const workspace = page.getByTestId('panel-workspace')
  await expect(workspace).toBeVisible()
  await expect(workspace.getByTestId('panel-version-label')).toHaveText('v1 / 1')

  await workspace.getByTestId('composer-input').fill('make her smile')
  await workspace.getByTestId('composer-send').click()
  await expect(workspace.getByTestId('panel-version-label')).toHaveText('v2 / 2')
  await expect(workspace.getByTestId('message-assistant').last()).toContainText('Updated.')

  // Editing mode covers the main chat (R1): the user goes back to the strip to use it, and its helper still talks to
  // the main chat only.
  await workspace.getByRole('button', { name: 'Back to the strip' }).click()
  await expect(workspace).toHaveCount(0)
  await sendChat(page, 'Anything else?', 'Still here.')
  await expect(page.getByTestId('pane-chat').locator('.main-chat').getByTestId('message-assistant')).toHaveCount(3)

  // The panel's chat kept its own thread, without the main chat's turn.
  await card.click()
  await expect(workspace.getByTestId('message-assistant')).toHaveCount(1)
  await expect(workspace).not.toContainText('Still here.')

  await workspace.getByTestId('version-prev').click()
  await expect(workspace.getByTestId('panel-version-label')).toHaveText('v1 / 2')
  await expect(workspace.getByTestId('version-prev')).toBeDisabled()
  await expect(workspace.getByTestId('version-next')).toBeEnabled()

  await page.keyboard.press('Escape')
  await expect(workspace).toHaveCount(0)
  await app.close()
})
