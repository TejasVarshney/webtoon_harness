import { expect, test } from '@playwright/test'
import { createProjectAndSession, launchApp } from './helpers'

// Milestone 2 checkpoint: the agent makes a character through its tools, the user adds a variation by hand,
// and both show up live in the Characters tab.
test('agent creates a character and a variation that appear in the Characters tab', async () => {
  const { app, page } = await launchApp({
    script: {
      turns: [
        {
          toolCalls: [
            {
              name: 'create_character',
              input: {
                name: 'Mina',
                role: 'protagonist',
                appearanceLock: 'Teenage girl, slim build, silver bob haircut, amber eyes, red bomber jacket.'
              }
            }
          ]
        },
        { text: 'Created Mina.' }
      ]
    }
  })
  await createProjectAndSession(page, 'Moon Diary')
  await page.getByTestId('composer-input').fill('Create Mina')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText('Created Mina.')
  await page.getByTestId('tab-characters').click()
  await page.getByTestId('character-card').filter({ hasText: 'Mina' }).click()
  await page.getByRole('button', { name: 'Add variation' }).click()
  const form = page.getByTestId('variation-form')
  await form.getByLabel('Name').fill('Outfit: School uniform')
  await form.getByLabel('Delta').fill('navy blazer, pleated skirt')
  await form.getByRole('button', { name: 'Create variation' }).click()
  await expect(page.getByTestId('variation-card').locator('img')).toHaveCount(2)
  await app.close()
})
