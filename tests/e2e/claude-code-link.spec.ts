import { createServer } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { expect, test } from '@playwright/test'
import { createProjectAndSession, launchApp, openTab } from './helpers'

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

// Phase-1 acceptance: an outside MCP client drives the open project through the plugin's link.
test('an MCP client creates a character through the Claude Code link and the app shows it', async () => {
  const port = await freePort()
  const { app, page } = await launchApp()
  let client: Client | undefined
  try {
    await createProjectAndSession(page, 'Moon Diary')

    await page.getByTestId('settings-open').click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByRole('tab', { name: 'Plugins' }).click()
    await dialog.getByRole('switch', { name: 'Claude Code' }).click()
    await dialog.getByLabel('Port').fill(String(port))
    await dialog.getByRole('button', { name: 'Save port' }).click()
    await expect(page.getByTestId('plugin-status-claude-code')).toHaveText(`Listening on 127.0.0.1:${port}`)

    const { command } = await page.evaluate(() => (globalThis as any).api.invoke('claudeCode:connectCommand', {}))
    const url = /(http:\/\/127\.0\.0\.1:\d+\/mcp)/.exec(command)?.[1]
    const token = /Bearer (\S+?)"?$/.exec(command)?.[1]
    expect(url).toBe(`http://127.0.0.1:${port}/mcp`)
    expect(token).toBeTruthy()
    await page.keyboard.press('Escape')

    client = new Client({ name: 'e2e', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(url!), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
    const result = await client.callTool({
      name: 'create_character',
      arguments: { name: 'Mina', role: 'protagonist', appearanceLock: 'Teenage girl, slim build, silver bob haircut, amber eyes, red bomber jacket.', generateBaseImage: false }
    })
    expect(result.isError).toBeFalsy()

    await openTab(page, 'characters')
    await expect(page.getByTestId('character-card').filter({ hasText: 'Mina' })).toBeVisible()

    const driven = page.getByTestId('session-item').filter({ hasText: 'Claude Code' })
    await expect(driven).toHaveCount(1)
    await driven.click()
    await expect(page.getByTestId('driver-banner')).toHaveText(/Driven by Claude Code/)
    await expect(page.getByTestId('tool-card').filter({ hasText: 'create_character' })).toHaveCount(1)
  } finally {
    await client?.close().catch(() => {})
    await app.close()
  }
})
