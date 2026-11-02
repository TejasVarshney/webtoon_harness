import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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

async function setup() {
  s = await testServices()
  s.plugins = new PluginManager({
    file: path.join(s.userDataDir, 'plugins.json'),
    plugins: [fakePlugin()],
    services: s,
    activeContext: s.activeContext
  })
  await s.plugins.load()
  const h = pluginsHandlers(s) as Required<HandlerMap>
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
})
