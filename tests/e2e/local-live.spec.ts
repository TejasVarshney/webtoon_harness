/**
 * Opt-in end-to-end run against the real local stack (gemma4 on Ollama + the SDXL bridge). Skipped unless
 * WEBTOON_LIVE_LOCAL=1. Start Ollama and the bridge first (see tools/local-models/README.md), then:
 *   npm run build; $env:WEBTOON_LIVE_LOCAL=1; npx playwright test tests/e2e/local-live.spec.ts
 * A small local model is not deterministic: this checks that the whole pipeline works, not exact wording.
 */
import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProjectAndSession, launchApp, openTab } from './helpers'

test.skip(process.env.WEBTOON_LIVE_LOCAL !== '1', 'set WEBTOON_LIVE_LOCAL=1 with Ollama and the SDXL bridge running')

test('gemma4 creates a character and SDXL draws its reference sheet', async () => {
  test.setTimeout(15 * 60_000)
  const userDataDir = await mkdtemp(join(tmpdir(), 'webtoon-live-userdata-'))
  execFileSync(process.execPath, ['tools/local-models/seed-models.mjs', '--user-data', userDataDir], { stdio: 'inherit' })
  const { app, page } = await launchApp({ userDataDir })
  try {
    await createProjectAndSession(page, 'Local Live')
    await expect(page.getByTestId('mock-banner')).toHaveCount(0) // the agent runs on gemma4, not the mock

    const chat = page.getByTestId('pane-chat').locator('.main-chat')
    await chat.getByTestId('composer-input').fill(
      'Create a character named Mina: protagonist, a teenage girl with a slim build, silver bob haircut, amber eyes and a red bomber jacket. Generate her base reference image.'
    )
    await chat.getByTestId('composer-send').click()

    await openTab(page, 'characters')
    const card = page.getByTestId('character-card').filter({ hasText: 'Mina' })
    await expect(card).toBeVisible({ timeout: 8 * 60_000 })
    await expect(card.locator('img')).toBeVisible({ timeout: 6 * 60_000 })
    await expect(chat.getByTestId('composer-stop')).toHaveCount(0, { timeout: 5 * 60_000 }) // the run ends
  } finally {
    await app.close()
  }
})
