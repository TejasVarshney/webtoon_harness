import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEvent } from '@shared/types'
import { EventBus } from '../events/bus'
import type { Services } from '../services'
import { ActiveContext } from './active-context'
import { PluginManager } from './plugin-manager'
import type { AgentBackend, HarnessPlugin, PluginHost, PluginStatus } from './types'

interface FakePlugin extends HarnessPlugin {
  calls: string[]
  hosts: PluginHost[]
  failStart: boolean
  hangStop: boolean
}

function fakePlugin(id = 'fake'): FakePlugin {
  let running = false
  const plugin: FakePlugin = {
    id,
    name: 'Fake',
    description: 'A fake plugin',
    calls: [],
    hosts: [],
    failStart: false,
    hangStop: false,
    async start(host) {
      plugin.calls.push('start')
      plugin.hosts.push(host)
      if (plugin.failStart) throw new Error('boom')
      running = true
    },
    async stop() {
      plugin.calls.push('stop')
      if (plugin.hangStop) return new Promise<void>(() => undefined)
      running = false
    },
    status(): PluginStatus {
      return running ? { state: 'running', message: 'Fake is running' } : { state: 'off', message: '' }
    }
  }
  return plugin
}

let dir: string
let file: string
let bus: EventBus
let events: AppEvent[]

beforeEach(async () => {
  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'webtoon plugins '))
  file = path.join(dir, 'plugins.json')
  bus = new EventBus()
  events = []
  bus.subscribe((e) => events.push(e))
})
afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5 })
})

function manager(plugins: HarnessPlugin[]): PluginManager {
  const services = { bus, secrets: { name: 'secrets' } } as unknown as Services
  return new PluginManager({ file, plugins, services, activeContext: new ActiveContext() })
}

const writeFile = (value: unknown) => fs.promises.writeFile(file, typeof value === 'string' ? value : JSON.stringify(value))
const readFile = async () => JSON.parse(await fs.promises.readFile(file, 'utf8'))
const changed = () => events.filter((e) => e.type === 'plugins.changed').length

describe('PluginManager', () => {
  it('lists plugins as off when there is no file', async () => {
    const m = manager([fakePlugin()])
    await m.load()
    expect(m.list()).toEqual([
      { id: 'fake', name: 'Fake', description: 'A fake plugin', enabled: false, status: { state: 'off', message: '' }, config: {} }
    ])
    expect(m.loadError()).toBeNull()
    expect(fs.existsSync(file)).toBe(false)
  })

  it('starts a plugin that was enabled at load once, when startEnabled runs', async () => {
    await writeFile({ plugins: { fake: { enabled: true, config: { port: 7881 } } } })
    const p = fakePlugin()
    const m = manager([p])
    await m.load()
    expect(p.calls).toEqual([])
    await m.startEnabled()
    await m.startEnabled()
    expect(p.calls).toEqual(['start'])
    expect(p.hosts[0].config()).toEqual({ port: 7881 })
    expect(m.list()[0]).toMatchObject({ enabled: true, status: { state: 'running', message: 'Fake is running' } })
  })

  it('hands the plugin a host with the app services and the active context', async () => {
    await writeFile({ plugins: { fake: { enabled: true, config: {} } } })
    const p = fakePlugin()
    const m = manager([p])
    await m.load()
    await m.startEnabled()
    const host = p.hosts[0]
    expect(host.bus).toBe(bus)
    expect(host.secrets).toEqual({ name: 'secrets' })
    expect(host.activeContext().get()).toEqual({ projectId: null, episodeId: null })
  })

  it('starts on enable and stops on disable, saving the flag each time', async () => {
    const p = fakePlugin()
    const m = manager([p])
    await m.load()
    const on = await m.setEnabled('fake', true)
    expect(on).toMatchObject({ enabled: true, status: { state: 'running' } })
    expect(p.calls).toEqual(['start'])
    expect(await readFile()).toEqual({ plugins: { fake: { enabled: true, config: {} } } })
    const off = await m.setEnabled('fake', false)
    expect(off).toMatchObject({ enabled: false, status: { state: 'off' } })
    expect(p.calls).toEqual(['start', 'stop'])
    expect(await readFile()).toEqual({ plugins: { fake: { enabled: false, config: {} } } })
  })

  it('does not start a running plugin twice, nor stop one that is off', async () => {
    const p = fakePlugin()
    const m = manager([p])
    await m.load()
    await m.setEnabled('fake', false)
    await m.setEnabled('fake', true)
    await m.setEnabled('fake', true)
    expect(p.calls).toEqual(['start'])
  })

  it('restarts a running plugin when its config changes, and only saves for one that is off', async () => {
    const p = fakePlugin()
    const m = manager([p])
    await m.load()
    const saved = await m.setConfig('fake', { port: 7900 })
    expect(saved).toMatchObject({ enabled: false, config: { port: 7900 } })
    expect(p.calls).toEqual([])
    await m.setEnabled('fake', true)
    p.calls.length = 0
    const view = await m.setConfig('fake', { useAsAgent: true })
    expect(p.calls).toEqual(['stop', 'start'])
    expect(view.config).toEqual({ port: 7900, useAsAgent: true })
    expect(p.hosts.at(-1)!.config()).toEqual({ port: 7900, useAsAgent: true })
    expect(await readFile()).toEqual({ plugins: { fake: { enabled: true, config: { port: 7900, useAsAgent: true } } } })
  })

  it('lets a plugin save its own config without restarting it', async () => {
    const p = fakePlugin()
    const m = manager([p])
    await m.load()
    await m.setEnabled('fake', true)
    await p.hosts[0].setConfig({ port: 7905 })
    expect(p.calls).toEqual(['start'])
    expect(p.hosts[0].config()).toEqual({ port: 7905 })
    expect(await readFile()).toEqual({ plugins: { fake: { enabled: true, config: { port: 7905 } } } })
    expect(changed()).toBe(2)
  })

  it('lets a plugin save its config from inside start', async () => {
    const p = fakePlugin()
    const original = p.start
    p.start = async (host) => {
      await host.setConfig({ generated: true })
      await original(host)
    }
    const m = manager([p])
    await m.load()
    await expect(m.setEnabled('fake', true)).resolves.toMatchObject({ enabled: true, config: { generated: true } })
  })

  it('leaves a corrupt plugins.json untouched, reports it, and treats every plugin as off', async () => {
    await writeFile('{"plugins": oops')
    const before = await fs.promises.readFile(file)
    const p = fakePlugin()
    const m = manager([p])
    await m.load()
    expect(m.list()).toMatchObject([{ id: 'fake', enabled: false }])
    expect(m.loadError()).toContain('plugins.json')
    await m.startEnabled()
    expect(p.calls).toEqual([])
    await expect(m.setEnabled('fake', true)).rejects.toThrow(/plugins\.json/)
    await expect(m.setConfig('fake', { a: 1 })).rejects.toThrow(/plugins\.json/)
    expect(p.calls).toEqual([])
    expect(Buffer.compare(await fs.promises.readFile(file), before)).toBe(0)
  })

  it('treats a file of the wrong shape as corrupt', async () => {
    await writeFile({ plugins: { fake: { enabled: 'yes' } } })
    const m = manager([fakePlugin()])
    await m.load()
    expect(m.loadError()).not.toBeNull()
    expect(m.isEnabled('fake')).toBe(false)
  })

  it('keeps entries for plugins it does not know when it saves', async () => {
    await writeFile({ plugins: { ghost: { enabled: true, config: { a: 1 } } } })
    const m = manager([fakePlugin()])
    await m.load()
    await m.setEnabled('fake', true)
    expect(await readFile()).toEqual({
      plugins: { ghost: { enabled: true, config: { a: 1 } }, fake: { enabled: true, config: {} } }
    })
    expect(m.list().map((v) => v.id)).toEqual(['fake'])
  })

  it('rejects an unknown plugin id', async () => {
    const m = manager([fakePlugin()])
    await m.load()
    await expect(m.setEnabled('nope', true)).rejects.toThrow('Unknown plugin: nope')
    await expect(m.setConfig('nope', {})).rejects.toThrow('Unknown plugin: nope')
  })

  it('announces every change with plugins.changed', async () => {
    const m = manager([fakePlugin()])
    await m.load()
    await m.setEnabled('fake', true)
    expect(changed()).toBe(1)
    await m.setConfig('fake', { a: 1 })
    expect(changed()).toBe(2)
    await m.setEnabled('fake', false)
    expect(changed()).toBe(3)
  })

  it('announces the start of the plugins enabled at launch', async () => {
    await writeFile({ plugins: { fake: { enabled: true, config: {} } } })
    const m = manager([fakePlugin()])
    await m.load()
    await m.startEnabled()
    expect(changed()).toBe(1)
  })

  it('shows a start that throws as an error status, without throwing', async () => {
    const p = fakePlugin()
    p.failStart = true
    const m = manager([p])
    await m.load()
    const view = await m.setEnabled('fake', true)
    expect(view).toMatchObject({ enabled: true, status: { state: 'error', message: 'boom' } })
    expect(await readFile()).toEqual({ plugins: { fake: { enabled: true, config: {} } } })
    // Turning it off still lets the plugin release whatever it half-opened, and the error goes away.
    const off = await m.setEnabled('fake', false)
    expect(p.calls).toEqual(['start', 'stop'])
    expect(off.status.state).toBe('off')
  })

  it('stops every running plugin', async () => {
    await writeFile({ plugins: { a: { enabled: true, config: {} }, b: { enabled: true, config: {} } } })
    const a = fakePlugin('a')
    const b = fakePlugin('b')
    const c = fakePlugin('c')
    const m = manager([a, b, c])
    await m.load()
    await m.startEnabled()
    await m.stopAll()
    expect(a.calls).toEqual(['start', 'stop'])
    expect(b.calls).toEqual(['start', 'stop'])
    expect(c.calls).toEqual([])
  })

  it('gives up on a plugin whose stop never settles after 5 s, and still stops the others', async () => {
    await writeFile({ plugins: { a: { enabled: true, config: {} }, b: { enabled: true, config: {} } } })
    const a = fakePlugin('a')
    a.hangStop = true
    const b = fakePlugin('b')
    const m = manager([a, b])
    await m.load()
    await m.startEnabled()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    let done = false
    const stopping = m.stopAll().then(() => {
      done = true
    })
    await vi.advanceTimersByTimeAsync(4_999)
    expect(done).toBe(false)
    expect(b.calls).toEqual(['start', 'stop'])
    await vi.advanceTimersByTimeAsync(1)
    await stopping
    expect(done).toBe(true)
    expect(warn).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  describe('agentBackend', () => {
    const backend: AgentBackend = { start: async () => ({ runId: 'run_1' }), stop: async () => undefined, isRunning: () => false }

    it('is null unless the plugin is enabled and set to be the agent', async () => {
      const p = fakePlugin()
      p.agentBackend = backend
      const m = manager([p, fakePlugin('other')])
      await m.load()
      expect(m.agentBackend()).toBeNull()
      await m.setConfig('fake', { useAsAgent: true })
      expect(m.agentBackend()).toBeNull()
      await m.setEnabled('fake', true)
      expect(m.agentBackend()).toBe(backend)
      await m.setConfig('fake', { useAsAgent: 'yes' })
      expect(m.agentBackend()).toBeNull()
      await m.setConfig('fake', { useAsAgent: true })
      await m.setEnabled('fake', false)
      expect(m.agentBackend()).toBeNull()
    })

    it('is null when the plugin has no backend', async () => {
      const m = manager([fakePlugin()])
      await m.load()
      await m.setConfig('fake', { useAsAgent: true })
      await m.setEnabled('fake', true)
      expect(m.agentBackend()).toBeNull()
    })
  })
})
