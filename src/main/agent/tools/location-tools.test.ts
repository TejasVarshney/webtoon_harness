import { afterEach, describe, expect, it } from 'vitest'
import type { ToolResult } from '@shared/types'
import { testServices, type TestServices } from '../../test/test-services'
import { buildAgentTools } from '.'
import { locationTools } from './location-tools'
import { ToolRegistry, type ToolContext } from './registry'

let s: TestServices | undefined
afterEach(async () => {
  await s?.cleanup()
  s = undefined
})

let n = 0
const call = (name: string, input: unknown) => ({ id: `call_${++n}`, name, input })

async function setup() {
  s = await testServices()
  const ctx = await s.projects.create({ title: 'A new World' })
  const tools = new ToolRegistry(locationTools)
  const toolCtx: ToolContext = { project: ctx, services: s, signal: new AbortController().signal, threadKey: 'ses_0000000001' }
  const run = (name: string, input: unknown): Promise<ToolResult> => tools.execute(call(name, input), toolCtx)
  return { s, ctx, run }
}

const stockroom = { name: 'Back stockroom', layout: 'Camera faces the back wall. Back door at frame-left; shelves at frame-right.' }
const json = (r: ToolResult): Record<string, any> => JSON.parse(r.content)

describe('location tools', () => {
  it('are part of the agent tool set, right after the item tools, and none deletes', () => {
    const names = buildAgentTools({ vision: false }).names()
    expect(names.slice(12, 18)).toEqual(['list_locations', 'get_location', 'create_location', 'update_location', 'create_location_state', 'regenerate_location_state'])
    expect(names.filter((name) => name.includes('delete') || name.includes('archive'))).toEqual([])
  })

  it('describe their inputs as JSON schemas the model can fill in', () => {
    const specs = Object.fromEntries(buildAgentTools({ vision: false }).specs().map((t) => [t.name, t]))
    const schema = (name: string) => specs[name].inputSchema as { required?: string[]; properties: Record<string, any> }
    expect(schema('create_location').required).toEqual(expect.arrayContaining(['name', 'layout']))
    expect(schema('create_location').required).not.toContain('generateBaseImage')
    expect(schema('create_location_state').required).toEqual(expect.arrayContaining(['locationId', 'name', 'delta']))
    expect(schema('regenerate_location_state').required).toEqual(['locationId', 'stateId'])
    expect(schema('create_panel').properties.location.description).toContain('"reverse" (facing the other way, so frame-left and frame-right swap)')
  })

  it('create_location draws the base picture and returns it', async () => {
    const { run, ctx, s } = await setup()
    const r = await run('create_location', stockroom)
    const out = json(r)
    expect(out).toMatchObject({ baseStatus: 'ready', baseError: null })
    expect(r.images).toEqual([out.imagePath])
    const stored = await s.locations.get(ctx, out.locationId)
    expect(stored.states[0]).toMatchObject({ id: out.baseStateId, kind: 'base', status: 'ready' })
  })

  it('create_location_state adds a state without a picture unless asked, and names a duplicate to reuse', async () => {
    const { run } = await setup()
    const { locationId } = json(await run('create_location', stockroom))
    const night = json(await run('create_location_state', { locationId, name: 'Night', delta: 'only embers glowing' }))
    expect(night).toMatchObject({ status: 'failed', imagePath: null })
    const drawn = json(await run('regenerate_location_state', { locationId, stateId: night.stateId }))
    expect(drawn).toMatchObject({ stateId: night.stateId, status: 'ready' })
    const again = await run('create_location_state', { locationId, name: 'night', delta: 'x' })
    expect(again.ok).toBe(false)
    expect(again.content).toContain('Back stockroom already has a state named "Night": use that one')
  })

  it('update_location warns that a new layout needs the pictures redrawn', async () => {
    const { run } = await setup()
    const { locationId } = json(await run('create_location', { ...stockroom, generateBaseImage: false }))
    expect(json(await run('update_location', { locationId, patch: { notes: 'Their hideout.' } })).warnings).toEqual([])
    expect(json(await run('update_location', { locationId, patch: { layout: 'Back door at frame-right.' } })).warnings).toEqual([
      'layout changed: regenerate the base picture and every state picture so new panels stay consistent.'
    ])
  })

  it('list_locations and get_location show the states and their pictures; an unknown id is named', async () => {
    const { run } = await setup()
    const { locationId, baseStateId } = json(await run('create_location', stockroom))
    expect(json(await run('list_locations', {})).locations).toEqual([
      { id: locationId, name: 'Back stockroom', aliases: [], states: [{ id: baseStateId, name: 'Default', kind: 'base', status: 'ready', check: null }] }
    ])
    expect(json(await run('get_location', { locationId })).layout).toBe(stockroom.layout)
    const unknown = await run('get_location', { locationId: 'Back stockroom' })
    expect(unknown).toMatchObject({ ok: false, content: 'Unknown location: Back stockroom' })
  })
})
