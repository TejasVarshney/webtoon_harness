import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { createProjectAndSession, launchApp } from './helpers'

test('settings lists the workflow docs of the project and resets them after confirmation', async () => {
  const { app, page, projectsRoot } = await launchApp()
  await createProjectAndSession(page, 'Moon Diary')
  const [projectDir] = (await readdir(projectsRoot)).filter((name) => name.startsWith('prj_'))
  const agentsFile = join(projectsRoot, projectDir, 'agent', 'AGENTS.md')
  const shipped = await readFile(resolve(__dirname, '..', '..', 'resources', 'agent-docs', 'AGENTS.md'), 'utf8')
  expect(await readFile(agentsFile, 'utf8')).toBe(shipped)

  await page.getByTestId('settings-open').click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('tab', { name: 'Workflow docs' }).click()
  for (const path of ['agent/AGENTS.md', 'agent/workflows/panel-generation.md', 'agent/reference/consistency-checklist.md']) {
    await expect(dialog.getByText(path, { exact: true })).toBeVisible()
  }
  await expect(dialog.locator('.doc-list li')).toHaveCount(8)

  await writeFile(agentsFile, '# My own rules\n', 'utf8')
  await dialog.getByRole('button', { name: 'Reset all to defaults' }).click()
  await dialog.getByRole('alertdialog', { name: 'Reset workflow docs' }).getByRole('button', { name: 'Reset all' }).click()
  await expect(dialog.getByRole('status')).toHaveText('Workflow docs reset to the defaults.')
  expect(await readFile(agentsFile, 'utf8')).toBe(shipped)
  await app.close()
})
