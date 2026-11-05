/**
 * Opt-in end-to-end run of the item flow with real images, drawn by the user's ChatGPT bridge (E:\claude\chatgpt-bridge,
 * OpenAI-compatible on :7870). Skipped unless WEBTOON_LIVE_BRIDGE=1. It uses the ChatGPT account behind the bridge and takes
 * about 15 minutes (one image takes 1-3 minutes and the bridge draws one at a time). Start the bridge first, then:
 *   npm run build; $env:WEBTOON_LIVE_BRIDGE=1; npx playwright test tests/e2e/bridge-live.spec.ts
 * It draws Mina, the Kestrel blaster at rest, the blaster being fired (gray hands) and a panel of Mina firing it, then copies
 * the four images into the test output folder for a human to judge. A live model's consistency verdict is logged, not asserted.
 */
import { test, expect, type Locator, type TestInfo } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import { launchApp, openTab, readProjectJson } from './helpers'

test.skip(process.env.WEBTOON_LIVE_BRIDGE !== '1', 'set WEBTOON_LIVE_BRIDGE=1 with the ChatGPT bridge running (uses your ChatGPT account)')

const BRIDGE_URL = (process.env.BRIDGE_URL ?? 'http://127.0.0.1:7870/v1').replace(/\/$/, '')
const IMAGE_TIMEOUT = 8 * 60_000

const MINA_LOCK =
  'Seventeen-year-old girl, slim build. Oval face, small nose. Shoulder-length straight black bob with blunt bangs. Large amber eyes. Light warm skin. Default outfit: red bomber jacket, white t-shirt, dark jeans, white sneakers. Palette: black, amber, red, white.'
const BLASTER_LOCK =
  'Compact pistol about the length of a forearm, matte gunmetal body with a rounded cyan energy cell set into each side of the grip, short ribbed barrel ending in a cyan glass emitter ring, small orange stripe along the top rail, black textured grip.'
const FIRING_DELTA =
  'held in the right hand with the index finger on the trigger, left hand supporting under the grip, a thin straight cyan beam leaving the emitter ring, cells glowing bright cyan'

/** Fails fast, with a clear message, when the bridge cannot take a request. A tab opens on the first request, so `waiting_for_tab` with the extension connected is usable. */
async function assertBridgeUsable(): Promise<void> {
  const healthUrl = `${BRIDGE_URL.replace(/\/v1$/, '')}/health`
  let health: { status?: string; error?: string; extension?: { connected?: boolean } }
  try {
    health = (await (await fetch(healthUrl, { signal: AbortSignal.timeout(10_000) })).json()) as typeof health
  } catch (error) {
    throw new Error(`The ChatGPT bridge does not answer at ${healthUrl} (${error instanceof Error ? error.message : String(error)}). Start it (E:\\claude\\chatgpt-bridge) or set BRIDGE_URL.`)
  }
  const usable = health.status === 'ready' || (health.status === 'waiting_for_tab' && health.extension?.connected === true)
  if (!usable) throw new Error(`The ChatGPT bridge is not usable: status ${String(health.status)}${health.error ? ` (${health.error})` : ''}, extension connected: ${String(health.extension?.connected)}.`)
}

/**
 * Waits until a card (a variation, usage or panel) shows its image. ChatGPT sometimes refuses an image ("may violate our
 * guardrails") and draws the same prompt on a second try, so the first failure is logged and `retry` (the card's own Retry or
 * Regenerate control) is clicked once; a second failure fails the test at once with the card's text, not after the 8 minute limit.
 * `state` reads the card: its status and whether it has an image.
 */
async function waitForImage(
  what: string,
  state: () => Promise<{ status: string | null; hasImage: boolean; text: string }>,
  retry: () => Promise<void>
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const deadline = Date.now() + IMAGE_TIMEOUT
    let failure: string
    for (;;) {
      const s = await state()
      if (s.status === 'failed') {
        failure = s.text.replace(/\s+/g, ' ').trim()
        break
      }
      if (s.status === 'ready' && s.hasImage) return
      if (Date.now() > deadline) throw new Error(`${what} did not get its image within ${IMAGE_TIMEOUT / 60_000} minutes`)
      await new Promise((resolve) => setTimeout(resolve, 2_000))
    }
    if (attempt >= 2) throw new Error(`${what} failed again after a retry: ${failure}`)
    console.log(`${what} failed (${failure}); retrying once`)
    await retry()
    // The card keeps showing the old failure until the new attempt is recorded as pending.
    await expect.poll(async () => (await state()).status, { message: `${what} should start its retry`, timeout: 30_000, intervals: [500] }).not.toBe('failed')
  }
}

const cardState = (card: Locator) => async () => ({
  status: await card.getAttribute('data-status'),
  hasImage: (await card.locator('img').count()) > 0,
  text: await card.innerText()
})

/** Copies a project-relative image into the test output folder and attaches it to the report. */
async function keepImage(testInfo: TestInfo, projectDir: string, relPath: string, name: string): Promise<void> {
  const ext = extname(relPath) || '.png'
  const copy = testInfo.outputPath(`${name}${ext}`)
  await copyFile(join(projectDir, ...relPath.split('/')), copy)
  await testInfo.attach(name, { path: copy, contentType: ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg' })
}

test('the ChatGPT bridge draws a character, an item, its usage and a panel that holds it', async ({}, testInfo) => {
  test.setTimeout(45 * 60_000)
  await assertBridgeUsable()

  const userDataDir = await mkdtemp(join(tmpdir(), 'webtoon-bridge-userdata-'))
  execFileSync(process.execPath, ['tools/local-models/seed-bridge-models.mjs', '--user-data', userDataDir], { stdio: 'inherit' })
  const { app, page, projectsRoot } = await launchApp({ userDataDir })
  try {
    await page.getByTestId('new-project').click()
    await page.getByLabel('Title').fill('Bridge Live')
    await page.getByRole('button', { name: 'Create' }).click()

    // Mina, through the form. Creating her draws her base image.
    await openTab(page, 'characters')
    await page.getByRole('button', { name: 'New character' }).click()
    const characterForm = page.getByTestId('character-form')
    await characterForm.getByLabel('Name', { exact: true }).fill('Mina')
    await characterForm.getByLabel('Role', { exact: true }).selectOption('protagonist')
    await characterForm.getByLabel('Appearance lock').fill(MINA_LOCK)
    await characterForm.getByRole('button', { name: 'Create character' }).click()
    const minaCard = page.getByTestId('variation-card').first()
    await waitForImage('Mina base image', cardState(minaCard), () => minaCard.getByRole('button', { name: 'Retry' }).click())
    await page.getByRole('button', { name: 'Back to characters' }).click()
    await expect(page.getByTestId('character-card').filter({ hasText: 'Mina' }).locator('img')).toBeVisible()

    // The blaster, owned by Mina. Creating it draws the At rest reference sheet.
    await openTab(page, 'items')
    await page.getByRole('button', { name: 'New item' }).click()
    const itemForm = page.getByTestId('item-form')
    await itemForm.getByLabel('Name', { exact: true }).fill('Kestrel blaster')
    await itemForm.getByLabel('Owner').selectOption({ label: 'Mina' })
    await itemForm.getByTestId('item-form-lock').fill(BLASTER_LOCK)
    await itemForm.getByTestId('item-form-save').click()
    const atRestCard = page.getByTestId('usage-card').filter({ hasText: 'At rest' })
    await waitForImage('Kestrel blaster At rest image', cardState(atRestCard), () => atRestCard.getByRole('button', { name: 'Regenerate' }).click())

    // Firing: the action-usage sheet with gray hands.
    await page.getByTestId('usage-add').click()
    const usageForm = page.getByTestId('usage-form')
    await usageForm.getByLabel('Name', { exact: true }).fill('Firing')
    await usageForm.getByLabel('Kind').selectOption({ label: 'Action' })
    await usageForm.getByLabel('How it is used / what changes').fill(FIRING_DELTA)
    await usageForm.getByTestId('usage-submit').click()
    const firingCard = page.getByTestId('usage-card').filter({ hasText: 'Firing' })
    await waitForImage('Kestrel blaster Firing image', cardState(firingCard), () => firingCard.getByRole('button', { name: 'Regenerate' }).click())

    // The panel, through editing mode: Mina in her base look, the blaster in Firing, held by her.
    await openTab(page, 'webtoon')
    await page.getByTestId('add-panel').last().click()
    const editor = page.getByTestId('panel-workspace')
    await editor.getByRole('tab', { name: 'Scene' }).click()
    await editor.getByLabel('Description').fill('Mina fires the Kestrel blaster at a drone across the rooftop.')
    await editor.getByLabel('Setting').fill('City rooftop at dusk')
    await editor.getByLabel('Shot').selectOption('medium')
    await editor.getByRole('tab', { name: 'Cast' }).click()
    await editor.getByRole('button', { name: 'Add character', exact: true }).click()
    await editor.getByLabel('Character').selectOption({ label: 'Mina' })
    await expect(editor.getByLabel('Variation').locator('option:checked')).toHaveText('Base')
    await editor.getByRole('tab', { name: 'Items' }).click()
    await editor.getByRole('button', { name: 'Add item', exact: true }).click()
    const picker = editor.getByRole('group', { name: 'Items' })
    await picker.getByLabel('Item', { exact: true }).selectOption({ label: 'Kestrel blaster' })
    await picker.getByLabel('Usage').selectOption({ label: 'Firing' })
    await picker.getByLabel('Held by').selectOption({ label: 'Mina' })
    await picker.getByLabel('Item action').fill('firing at the drone')
    await editor.getByRole('button', { name: 'Generate' }).click()
    await editor.getByRole('button', { name: 'Back to the strip' }).click()

    const panelCard = page.getByTestId('panel-card')
    const panelFailed = page.getByTestId('panel-status').and(page.locator('[data-status="failed"]'))
    await waitForImage(
      'Panel image',
      async () => {
        const failed = (await panelFailed.count()) > 0
        const hasImage = (await panelCard.locator('img').count()) > 0
        return { status: failed ? 'failed' : hasImage ? 'ready' : 'pending', hasImage, text: failed ? await panelFailed.first().innerText() : '' }
      },
      () => panelCard.getByRole('button', { name: 'Retry' }).click() // the failed status's own Retry draws the panel again
    )

    // The files on disk. The consistency check is recorded after the image lands (and a failed one earns one redraw),
    // so wait for the check of the final version before reading it.
    const [episode] = await readProjectJson(projectsRoot, 'episodes')
    const panelPath = `panels/${episode.panelIds[0]}.json`
    const currentOf = (p: any) => p.versions.find((v: any) => v.id === p.currentVersionId)
    await expect
      .poll(
        async () => {
          const v = currentOf(await readProjectJson(projectsRoot, panelPath))
          return v?.check != null && (v.check.passed || v.check.skipped || (await readProjectJson(projectsRoot, panelPath)).versions.length >= 2)
        },
        { message: 'the consistency check should be recorded on the panel', timeout: IMAGE_TIMEOUT * 2, intervals: [3_000] }
      )
      .toBe(true)

    const panel = await readProjectJson(projectsRoot, panelPath)
    const version = currentOf(panel)
    const [mina] = (await readProjectJson(projectsRoot, 'characters')).filter((c: any) => c.name === 'Mina')
    const [blaster] = (await readProjectJson(projectsRoot, 'items')).filter((i: any) => i.name === 'Kestrel blaster')
    const minaBase = mina.variations.find((v: any) => v.kind === 'base')
    const atRest = blaster.usages.find((u: any) => u.kind === 'base')
    const firing = blaster.usages.find((u: any) => u.name === 'Firing')

    expect(version.status).toBe('ready')
    // Mina's base, then the Firing sheet; there is no previous panel because this is the first one.
    expect(version.referenceImagePaths).toEqual([minaBase.imagePath, firing.imagePath])
    expect(version.prompt).toContain('[ITEMS]')
    expect(version.prompt).toContain('Held by: Mina')
    expect(version.check).not.toBeNull() // the vision role is assigned
    console.log(`Consistency check (not asserted): ${JSON.stringify(version.check)}`)

    // A human judges the pictures: keep them next to the test report.
    const projects = (await readdir(projectsRoot, { withFileTypes: true })).filter((e) => e.isDirectory() && e.name.startsWith('prj_'))
    const projectDir = join(projectsRoot, projects[0].name)
    await keepImage(testInfo, projectDir, minaBase.imagePath, 'mina-base')
    await keepImage(testInfo, projectDir, atRest.imagePath, 'kestrel-blaster-at-rest')
    await keepImage(testInfo, projectDir, firing.imagePath, 'kestrel-blaster-firing')
    await keepImage(testInfo, projectDir, version.imagePath, 'panel')
  } finally {
    await app.close()
  }
})
