import { expect, test } from '@playwright/test'
import { createProjectAndSession, launchApp } from './helpers'

test('chat with the mock agent', async () => {
  const { app, page } = await launchApp({ script: { turns: [{ text: 'Hello from mock' }] } })
  await createProjectAndSession(page, 'Moon Diary')
  await expect(page.getByTestId('mock-banner')).toBeVisible()
  await page.getByTestId('composer-input').fill('Hi')
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText('Hello from mock')
  await app.close()
})

test('settings opens on the models tab and closes on Escape', async () => {
  const { app, page } = await launchApp()
  await page.getByTestId('settings-open').click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  await expect(page.getByLabel('agent role')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0)
  await app.close()
})
