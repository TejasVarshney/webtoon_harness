import { expect, test } from '@playwright/test'
import { launchApp } from './helpers'

test('sessions persist across relaunch', async () => {
  const first = await launchApp()
  await first.page.getByTestId('new-project').click()
  await first.page.getByLabel('Title').fill('Moon Diary')
  await first.page.getByRole('button', { name: 'Create' }).click()
  await first.page.getByTestId('new-session').click()
  await expect(first.page.getByTestId('session-item')).toHaveCount(1)
  await first.app.close()

  const second = await launchApp({ userDataDir: first.userDataDir, projectsRoot: first.projectsRoot })
  await expect(second.page.getByTestId('session-item')).toHaveCount(1)
  await second.app.close()
})
