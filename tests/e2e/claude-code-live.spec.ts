/**
 * Opt-in end-to-end run of Claude Code as the app's agent. Skipped unless WEBTOON_LIVE_CLAUDE=1. It uses the Claude Code
 * installed on this machine and its sign-in (run `claude` once and sign in first), so it spends a little of that
 * account's usage and takes a minute or two. The image model stays the app's offline mock; no image is drawn.
 *   npm run build; $env:WEBTOON_LIVE_CLAUDE=1; npx playwright test tests/e2e/claude-code-live.spec.ts
 * It switches the Claude Code plugin on with "use as the agent", asks for a character through the main chat, and expects
 * Mina in the Characters tab and an assistant reply in the chat.
 */
import { createServer } from 'node:net'
import { expect, test } from '@playwright/test'
import { createProjectAndSession, launchApp, openSettings, openTab } from './helpers'

test.skip(!process.env.WEBTOON_LIVE_CLAUDE, 'set WEBTOON_LIVE_CLAUDE=1 with Claude Code installed and signed in (uses your Claude Code account)')

const MESSAGE = 'Create a character named Mina, a high-school girl with a black bob and a navy school uniform, without generating an image.'

/** A port nothing listens on right now: bind port 0, read it, release it. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
  })
}

test('Claude Code runs the main chat and creates a character through the link', async () => {
  test.setTimeout(5 * 60_000)
  const port = await freePort()
  const { app, page } = await launchApp()
  try {
    await createProjectAndSession(page, 'Claude Live')

    await openSettings(app, page)
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('tab', { name: 'Plugins' }).click()
    await dialog.getByRole('switch', { name: 'Claude Code', exact: true }).click()
    await dialog.getByLabel('Port').fill(String(port))
    await dialog.getByRole('button', { name: 'Save port' }).click()
    await expect(page.getByTestId('plugin-status-claude-code')).toHaveText(`Listening on 127.0.0.1:${port}`)
    await dialog.getByRole('switch', { name: 'Use Claude Code as the agent' }).click()
    await expect(dialog.getByRole('switch', { name: 'Use Claude Code as the agent' })).toBeChecked()
    // The executable has to be found, or the run would fail at once with a clearer message than a timeout.
    await expect(dialog.getByText(/^Detected: /)).toBeVisible()
    await page.keyboard.press('Escape')

    const chat = page.getByTestId('pane-chat').locator('.main-chat')
    await expect(chat.getByTestId('model-picker')).toBeDisabled()
    await expect(chat.getByTestId('model-picker')).toHaveValue('claude-code')

    await chat.getByTestId('composer-input').fill(MESSAGE)
    await chat.getByTestId('composer-send').click()

    await openTab(page, 'characters')
    await expect(page.getByTestId('character-card').filter({ hasText: 'Mina' })).toBeVisible({ timeout: 4 * 60_000 })
    await expect(chat.getByTestId('message-assistant').last()).not.toBeEmpty({ timeout: 4 * 60_000 })
    await expect(chat.getByTestId('composer-send')).toBeVisible({ timeout: 4 * 60_000 }) // the run has ended
  } finally {
    await app.close()
  }
})
