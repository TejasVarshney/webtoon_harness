import { expect, test } from '@playwright/test'
import { createProjectAndSession, launchApp, openTab, readProjectJson, sendChat } from './helpers'

// The panel tools' Layout arranges a panel and the one after it side by side, in place, and stores where both went.
const mina = { $character: 'Mina' }
const panel = (description: string) => ({
  name: 'create_panel',
  input: {
    episodeId: { $episode: 'current' },
    description,
    setting: 'Rooftop at night',
    shot: 'medium',
    characters: [{ characterId: mina, variationId: { $variation: ['Mina', 'Base'] } }],
    dialogue: []
  }
})
const script = {
  turns: [
    { toolCalls: [{ name: 'create_character', input: { name: 'Mina', role: 'protagonist', appearanceLock: 'Teenage girl, silver bob haircut, amber eyes, red bomber jacket.' } }] },
    { text: 'Created Mina.' },
    { toolCalls: [panel('Mina looks up.'), panel('Mina runs.')] },
    { text: 'Drew two panels.' }
  ]
}

test('Layout puts a panel and the next one side by side', async () => {
  const { app, page, projectsRoot } = await launchApp({ script })
  await createProjectAndSession(page, 'Moon Diary')
  await sendChat(page, 'Create Mina', 'Created Mina.')
  await sendChat(page, 'Draw two panels', 'Drew two panels.')
  await openTab(page, 'webtoon')
  const cards = page.getByTestId('panel-card')
  await expect(cards.locator('img')).toHaveCount(2)
  const [episode] = await readProjectJson(projectsRoot, 'episodes')
  const [firstId, secondId]: string[] = episode.panelIds
  const placement = async (id: string) => (await readProjectJson(projectsRoot, `panels/${id}.json`)).placement

  await cards.nth(0).click({ position: { x: 20, y: 20 } })
  await page.getByRole('button', { name: 'Layout', exact: true }).click()
  const layouts = page.getByRole('dialog', { name: 'Layout' }).getByRole('group', { name: 'Layouts' })
  await expect(layouts.getByRole('button', { name: 'Three across' })).toBeDisabled()
  await layouts.getByRole('button', { name: 'Two across' }).click()
  await expect.poll(() => placement(secondId)).toEqual({ x: 223, y: 0, width: 217 })
  expect(await placement(firstId)).toEqual({ x: 0, y: 0, width: 217 })
  // Side by side on the screen too.
  const [a, b] = [(await cards.nth(0).boundingBox())!, (await cards.nth(1).boundingBox())!]
  expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1)
  expect(b.x).toBeGreaterThan(a.x + a.width)
  await expect(page.getByTestId('panel-workspace')).toHaveCount(0)
  await app.close()
})
