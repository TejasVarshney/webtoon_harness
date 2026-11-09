import { expect, test } from '@playwright/test'
import { createProjectAndSession, launchApp, openFirstProject, openProjectFromMenu, openSessions } from './helpers'

test('sessions persist across relaunch', async () => {
  const first = await launchApp()
  await first.page.getByTestId('new-project').click()
  await first.page.getByLabel('Title').fill('Moon Diary')
  await first.page.getByRole('button', { name: 'Create' }).click()
  await first.page.getByTestId('new-session').click()
  await openSessions(first.page)
  await expect(first.page.getByTestId('session-item')).toHaveCount(1)
  await first.app.close()

  const second = await launchApp({ userDataDir: first.userDataDir, projectsRoot: first.projectsRoot })
  await openFirstProject(second.page)
  await openSessions(second.page)
  await expect(second.page.getByTestId('session-item')).toHaveCount(1)
  await second.app.close()
})

test('the File menu switches projects and goes home', async () => {
  const { app, page } = await launchApp()
  try {
    await createProjectAndSession(page, 'Moon Diary')
    await page.getByTestId('file-menu').click()
    await page.getByTestId('new-project').click()
    await page.getByLabel('Title').fill('Sun Diary')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.locator('.project-title')).toHaveText('Sun Diary')
    await openSessions(page)
    await expect(page.getByTestId('session-item')).toHaveCount(0)
    await page.keyboard.press('Escape')

    await openProjectFromMenu(page, 'Moon Diary')
    await expect(page.locator('.project-title')).toHaveText('Moon Diary')
    await openSessions(page)
    await expect(page.getByTestId('session-item')).toHaveCount(1)
    await page.keyboard.press('Escape')

    await page.getByTestId('file-menu').click()
    await page.getByTestId('file-menu-home').click()
    await expect(page.getByRole('heading', { name: 'Your projects' })).toBeVisible()
    await expect(page.getByTestId('project-card')).toHaveCount(2)
  } finally {
    await app.close()
  }
})

test('a bookmarked session stays pinned across relaunch', async () => {
  const first = await launchApp()
  await createProjectAndSession(first.page, 'Moon Diary')
  await openSessions(first.page)
  await first.page.getByTestId('session-bookmark').click()
  await expect(first.page.getByRole('heading', { name: 'Bookmarked' })).toBeVisible()
  await first.app.close()

  const second = await launchApp({ userDataDir: first.userDataDir, projectsRoot: first.projectsRoot })
  await openFirstProject(second.page)
  await openSessions(second.page)
  await expect(second.page.getByRole('heading', { name: 'Bookmarked' })).toBeVisible()
  await expect(second.page.getByTestId('session-item')).toHaveCount(1)
  await second.app.close()
})
