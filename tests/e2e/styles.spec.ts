import { expect, test, type Page } from '@playwright/test'
import { createProjectAndSession, launchApp, openFirstProject, readProjectJson, sendChat } from './helpers'

const panelInput = {
  episodeId: { $episode: 'current' },
  description: 'An empty street in the rain.',
  setting: 'City street at night',
  shot: 'wide',
  characters: [],
  dialogue: []
}

const styleButton = (page: Page) => page.getByTestId('style-button')
const row = (page: Page, name: string) => page.getByTestId('style-row').filter({ has: page.getByText(name, { exact: true }) })

async function firstPanel(projectsRoot: string) {
  const episode = (await readProjectJson(projectsRoot, 'episodes')).find(Boolean)
  return readProjectJson(projectsRoot, `panels/${episode.panelIds[0]}.json`)
}

test('a style chosen in the picker reaches the panel prompt', async () => {
  const { app, page, projectsRoot } = await launchApp({
    script: { turns: [{ toolCalls: [{ name: 'create_panel', input: panelInput }] }, { text: 'Drew it.' }] }
  })
  await createProjectAndSession(page, 'Moon Diary')
  await expect(styleButton(page)).toHaveText('Style: Korean webtoon')
  await styleButton(page).click()
  await row(page, 'Watercolor').getByRole('button', { name: 'Use' }).click()
  await expect(styleButton(page)).toHaveText('Style: Watercolor')
  await sendChat(page, 'Draw', 'Drew it.')
  await expect.poll(async () => (await firstPanel(projectsRoot)).versions[0]?.status).toBe('ready')
  expect((await firstPanel(projectsRoot)).versions[0].prompt).toContain('[STYLE] Soft watercolor illustration style')
  await app.close()
})

test('the agent sets a style while the project has no art, and is refused after', async () => {
  const { app, page } = await launchApp({
    script: {
      turns: [
        { toolCalls: [{ name: 'set_style', input: { styleId: 'ink-noir' } }] },
        { text: 'Set.' },
        { toolCalls: [{ name: 'create_panel', input: panelInput }] },
        { text: 'Drew.' },
        { toolCalls: [{ name: 'set_style', input: { styleId: 'watercolor' } }] },
        { text: 'Tried.' }
      ]
    }
  })
  await createProjectAndSession(page, 'Moon Diary')
  await sendChat(page, 'Make it noir', 'Set.')
  await expect(styleButton(page)).toHaveText('Style: Ink noir')
  await sendChat(page, 'Draw', 'Drew.')
  await sendChat(page, 'Now watercolor', 'Tried.')
  await expect(styleButton(page)).toHaveText('Style: Ink noir')
  await app.close()
})

test('a style the user adds is kept after a restart', async () => {
  const first = await launchApp()
  await createProjectAndSession(first.page, 'Moon Diary')
  await styleButton(first.page).click()
  await first.page.getByRole('button', { name: 'Add style' }).click()
  await first.page.getByLabel('Name').fill('Rainy city')
  await first.page.getByLabel('Description').fill('Muted blue-gray wash, thin ink outlines')
  await first.page.getByRole('button', { name: 'Save style' }).click()
  await expect(row(first.page, 'Rainy city')).toHaveCount(1)
  await first.app.close()

  const second = await launchApp({ userDataDir: first.userDataDir, projectsRoot: first.projectsRoot })
  await openFirstProject(second.page)
  await styleButton(second.page).click()
  await expect(row(second.page, 'Rainy city')).toHaveCount(1)
  await second.app.close()
})
