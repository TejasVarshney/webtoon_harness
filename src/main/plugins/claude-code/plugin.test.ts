import http from 'node:http'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { testServices, type TestServices } from '../../test/test-services'
import { ActiveContext } from '../active-context'
import { PluginManager } from '../plugin-manager'
import { ClaudeCodeBackend } from './claude-code-backend'
import { McpLinkServer } from './mcp-server'
import { createClaudeCodePlugin } from './plugin'

let s: TestServices | undefined
let managers: PluginManager[] = []
let blockers: http.Server[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  for (const m of managers) await m.stopAll()
  for (const b of blockers) await new Promise<void>((resolve) => b.close(() => resolve()))
  managers = []
  blockers = []
  await s?.cleanup()
  s = undefined
})

/** A port that is free right now. */
async function freePort(): Promise<number> {
  const probe = http.createServer()
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()))
  const { port } = probe.address() as { port: number }
  await new Promise<void>((resolve) => probe.close(() => resolve()))
  return port
}

/** A manager holding only `plugin`, set to a free port. Several managers share one `services`, as an app restart would. */
async function managerFor(plugin: ReturnType<typeof createClaudeCodePlugin>, file: string) {
  const manager = new PluginManager({ file: path.join(s!.userDataDir, file), plugins: [plugin], services: s!, activeContext: new ActiveContext() })
  managers.push(manager)
  await manager.load()
  const port = await freePort()
  await manager.setConfig('claude-code', { port })
  return { manager, port }
}

async function setup(plugin = createClaudeCodePlugin()) {
  s = await testServices()
  return { plugin, secrets: s.secrets, ...(await managerFor(plugin, 'plugins.json')) }
}

const view = (manager: PluginManager) => manager.list()[0]
const probe = (port: number) => fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST' })
const OFF_FIRST = "Turn on the Claude Code plugin's link first."

describe('claude-code plugin', () => {
  it('identifies itself', () => {
    const plugin = createClaudeCodePlugin()
    expect(plugin).toMatchObject({
      id: 'claude-code',
      name: 'Claude Code',
      description: 'Lets Claude Code drive this app through an MCP link, and (optionally) act as the agent.'
    })
    expect(plugin.status()).toEqual({ state: 'off', message: 'Off' })
  })

  it('starts a server on the configured port when enabled', async () => {
    const { plugin, manager, port } = await setup()
    await manager.setEnabled('claude-code', true)
    expect(view(manager).status).toEqual({ state: 'running', message: `Listening on 127.0.0.1:${port}` })
    expect(plugin.linkUrl()).toBe(`http://127.0.0.1:${port}/mcp`)
    expect((await probe(port)).status).toBe(401)
  })

  it('creates the token once and keeps it across a restart', async () => {
    const { plugin, manager, secrets } = await setup()
    await manager.setEnabled('claude-code', true)
    const first = plugin.token()
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(secrets.get('plugin:claude-code')).toBe(first)
    await manager.setEnabled('claude-code', false)
    await manager.setEnabled('claude-code', true)
    expect(plugin.token()).toBe(first)
    // A fresh plugin object (the app started again) reads the stored token.
    await manager.stopAll()
    const again = createClaudeCodePlugin()
    const second = await managerFor(again, 'plugins again.json')
    await second.manager.setEnabled('claude-code', true)
    expect(again.token()).toBe(first)
  })

  it('builds the connect command from the port and token', async () => {
    const { plugin, manager, port } = await setup()
    await manager.setEnabled('claude-code', true)
    expect(plugin.connectCommand()).toBe(
      `claude mcp add --transport http webtoon http://127.0.0.1:${port}/mcp --header "Authorization: Bearer ${plugin.token()}"`
    )
  })

  it('refuses the connect command and a token change while off', async () => {
    const { plugin, manager } = await setup()
    expect(() => plugin.connectCommand()).toThrow(OFF_FIRST)
    await expect(plugin.regenerateToken()).rejects.toThrow(OFF_FIRST)
    await manager.setEnabled('claude-code', true)
    await manager.setEnabled('claude-code', false)
    expect(() => plugin.connectCommand()).toThrow(OFF_FIRST)
  })

  it('regenerates the token and ends the open sessions', async () => {
    let server: McpLinkServer | undefined
    const plugin = createClaudeCodePlugin({
      serverFactory: (opts) => {
        server = new McpLinkServer(opts)
        return server
      }
    })
    const { manager, secrets } = await setup(plugin)
    await manager.setEnabled('claude-code', true)
    const closeSessions = vi.spyOn(server!, 'closeSessions')
    const before = plugin.token()
    await plugin.regenerateToken()
    expect(plugin.token()).not.toBe(before)
    expect(secrets.get('plugin:claude-code')).toBe(plugin.token())
    expect(closeSessions).toHaveBeenCalledOnce()
    expect(view(manager).status.state).toBe('running')
  })

  it('shows an error, not off, when the port is busy', async () => {
    const { plugin, manager, port } = await setup()
    const blocker = http.createServer()
    blockers.push(blocker)
    await new Promise<void>((resolve) => blocker.listen(port, '127.0.0.1', () => resolve()))
    await manager.setEnabled('claude-code', true)
    expect(view(manager)).toMatchObject({ enabled: true, status: { state: 'error', message: `Port ${port} is in use` } })
    expect(plugin.linkUrl()).toBeNull()
  })

  it('shows any other start failure as its message', async () => {
    const plugin = createClaudeCodePlugin({
      serverFactory: (opts) => {
        const server = new McpLinkServer(opts)
        vi.spyOn(server, 'listen').mockRejectedValue(new Error('listen EACCES'))
        return server
      }
    })
    const { manager } = await setup(plugin)
    await manager.setEnabled('claude-code', true)
    expect(view(manager)).toMatchObject({ enabled: true, status: { state: 'error', message: 'listen EACCES' } })
  })

  it('rejects a port outside 1024-65535 and other badly typed settings', async () => {
    const { manager } = await setup()
    for (const port of [80, 1023, 65536, 7880.5, '7880', null]) {
      await expect(manager.setConfig('claude-code', { port })).rejects.toThrow('Port must be between 1024 and 65535')
    }
    await expect(manager.setConfig('claude-code', { useAsAgent: 'yes' })).rejects.toThrow('useAsAgent must be true or false')
    await expect(manager.setConfig('claude-code', { claudePath: 5 })).rejects.toThrow('claudePath must be text')
    await expect(manager.setConfig('claude-code', { port: 1024 })).resolves.toBeDefined()
    await expect(manager.setConfig('claude-code', { port: 65535 })).resolves.toBeDefined()
  })

  it('moves to the new port when the port changes while on', async () => {
    const { manager, port } = await setup()
    await manager.setEnabled('claude-code', true)
    const next = await freePort()
    await manager.setConfig('claude-code', { port: next })
    expect(view(manager).status.message).toBe(`Listening on 127.0.0.1:${next}`)
    await expect(probe(port)).rejects.toThrow()
    expect((await probe(next)).status).toBe(401)
  })

  it('closes the server when disabled', async () => {
    const { plugin, manager, port } = await setup()
    await manager.setEnabled('claude-code', true)
    await manager.setEnabled('claude-code', false)
    await expect(probe(port)).rejects.toThrow()
    expect(plugin.status()).toEqual({ state: 'off', message: 'Off' })
    expect(plugin.linkUrl()).toBeNull()
    expect(view(manager).status).toEqual({ state: 'off', message: '' })
  })

  it('adds the session log failure to the status line', async () => {
    let lastError: string | null = null
    const plugin = createClaudeCodePlugin({
      serverFactory: (opts) => {
        vi.spyOn(opts.log, 'lastError').mockImplementation(() => lastError)
        return new McpLinkServer(opts)
      }
    })
    const { manager, port } = await setup(plugin)
    await manager.setEnabled('claude-code', true)
    expect(plugin.status().message).toBe(`Listening on 127.0.0.1:${port}`)
    lastError = 'disk full'
    expect(plugin.status()).toEqual({ state: 'running', message: `Listening on 127.0.0.1:${port} · session log: disk full` })
  })

  it('exposes the host config, empty before the first start', async () => {
    const { plugin, manager, port } = await setup()
    expect(plugin.config()).toEqual({})
    await manager.setEnabled('claude-code', true)
    expect(plugin.config()).toEqual({ port })
    await manager.setConfig('claude-code', { useAsAgent: true })
    expect(plugin.config()).toEqual({ port, useAsAgent: true })
  })

  it('is the agent backend once started with useAsAgent, and stops its runs when it stops', async () => {
    const { plugin, manager } = await setup()
    expect(plugin.agentBackend).toBeUndefined()
    await manager.setEnabled('claude-code', true)
    expect(plugin.agentBackend).toBeInstanceOf(ClaudeCodeBackend)
    expect(manager.agentBackend()).toBeNull()
    await manager.setConfig('claude-code', { useAsAgent: true })
    const backend = plugin.agentBackend as ClaudeCodeBackend
    expect(manager.agentBackend()).toBe(backend)
    const stopAll = vi.spyOn(backend, 'stopAll')
    await manager.setEnabled('claude-code', false)
    expect(stopAll).toHaveBeenCalled()
    expect(manager.agentBackend()).toBeNull()
  })
})
