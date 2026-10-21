import { afterEach, describe, expect, it } from 'vitest'
import { IPC_CHANNELS } from '@shared/ipc'
import { testServices, type TestServices } from '../test/test-services'
import { registerIpc } from './register'

let services: TestServices | undefined
afterEach(async () => {
  await services?.cleanup()
  services = undefined
})

function collect(s: TestServices): Map<string, (e: unknown, req: unknown) => unknown> {
  const map = new Map<string, (e: unknown, req: unknown) => unknown>()
  registerIpc({ handle: (c, fn) => void map.set(c, fn) }, s)
  return map
}

describe('registerIpc', () => {
  it('registers a handler for every channel', async () => {
    services = await testServices()
    const handled: string[] = []
    registerIpc({ handle: (c) => handled.push(c) }, services)
    expect(handled.sort()).toEqual([...IPC_CHANNELS].sort())
  })

  it('creates, opens and updates a project', async () => {
    services = await testServices()
    const h = collect(services)
    const meta = (await h.get('projects:create')!(null, { title: 'Moon Diary' })) as { id: string; title: string }
    expect(meta.title).toBe('Moon Diary')
    const opened = (await h.get('projects:open')!(null, { projectId: meta.id })) as { meta: { id: string }; problems: unknown[] }
    expect(opened.meta.id).toBe(meta.id)
    expect(opened.problems).toEqual([])
    const updated = (await h.get('projects:update')!(null, { projectId: meta.id, patch: { title: 'Sun Diary' } })) as { title: string }
    expect(updated.title).toBe('Sun Diary')
    const listed = (await h.get('projects:list')!(null, {})) as { projects: { title: string }[] }
    expect(listed.projects.map((p) => p.title)).toEqual(['Sun Diary'])
  })

  it('creates, renames, lists and deletes a session', async () => {
    services = await testServices()
    const h = collect(services)
    const { id: projectId } = (await h.get('projects:create')!(null, { title: 'P' })) as { id: string }
    const ses = (await h.get('sessions:create')!(null, { projectId })) as { id: string }
    await h.get('sessions:rename')!(null, { projectId, sessionId: ses.id, title: 'Renamed' })
    const list = (await h.get('sessions:list')!(null, { projectId })) as { title: string }[]
    expect(list.map((s) => s.title)).toEqual(['Renamed'])
    expect(await h.get('sessions:load')!(null, { projectId, sessionId: ses.id })).toEqual([])
    await h.get('sessions:delete')!(null, { projectId, sessionId: ses.id })
    expect(services.trashed).toHaveLength(1)
  })

  it('manages models over IPC without ever returning a key', async () => {
    services = await testServices()
    const h = collect(services)
    const call = (c: string, req: unknown): Promise<any> => Promise.resolve(h.get(c)!(null, req))
    const e = await call('models:addEndpoint', { name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com' })
    await call('models:setApiKey', { endpointId: e.id, key: 'sk-ant-SECRET' })
    const m = await call('models:addModel', { endpointId: e.id, modelId: 'claude-opus-5-5', label: 'Opus', capabilities: ['text'] })
    await call('models:assignRole', { role: 'agent', modelId: m.id })
    const view = await call('models:get', {})
    expect(JSON.stringify(view)).not.toContain('SECRET')
    expect(view.effectiveRoles.agent).toBe(m.id)
    expect(await call('models:removeModel', { id: m.id })).toEqual({ clearedRoles: ['agent'] })
    expect(await call('models:removeEndpoint', { id: e.id })).toEqual({ clearedRoles: [] })
  })
})
