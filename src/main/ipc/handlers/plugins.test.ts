import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createClaudeCodePlugin } from '../../plugins/claude-code/plugin'
import { PluginManager } from '../../plugins/plugin-manager'
import type { HarnessPlugin } from '../../plugins/types'
import { testServices, type TestServices } from '../../test/test-services'
import { pluginsHandlers } from './plugins'
import type { HandlerMap } from './projects'

let s: TestServices | undefined
afterEach(async () => {
  await s?.cleanup()
  s = undefined
})

function fakePlugin(): HarnessPlugin {
  let on = false
  return {
    id: 'fake',
    name: 'Fake',
    description: 'A fake plugin',
    start: async () => {
      on = true
    },
    stop: async () => {
      on = false
    },
    status: () => (on ? { state: 'running', message: 'Up' } : { state: 'off', message: '' })
  }
}

async function setup(plugins: HarnessPlugin[] = [fakePlugin()], detect?: (configured: string) => string | null) {
  s = await testServices()
  s.plugins = new PluginManager({
    file: path.join(s.userDataDir, 'plugins.json'),
    plugins,
    services: s,
    activeContext: s.activeContext
  })
  await s.plugins.load()
  const h = pluginsHandlers(s, detect) as Required<HandlerMap>
  return { services: s, h }
}

describe('plugins IPC handlers', () => {
  it('lists, enables and configures a plugin', async () => {
    const { h } = await setup()
    expect(await h['plugins:list']({})).toMatchObject([{ id: 'fake', enabled: false }])
    expect(await h['plugins:setEnabled']({ id: 'fake', enabled: true })).toMatchObject({ enabled: true, status: { state: 'running', message: 'Up' } })
    expect(await h['plugins:setConfig']({ id: 'fake', patch: { port: 7881 } })).toMatchObject({ config: { port: 7881 } })
  })

  it('rejects a bad request with a readable error', async () => {
    const { h } = await setup()
    await expect(h['plugins:setEnabled']({ id: 'fake', enabled: 'yes' as never })).rejects.toThrow('Invalid input: enabled: ')
    await expect(h['plugins:setEnabled']({ enabled: true } as never)).rejects.toThrow('Invalid input: id: ')
    await expect(h['plugins:setConfig']({ id: 'fake', patch: [] as never })).rejects.toThrow('Invalid input: patch: ')
    await expect(h['plugins:setEnabled']({ id: 'nope', enabled: true })).rejects.toThrow('Unknown plugin: nope')
    expect((await h['plugins:list']({}))[0].enabled).toBe(false)
  })

  it('reports a corrupt plugins.json through plugins:loadError, and null when it is fine', async () => {
    const { h } = await setup()
    expect(await h['plugins:loadError']({})).toBeNull()
    await fs.promises.writeFile(path.join(s!.userDataDir, 'plugins.json'), '{"plugins": oops')
    await s!.plugins.load()
    expect(await h['plugins:loadError']({})).toContain('plugins.json')
    expect(await h['plugins:loadError']({})).toBe(s!.plugins.loadError())
  })

  it('records the project and episode the window shows', async () => {
    const { services, h } = await setup()
    expect(services.activeContext.get()).toEqual({ projectId: null, episodeId: null })
    await h['app:setActiveContext']({ projectId: 'prj_0000000001', episodeId: 'epi_0000000002' })
    expect(services.activeContext.get()).toEqual({ projectId: 'prj_0000000001', episodeId: 'epi_0000000002' })
    await h['app:setActiveContext']({ projectId: null, episodeId: null })
    expect(services.activeContext.get()).toEqual({ projectId: null, episodeId: null })
  })

  it('rejects a context that is not ids or null', async () => {
    const { services, h } = await setup()
    await expect(h['app:setActiveContext']({ projectId: 5 as never, episodeId: null })).rejects.toThrow('Invalid input: projectId: ')
    await expect(h['app:setActiveContext']({ projectId: null } as never)).rejects.toThrow('Invalid input: episodeId: ')
    expect(services.activeContext.get()).toEqual({ projectId: null, episodeId: null })
  })

  describe('Claude Code link', () => {
    const OFF = "Turn on the Claude Code plugin's link first."
    afterEach(() => s?.plugins.stopAll())

    async function freePort(): Promise<number> {
      const probe = http.createServer()
      await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()))
      const { port } = probe.address() as { port: number }
      await new Promise<void>((resolve) => probe.close(() => resolve()))
      return port
    }

    it('fails with a readable error while the plugin is off', async () => {
      const { h } = await setup([createClaudeCodePlugin()])
      await expect(h['claudeCode:connectCommand']({})).rejects.toThrow(OFF)
      await expect(h['claudeCode:regenerateToken']({})).rejects.toThrow(OFF)
    })

    it('fails when the plugin is not built in', async () => {
      const { h } = await setup()
      await expect(h['claudeCode:connectCommand']({})).rejects.toThrow(OFF)
    })

    it('returns the connect command and replaces the token', async () => {
      const plugin = createClaudeCodePlugin()
      const { h } = await setup([plugin])
      const port = await freePort()
      await h['plugins:setConfig']({ id: 'claude-code', patch: { port } })
      await h['plugins:setEnabled']({ id: 'claude-code', enabled: true })
      const { command } = await h['claudeCode:connectCommand']({})
      expect(command).toBe(
        `claude mcp add --transport http webtoon http://127.0.0.1:${port}/mcp --header "Authorization: Bearer ${plugin.token()}"`
      )
      const before = plugin.token()
      await expect(h['claudeCode:regenerateToken']({})).resolves.toBeUndefined()
      expect(plugin.token()).not.toBe(before)
      expect((await h['claudeCode:connectCommand']({})).command).toContain(plugin.token())
    })

    it('detects Claude Code from the configured path, even while the plugin is off', async () => {
      const exe = path.join(os.tmpdir(), `claude-detect-${process.pid}.exe`)
      await fs.promises.writeFile(exe, '')
      try {
        const { h } = await setup([createClaudeCodePlugin()])
        await h['plugins:setConfig']({ id: 'claude-code', patch: { claudePath: exe } })
        expect(await h['claudeCode:detect']({})).toEqual({ path: exe })
      } finally {
        await fs.promises.rm(exe, { force: true })
      }
    })

    it('hands the saved claudePath to the lookup and reports null when nothing is found', async () => {
      const seen: string[] = []
      const { h } = await setup([createClaudeCodePlugin()], (configured) => {
        seen.push(configured)
        return null
      })
      expect(await h['claudeCode:detect']({})).toEqual({ path: null })
      await h['plugins:setConfig']({ id: 'claude-code', patch: { claudePath: 'D:\tools\claude.exe' } })
      expect(await h['claudeCode:detect']({})).toEqual({ path: null })
      expect(seen).toEqual(['', 'D:\tools\claude.exe'])
    })

    it('detects nothing special when the plugin is not built in', async () => {
      const { h } = await setup([], () => null)
      expect(await h['claudeCode:detect']({})).toEqual({ path: null })
    })

    it('rejects a port outside 1024-65535 through plugins:setConfig', async () => {
      const { h } = await setup([createClaudeCodePlugin()])
      await expect(h['plugins:setConfig']({ id: 'claude-code', patch: { port: 80 } })).rejects.toThrow('Port must be between 1024 and 65535')
    })
  })
})
