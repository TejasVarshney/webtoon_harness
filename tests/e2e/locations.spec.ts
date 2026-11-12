import { expect, test } from '@playwright/test'
import { createProjectAndSession, launchApp, openTab, readProjectJson, sendChat } from './helpers'

// Locations checkpoint, in the real window: the user makes a location in the Locations tab (its base picture is drawn),
// adds a state without a picture, sets the location, state and a reverse camera on a panel in the Scene tab, and the
// redraw sends the location's picture with a [LOCATION] line.
const script = {
  turns: [
    {
      toolCalls: [
        {
          name: 'create_panel',
          input: { episodeId: { $episode: 'current' }, description: 'The empty stockroom, snow drifting in.', setting: 'Back stockroom, night', shot: 'wide', characters: [], dialogue: [] }
        }
      ]
    },
    { text: 'Panel drawn.' }
  ]
}

test('a location made in its tab is set on a panel in the Scene tab and drawn into it', async () => {
  const { app, page, projectsRoot } = await launchApp({ script })
  await createProjectAndSession(page, 'Stockroom Test')
  await sendChat(page, 'Draw the stockroom', 'Panel drawn.')

  // The Locations tab: a new location gets its base picture.
  await openTab(page, 'locations')
  await page.getByRole('button', { name: 'New location' }).click()
  const form = page.getByTestId('location-form')
  await form.getByLabel('Name').fill('Back stockroom')
  await form.getByLabel('Layout').fill('Camera faces the back wall. Back door at frame-left; shelves at frame-right.')
  await form.getByRole('button', { name: 'Create location' }).click()
  await expect(page.getByRole('heading', { name: 'Back stockroom' })).toBeVisible()
  const base = page.getByTestId('state-card').first()
  await expect(base.locator('img')).toHaveCount(1)
  await expect(base).toHaveAttribute('data-status', 'ready')

  // A state without a picture of its own.
  await page.getByTestId('state-add').click()
  const stateForm = page.getByTestId('state-form')
  await stateForm.getByLabel('Name').fill('Night')
  await stateForm.getByLabel('What changes').fill('only embers glowing')
  await stateForm.getByRole('button', { name: 'Create state' }).click()
  await expect(page.getByTestId('state-card')).toHaveCount(2)
  await expect(page.getByTestId('state-card').nth(1)).toContainText('Uses the base picture')

  // The panel's Scene tab: location, state and a reverse camera.
  await openTab(page, 'webtoon')
  await page.getByTestId('panel-card').first().dblclick()
  const workspace = page.getByTestId('panel-workspace')
  await expect(workspace).toBeVisible()
  await workspace.getByRole('tab', { name: 'Scene' }).click()
  await workspace.getByLabel('Location').selectOption({ label: 'Back stockroom' })
  await workspace.getByLabel('State').selectOption({ label: 'Night' })
  await workspace.getByLabel('Camera', { exact: true }).selectOption({ label: 'Reverse angle' })
  await workspace.getByLabel('Description').click()

  const [episode] = await readProjectJson(projectsRoot, 'episodes')
  const panelFile = `panels/${episode.panelIds[0]}.json`
  await expect.poll(async () => (await readProjectJson(projectsRoot, panelFile)).location?.camera, { timeout: 5000 }).toBe('reverse')
  const stored = await readProjectJson(projectsRoot, panelFile)
  const [location] = await readProjectJson(projectsRoot, 'locations')
  expect(stored.location).toEqual({ locationId: location.id, stateId: location.states[1].id, camera: 'reverse' })

  // The image is out of date; the redraw sends the base picture with the [LOCATION] line.
  await expect(page.getByTestId('stale-notice')).toContainText('Location')
  await page.getByTestId('stale-notice').getByRole('button', { name: 'Regenerate' }).click()
  await expect.poll(async () => (await readProjectJson(projectsRoot, panelFile)).versions.length, { timeout: 10000 }).toBe(2)
  const redrawn = (await readProjectJson(projectsRoot, panelFile)).versions[1]
  expect(redrawn.prompt).toContain('[LOCATION] Back stockroom (reference image 1): Camera faces the back wall.')
  expect(redrawn.prompt).toContain('State: Night — only embers glowing. Camera: reverse angle')
  expect(redrawn.referenceImagePaths[0]).toBe(location.states[0].imagePath)
  await app.close()
})
