import { expect, test } from '@playwright/test'
import { launchApp } from './helpers'

test('launches with the three-pane shell', async () => {
  const { app, page } = await launchApp()
  try {
    await expect(page).toHaveTitle('Webtoon AI Harness')
    await expect(page.getByTestId('pane-sessions')).toBeVisible()
    await expect(page.getByTestId('pane-chat')).toBeVisible()
    await expect(page.getByTestId('pane-visualizer')).toBeVisible()
  } finally {
    await app.close()
  }
})
