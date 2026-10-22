import { readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { createProjectAndSession, launchApp } from './helpers'

// I1 / Review Focus 5: a hand-edited, corrupt project file is reported to the user and the project still opens.
// An episode file is only read when the episodes are listed, after the project has opened, so this also shows
// that the problems are re-read once the lists have loaded.
test('a corrupt project file is shown as a problem and the project still opens', async () => {
  const first = await launchApp()
  await createProjectAndSession(first.page, 'Moon Diary')
  await first.app.close()

  const [projectDir] = (await readdir(first.projectsRoot)).filter((name) => name.startsWith('prj_'))
  await writeFile(join(first.projectsRoot, projectDir, 'episodes', 'epi_0000000bad.json'), '{ "id": "epi_0000000bad", ', 'utf8')

  const second = await launchApp({ userDataDir: first.userDataDir, projectsRoot: first.projectsRoot })
  const problems = second.page.getByTestId('project-problems')
  await expect(problems).toContainText('1 file could not be read')
  await problems.locator('summary').click()
  await expect(problems).toContainText('episodes/epi_0000000bad.json')
  await expect(second.page.getByTestId('session-item')).toHaveCount(1)
  await expect(second.page.getByTestId('pane-visualizer')).toBeVisible()
  await second.app.close()
})
