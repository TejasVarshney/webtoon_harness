import { expect, test } from '@playwright/test'
import { launchApp } from './helpers'

test('launches on the home page, then opens the three-pane shell', async () => {
  const { app, page } = await launchApp()
  try {
    await expect(page).toHaveTitle('Webtoon AI Harness')
    await expect(page.getByRole('heading', { name: 'Start your first project' })).toBeVisible()
    await expect(page.getByTestId('pane-chat')).toHaveCount(0)
    await page.getByTestId('new-project').click()
    await page.getByLabel('Title').fill('Moon Diary')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByTestId('pane-sessions')).toBeVisible()
    await expect(page.getByTestId('pane-chat')).toBeVisible()
    await expect(page.getByTestId('pane-visualizer')).toBeVisible()
  } finally {
    await app.close()
  }
})
