import { expect, test } from '@playwright/test'
import { createProjectAndSession, launchApp, openTab, readProjectJson, sendChat } from './helpers'

// Milestone 5 checkpoint: the whole product on the offline mock models. One scripted conversation builds the story
// bible, two characters, a variation and two panels; the side chat edits a panel; AI-led mode continues the story;
// and everything is still there after a relaunch. Every id in the script is a placeholder the mock provider resolves
// from the <project_state> of the user message that triggered the turn, so characters are created one message before
// any panel casts them. The script has one cursor for the whole app, so its turns are consumed in the order the runs ask.
const mina = { $character: 'Mina' }
const jin = { $character: 'Jin' }
const minaBase = { $variation: ['Mina', 'Base'] }
const jinBase = { $variation: ['Jin', 'Base'] }
const currentEpisode = { $episode: 'current' }

const script = {
  turns: [
    // 1. "Set up the story"
    {
      toolCalls: [
        { name: 'update_story_bible', input: { section: 'Premise', content: 'A girl who can hear the moon.' } },
        {
          name: 'create_character',
          input: {
            name: 'Mina',
            role: 'protagonist',
            appearanceLock: 'Teenage girl, slim build, silver bob haircut, amber eyes, red bomber jacket over a white tee, dark jeans.'
          }
        },
        {
          name: 'create_character',
          input: {
            name: 'Jin',
            role: 'supporting',
            appearanceLock: 'Tall young man, lean build, messy black hair, grey eyes, long charcoal coat, silver moon-shaped earring.'
          }
        }
      ]
    },
    { text: 'Characters ready.' },
    // 2. "Start episode 1"
    {
      toolCalls: [
        { name: 'create_variation', input: { characterId: mina, name: 'Outfit: School uniform', kind: 'outfit', delta: 'navy blazer, pleated skirt' } },
        {
          name: 'create_panel',
          input: {
            episodeId: currentEpisode,
            description: 'Mina stares at the full moon.',
            setting: 'Rooftop at night',
            shot: 'medium',
            characters: [{ characterId: mina, variationId: minaBase }],
            dialogue: [{ speakerId: mina, kind: 'speech', text: 'Is anyone there?' }]
          }
        },
        {
          name: 'create_panel',
          input: {
            episodeId: currentEpisode,
            description: 'Jin steps out of the shadows behind Mina.',
            setting: 'Rooftop at night',
            shot: 'wide',
            characters: [
              { characterId: mina, variationId: minaBase },
              { characterId: jin, variationId: jinBase }
            ],
            dialogue: [{ speakerId: null, kind: 'narration', text: 'Someone had been listening too.' }]
          }
        }
      ]
    },
    { text: 'Episode started.' },
    // 3. side chat on panel 2: "make Jin frown"
    { toolCalls: [{ name: 'edit_image', input: { instruction: 'make Jin frown' } }] },
    { text: 'Done.' },
    // 4. AI-led mode, "Continue story"
    {
      toolCalls: [
        { name: 'add_beats', input: { episodeId: currentEpisode, beats: ['Jin reveals the moon map'] } },
        {
          name: 'create_panel',
          input: {
            episodeId: currentEpisode,
            description: 'Jin unrolls an old star map.',
            setting: 'Rooftop at night',
            shot: 'close-up',
            characters: [{ characterId: jin, variationId: jinBase }],
            dialogue: []
          }
        }
      ]
    },
    { text: 'Continued.' }
  ]
}

test('a story from setup to AI-led continuation survives a relaunch', async () => {
  const first = await launchApp({ script })
  const { page, projectsRoot } = first
  await createProjectAndSession(page, 'Moon Diary')

  // 1. Story bible and cast.
  await sendChat(page, 'Set up the story', 'Characters ready.')
  await openTab(page, 'characters')
  await expect(page.getByTestId('character-card')).toHaveCount(2)
  await page.getByTestId('character-card').filter({ hasText: 'Mina' }).click()
  await expect(page.getByTestId('variation-card')).toHaveCount(1) // Base only, until the next message

  // 2. A variation and two panels.
  await sendChat(page, 'Start episode 1', 'Episode started.')
  await expect(page.getByTestId('variation-card')).toHaveCount(2)
  await page.getByRole('button', { name: 'Back to characters' }).click()
  await expect(page.getByTestId('character-card')).toHaveCount(2)
  await page.getByTestId('character-card').filter({ hasText: 'Mina' }).click()
  await expect(page.getByTestId('variation-card')).toHaveCount(2)
  await page.getByRole('button', { name: 'Back to characters' }).click()

  await openTab(page, 'webtoon')
  const cards = page.getByTestId('panel-card')
  await expect(cards).toHaveCount(2)
  await expect(cards.locator('img')).toHaveCount(2)
  await expect(cards.locator('.dialogue-overlay')).toHaveCount(2)
  await expect(cards.nth(0).locator('.dialogue-overlay')).toContainText('Is anyone there?')
  await expect(cards.nth(1).locator('.dialogue-overlay')).toContainText('Someone had been listening too.')

  // 3. The side chat edits panel 2: a second ready version.
  await cards.nth(1).click()
  const side = page.getByTestId('panel-side-chat')
  await expect(side).toBeVisible()
  await expect(side.getByTestId('panel-version-label')).toHaveText('v1 / 1')
  await side.getByTestId('composer-input').fill('make Jin frown')
  await side.getByTestId('composer-send').click()
  await expect(side.getByTestId('panel-version-label')).toHaveText('v2 / 2')
  await expect(side.getByTestId('message-assistant').last()).toContainText('Done.')

  // 4. The Story tab shows what the agent wrote into the bible.
  await openTab(page, 'story')
  await expect(page.getByTestId('bible-editor')).toHaveValue(/A girl who can hear the moon\./)

  // 5. AI-led mode offers Continue story, which draws a third panel.
  await expect(page.getByTestId('continue-story')).toHaveCount(0)
  await page.getByTestId('story-mode-toggle').selectOption('AI-led')
  await expect(page.getByTestId('continue-story')).toBeVisible()
  await page.getByTestId('continue-story').click()
  const main = page.getByTestId('pane-chat').locator('.main-chat')
  await expect(main.getByTestId('message-assistant').last()).toContainText('Continued.')
  await openTab(page, 'webtoon')
  await expect(cards).toHaveCount(3)
  await expect(cards.locator('img')).toHaveCount(3)
  await openTab(page, 'story')
  await expect(page.getByTestId('beat-item')).toContainText('Jin reveals the moon map')

  // Everything is on disk before the app quits.
  const characters = await readProjectJson(projectsRoot, 'characters')
  expect(characters.map((c: { name: string }) => c.name).sort()).toEqual(['Jin', 'Mina'])
  expect(characters.find((c: { name: string }) => c.name === 'Mina').variations.map((v: { name: string }) => v.name)).toEqual(['Base', 'Outfit: School uniform'])
  const [episode] = await readProjectJson(projectsRoot, 'episodes')
  const panels = await Promise.all(episode.panelIds.map((id: string) => readProjectJson(projectsRoot, `panels/${id}.json`)))
  expect(panels.map((p: { description: string }) => p.description)).toEqual([
    'Mina stares at the full moon.',
    'Jin steps out of the shadows behind Mina.',
    'Jin unrolls an old star map.'
  ])
  expect(panels.map((p: { versions: unknown[] }) => p.versions.length)).toEqual([1, 2, 1])
  expect(panels[1].versions.map((v: { source: string; status: string }) => `${v.source}:${v.status}`)).toEqual(['generate:ready', 'edit:ready'])
  expect(panels[1].currentVersionId).toBe(panels[1].versions[1].id)
  expect((await readProjectJson(projectsRoot, 'project.json')).storyMode).toBe('ai')
  await first.app.close()

  // 6. A second launch on the same folders finds the sessions, the panels and the characters.
  const second = await launchApp({ userDataDir: first.userDataDir, projectsRoot })
  const again = second.page
  await expect(again.getByTestId('session-item')).toHaveCount(1)
  await again.getByTestId('session-item').click()
  await expect(again.getByTestId('pane-chat').locator('.main-chat').getByTestId('message-assistant').last()).toContainText('Continued.')
  await openTab(again, 'webtoon')
  await expect(again.getByTestId('panel-card')).toHaveCount(3)
  await expect(again.getByTestId('panel-card').locator('img')).toHaveCount(3)
  await openTab(again, 'characters')
  await expect(again.getByTestId('character-card')).toHaveCount(2)
  await second.app.close()
})
