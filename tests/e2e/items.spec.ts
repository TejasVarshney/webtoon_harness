import { expect, test } from '@playwright/test'
import { createProjectAndSession, launchApp, openTab, readProjectJson, sendChat } from './helpers'

// Item maker checkpoint: the agent makes an item with a second usage, then draws a panel that holds it, and the user
// sees the item in the Items tab, the panel in the Webtoon tab and the item row in the panel editor. Refs resolve from
// the <project_state> of the user message that triggered the turn, so each thing is created one message before the next
// one refers to it: the item exists in message 2's snapshot, its Firing usage in message 3's.
const mina = { $character: 'Mina' }
const minaBase = { $variation: ['Mina', 'Base'] }
const blaster = { $item: 'Kestrel blaster' }

const script = {
  turns: [
    // 1. "Make Mina and her blaster"
    {
      toolCalls: [
        {
          name: 'create_character',
          input: { name: 'Mina', role: 'protagonist', appearanceLock: 'Teenage girl, silver bob haircut, amber eyes, red bomber jacket.' }
        },
        {
          name: 'create_item',
          input: {
            name: 'Kestrel blaster',
            appearanceLock: 'Compact matte-black sidearm the length of a hand, a cyan glowing slit along the barrel, a brass grip plate stamped with a bird.'
          }
        }
      ]
    },
    { text: 'Mina and the blaster are ready.' },
    // 2. "Add the firing look"
    {
      toolCalls: [
        { name: 'create_item_usage', input: { itemId: blaster, name: 'Firing', kind: 'action', delta: 'both hands, cyan beam from the barrel tip' } }
      ]
    },
    { text: 'Firing usage ready.' },
    // 3. "Draw the panel"
    {
      toolCalls: [
        {
          name: 'create_panel',
          input: {
            episodeId: { $episode: 'current' },
            description: 'Mina aims the Kestrel blaster at the door.',
            setting: 'Dim corridor',
            shot: 'medium',
            characters: [{ characterId: mina, variationId: minaBase }],
            items: [{ itemId: blaster, usageId: { $usage: ['Kestrel blaster', 'Firing'] }, heldBy: mina, action: 'aims at the door' }],
            dialogue: []
          }
        }
      ]
    },
    { text: 'Panel drawn.' }
  ]
}

test('an item with two usages is drawn into a panel and shows in the panel editor', async () => {
  const { app, page, projectsRoot } = await launchApp({ script })
  await createProjectAndSession(page, 'Blaster Test')

  await sendChat(page, 'Make Mina and her blaster', 'Mina and the blaster are ready.')
  await sendChat(page, 'Add the firing look', 'Firing usage ready.')

  // The Items tab lists the blaster, and opening it shows the base and the Firing usage.
  await openTab(page, 'items')
  await expect(page.getByTestId('item-card')).toHaveCount(1)
  await page.getByTestId('item-card').click()
  await expect(page.getByTestId('usage-card')).toHaveCount(2)
  await expect(page.getByTestId('usage-card').filter({ hasText: 'Firing' })).toHaveCount(1)

  await sendChat(page, 'Draw the panel', 'Panel drawn.')

  // The panel is drawn.
  await openTab(page, 'webtoon')
  const cards = page.getByTestId('panel-card')
  await expect(cards).toHaveCount(1)
  await expect(cards.locator('img')).toHaveCount(1)

  // The editor shows the attached item with its usage and holder.
  await cards.first().getByRole('button', { name: 'Edit' }).click()
  const editor = page.getByTestId('panel-editor')
  await expect(editor).toBeVisible()
  const picker = editor.getByRole('group', { name: 'Items' })
  await expect(picker.getByLabel('Item', { exact: true }).locator('option:checked')).toHaveText('Kestrel blaster')
  await expect(picker.getByLabel('Usage').locator('option:checked')).toHaveText('Firing')
  await expect(picker.getByLabel('Held by').locator('option:checked')).toHaveText('Mina')
  await expect(picker.getByLabel('Item action')).toHaveValue('aims at the door')

  // And it is on disk.
  const [episode] = await readProjectJson(projectsRoot, 'episodes')
  const panel = await readProjectJson(projectsRoot, `panels/${episode.panelIds[0]}.json`)
  expect(panel.items).toHaveLength(1)
  expect(panel.items[0]).toMatchObject({ action: 'aims at the door' })
  await app.close()
})
