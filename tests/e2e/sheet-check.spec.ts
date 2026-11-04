import { expect, test } from '@playwright/test'
import { createProjectAndSession, launchApp, openTab, readProjectJson } from './helpers'

// Sheet check checkpoint: a base sheet that fails its appearance-lock check twice (the first draw and the one redraw,
// the default consistencyRetries being 1) is stored with a failed check. The studio flags it, and casting it into a
// panel warns in the panel editor. Every text turn of the app, vision checks included, consumes the next turn of the
// one shared mock script, and nothing else asks the text model here, so the two failing checks are the only turns.
const FAIL = '{"passed": false, "issues": ["Mina reads as a man, but her lock says a young woman"]}'

test('a sheet that fails its check is flagged and warns when cast', async () => {
  const { app, page, projectsRoot } = await launchApp({ script: { turns: [{ text: FAIL }, { text: FAIL }] } })
  await createProjectAndSession(page, 'Check Test')
  await page.evaluate(() => (globalThis as any).api.invoke('models:assignRole', { role: 'vision', modelId: 'mdl_000000000a' }))

  await openTab(page, 'characters')
  await page.getByRole('button', { name: 'New character' }).click()
  const form = page.getByTestId('character-form')
  await form.getByLabel('Name', { exact: true }).fill('Mina')
  await form.getByLabel('Appearance lock').fill('Young woman, slim build, silver bob haircut, amber eyes, red bomber jacket.')
  await form.getByRole('button', { name: 'Create character' }).click()

  // Creating the character opens its detail view, whose base tile carries the badge.
  const badge = page.getByTestId('sheet-check-failed')
  await expect(badge).toBeVisible()
  await expect(page.locator('.sheet-check-issues').first()).toContainText('Mina reads as a man')

  await openTab(page, 'webtoon')
  await page.getByTestId('add-panel').last().click()
  const editor = page.getByTestId('panel-editor')
  await editor.getByLabel('Description').fill('Mina stands on the rooftop.')
  await editor.getByLabel('Setting').fill('Rooftop at dusk')
  await editor.getByRole('button', { name: 'Add character' }).click()
  await editor.getByLabel('Character').selectOption({ label: 'Mina' })
  await editor.getByRole('button', { name: 'Create without image' }).click()
  await expect(editor.locator('.panel-editor-warnings')).toContainText('failed its sheet check')

  const [character] = await readProjectJson(projectsRoot, 'characters')
  expect(character.variations[0].check.passed).toBe(false)
  await app.close()
})
