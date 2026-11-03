import fs from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Item, ToolResult } from '@shared/types'
import { testServices, type TestServices } from '../../test/test-services'
import { buildAgentTools } from '.'
import { itemTools } from './item-tools'
import { ToolRegistry, type ToolContext } from './registry'

let s: TestServices | undefined
afterEach(async () => {
  await s?.cleanup()
  s = undefined
})

let n = 0
const call = (name: string, input: unknown) => ({ id: `call_${++n}`, name, input })

async function setup(signal: AbortSignal = new AbortController().signal) {
  s = await testServices()
  const ctx = await s.projects.create({ title: 'Star Courier' })
  const tools = new ToolRegistry(itemTools)
  const toolCtx: ToolContext = { project: ctx, services: s, signal, threadKey: 'ses_0000000001' }
  const run = (name: string, input: unknown): Promise<ToolResult> => tools.execute(call(name, input), toolCtx)
  return { s, ctx, tools, toolCtx, run }
}

const blaster = { name: 'Kestrel blaster', appearanceLock: 'BLOCK' }
const json = (r: ToolResult): Record<string, any> => JSON.parse(r.content)

describe('item tools', () => {
  it('are part of the agent tool set, right after the character tools', () => {
    expect(buildAgentTools({ vision: false }).names().slice(6, 12)).toEqual([
      'list_items',
      'get_item',
      'create_item',
      'update_item',
      'create_item_usage',
      'regenerate_item_usage'
    ])
  })

  it('describe their inputs as JSON schemas the model can fill in', () => {
    const specs = Object.fromEntries(buildAgentTools({ vision: false }).specs().map((t) => [t.name, t]))
    const schema = (name: string) => specs[name].inputSchema as { required?: string[]; properties: Record<string, any> }
    expect(schema('create_item').required).toEqual(expect.arrayContaining(['name', 'appearanceLock']))
    for (const optional of ['generateBaseImage', 'ownerId', 'aliases', 'notes']) expect(schema('create_item').required).not.toContain(optional)
    expect(schema('create_item_usage').required).toEqual(expect.arrayContaining(['itemId', 'name', 'kind', 'delta']))
    expect(schema('create_item_usage').required).not.toContain('generateImage')
    expect(schema('create_item_usage').properties.kind.enum).toEqual(['state', 'action'])
    expect(schema('update_item').required).toEqual(['itemId', 'patch'])
    expect(schema('regenerate_item_usage').required).toEqual(['itemId', 'usageId'])
    expect(schema('get_item').required).toEqual(['itemId'])
    expect(schema('create_panel').properties.items.description).toContain('An item named in the description must be attached or listed in offPanelMentions')
    for (const name of ['list_items', 'get_item', 'create_item', 'update_item', 'create_item_usage', 'regenerate_item_usage'])
      expect(specs[name].description.length).toBeGreaterThan(20)
  })

  it('create_item generates the base image and returns it', async () => {
    const { run, ctx, s } = await setup()
    const r = await run('create_item', blaster)
    expect(r.ok).toBe(true)
    const out = json(r)
    expect(out).toMatchObject({ baseStatus: 'ready', baseError: null })
    expect(out.imagePath).toMatch(/^items\/itm_[0-9a-f]{10}\/use_[0-9a-f]{10}_[0-9a-f]{6}\.png$/)
    expect(r.images).toEqual([out.imagePath])
    expect(fs.existsSync(ctx.paths.resolveAsset(out.imagePath))).toBe(true)
    const stored = await s.items.get(ctx, out.itemId)
    expect(stored).toMatchObject({ name: 'Kestrel blaster', createdBy: 'ai' })
    expect(stored.usages).toMatchObject([{ id: out.baseUsageId, name: 'At rest', kind: 'base', status: 'ready', createdBy: 'ai' }])
  })

  it('create_item passes the optional fields through, owner included', async () => {
    const { run, ctx, s } = await setup()
    const mina = await s.characters.create(ctx, { name: 'Mina', role: 'protagonist', appearanceLock: 'L' }, 'user', { generate: false })
    const r = await run('create_item', { ...blaster, aliases: ['the blaster'], notes: 'Her late father sidearm', ownerId: mina.id, generateBaseImage: false })
    const stored = await s.items.get(ctx, json(r).itemId)
    expect(stored).toMatchObject({ aliases: ['the blaster'], notes: 'Her late father sidearm', ownerId: mina.id })
  })

  it('create_item without a base image makes no image call and records the base failed (Ruling F4)', async () => {
    const { run, s, ctx } = await setup()
    await s.registry.assignRole('image', null) // would fail if the tool tried to generate
    const r = await run('create_item', { ...blaster, generateBaseImage: false })
    expect(r.ok).toBe(true)
    expect(json(r)).toMatchObject({ baseStatus: 'failed', baseError: 'No image yet: upload one or regenerate', imagePath: null })
    expect(r.images).toEqual([])
    expect((await s.items.list(ctx))[0].usages[0]).toMatchObject({ status: 'failed', error: 'No image yet: upload one or regenerate' })
  })

  it('create_item reports image failure but keeps the item', async () => {
    const { run, s, ctx } = await setup()
    await s.registry.assignRole('image', null)
    const r = await run('create_item', blaster)
    expect(r.ok).toBe(true)
    expect(r.images).toEqual([])
    const out = json(r)
    expect(out.baseStatus).toBe('failed')
    expect(out.baseError).toContain("No model assigned to role 'image'")
    expect(out.imagePath).toBeNull()
    expect(await s.items.list(ctx)).toHaveLength(1)
  })

  it('create_item turns a duplicate name into a tool error', async () => {
    const { run } = await setup()
    await run('create_item', blaster)
    expect(await run('create_item', { ...blaster, name: 'kestrel BLASTER' })).toMatchObject({ ok: false, content: 'An item named "kestrel BLASTER" already exists' })
  })

  it('create_item rejects an unknown ownerId and creates nothing', async () => {
    const { run, s, ctx } = await setup()
    expect(await run('create_item', { ...blaster, ownerId: 'chr_ffffffffff' })).toMatchObject({ ok: false, content: 'Unknown character: chr_ffffffffff' })
    expect(await run('create_item', { ...blaster, ownerId: 'Mina' })).toMatchObject({ ok: false, content: 'Unknown character: Mina' })
    expect(await s.items.list(ctx)).toEqual([])
  })

  it('the run signal reaches the image call, so Stop ends a generation that is under way', async () => {
    const controller = new AbortController()
    const { run, s, ctx } = await setup(controller.signal)
    const generate = vi.spyOn(s.images, 'generate').mockImplementation(
      (_ctx, req) =>
        new Promise((_resolve, reject) => {
          req.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
        })
    )
    const pending = run('create_item', blaster)
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    controller.abort()
    const r = await pending
    expect(r.ok).toBe(true)
    expect(json(r)).toMatchObject({ baseStatus: 'failed', baseError: 'Cancelled' })
    expect((await s.items.list(ctx))[0].usages[0]).toMatchObject({ status: 'failed', error: 'Cancelled' })
  })

  it('create_item_usage adds a ready usage with its image', async () => {
    const { run, ctx, s } = await setup()
    const { itemId } = json(await run('create_item', blaster))
    const r = await run('create_item_usage', { itemId, name: 'Firing', kind: 'action', delta: 'both hands, thin cyan beam from the barrel tip' })
    expect(r.ok).toBe(true)
    const out = json(r)
    expect(out).toMatchObject({ status: 'ready', error: null })
    expect(r.images).toEqual([out.imagePath])
    const item = await s.items.get(ctx, itemId)
    expect(item.usages).toHaveLength(2)
    expect(item.usages[1]).toMatchObject({ id: out.usageId, name: 'Firing', kind: 'action', delta: 'both hands, thin cyan beam from the barrel tip', createdBy: 'ai', status: 'ready' })
  })

  it('create_item_usage refuses a duplicate name and names the existing usage', async () => {
    const { run, ctx, s } = await setup()
    const { itemId } = json(await run('create_item', blaster))
    await run('create_item_usage', { itemId, name: 'Firing', kind: 'action', delta: 'x' })
    const again = await run('create_item_usage', { itemId, name: 'firing', kind: 'action', delta: 'y' })
    expect(again.ok).toBe(false)
    expect(again.content).toBe('Kestrel blaster already has a usage named "Firing": use that one')
    expect((await s.items.get(ctx, itemId)).usages).toHaveLength(2)
  })

  it('create_item_usage cannot add a second base and rejects bad input', async () => {
    const { run } = await setup()
    const { itemId } = json(await run('create_item', blaster))
    const r = await run('create_item_usage', { itemId, name: 'B', kind: 'base', delta: '' })
    expect(r.ok).toBe(false)
    expect(r.content).toMatch(/^Invalid input for create_item_usage: kind: /)
  })

  it('create_item_usage with generateImage false records the usage failed, not pending, and calls no model (Ruling F4)', async () => {
    const { run, s, ctx } = await setup()
    const { itemId } = json(await run('create_item', blaster))
    await s.registry.assignRole('image', null)
    const r = await run('create_item_usage', { itemId, name: 'Folded', kind: 'state', delta: 'barrel hinged back', generateImage: false })
    expect(json(r)).toMatchObject({ status: 'failed', error: 'No image yet: upload one or regenerate', imagePath: null })
    expect(r.images).toEqual([])
    expect((await s.items.get(ctx, itemId)).usages[1]).toMatchObject({ status: 'failed', error: 'No image yet: upload one or regenerate' })
  })

  it('create_item_usage fails inside the result when the base image is not ready', async () => {
    const { run, s } = await setup()
    await s.registry.assignRole('image', null)
    const { itemId } = json(await run('create_item', blaster))
    const r = await run('create_item_usage', { itemId, name: 'Firing', kind: 'action', delta: 'x' })
    expect(r.ok).toBe(true)
    expect(json(r)).toMatchObject({ status: 'failed', error: 'Base reference image is not ready', imagePath: null })
    expect(r.images).toEqual([])
  })

  it('regenerate_item_usage makes a new image, and rejects unknown ids', async () => {
    const { run, ctx, s } = await setup()
    const created = json(await run('create_item', blaster))
    const r = await run('regenerate_item_usage', { itemId: created.itemId, usageId: created.baseUsageId })
    expect(r.ok).toBe(true)
    const out = json(r)
    expect(out).toMatchObject({ usageId: created.baseUsageId, status: 'ready' })
    expect(out.imagePath).not.toBe(created.imagePath)
    expect(r.images).toEqual([out.imagePath])
    expect((await s.items.get(ctx, created.itemId)).usages[0].imagePath).toBe(out.imagePath)

    expect(await run('regenerate_item_usage', { itemId: created.itemId, usageId: 'use_ffffffffff' })).toMatchObject({ ok: false, content: 'Unknown usage: use_ffffffffff' })
    expect(await run('regenerate_item_usage', { itemId: 'itm_ffffffffff', usageId: created.baseUsageId })).toMatchObject({ ok: false, content: 'Unknown item: itm_ffffffffff' })
  })

  it('regenerate_item_usage keeps the previous image when the new one fails', async () => {
    const { run, s } = await setup()
    const created = json(await run('create_item', blaster))
    await s.registry.assignRole('image', null)
    const r = await run('regenerate_item_usage', { itemId: created.itemId, usageId: created.baseUsageId })
    expect(r.ok).toBe(true)
    expect(json(r)).toMatchObject({ status: 'failed', imagePath: created.imagePath })
    expect(json(r).error).toContain("No model assigned to role 'image'")
    expect(r.images).toEqual([])
  })

  it('update_item warns on an item lock change', async () => {
    const { run, ctx, s } = await setup()
    const { itemId } = json(await run('create_item', blaster))
    const r = await run('update_item', { itemId, patch: { appearanceLock: 'NEW BLOCK' } })
    expect(r.ok).toBe(true)
    expect(json(r).warnings).toEqual(['appearanceLock changed: regenerate the base and every usage so new panels stay consistent.'])
    expect((await s.items.get(ctx, itemId)).appearanceLock).toBe('NEW BLOCK')
  })

  it('update_item changes other fields without a warning and can clear the owner', async () => {
    const { run, ctx, s } = await setup()
    const mina = await s.characters.create(ctx, { name: 'Mina', role: 'protagonist', appearanceLock: 'L' }, 'user', { generate: false })
    const { itemId } = json(await run('create_item', { ...blaster, ownerId: mina.id, generateBaseImage: false }))
    const r = await run('update_item', { itemId, patch: { notes: 'Jams when hot', ownerId: null } })
    expect(json(r).warnings).toEqual([])
    expect(json(r).item).toMatchObject({ id: itemId, notes: 'Jams when hot', ownerId: null, appearanceLock: 'BLOCK' })
    expect((await s.items.get(ctx, itemId)).ownerId).toBeNull()
  })

  it('update_item reports unknown items, an unknown owner and duplicate renames', async () => {
    const { run } = await setup()
    expect(await run('update_item', { itemId: 'itm_ffffffffff', patch: { name: 'X' } })).toMatchObject({ ok: false, content: 'Unknown item: itm_ffffffffff' })
    await run('create_item', { ...blaster, generateBaseImage: false })
    const { itemId } = json(await run('create_item', { ...blaster, name: 'Moon lantern', generateBaseImage: false }))
    expect(await run('update_item', { itemId, patch: { name: 'KESTREL BLASTER' } })).toMatchObject({ ok: false, content: 'An item named "KESTREL BLASTER" already exists' })
    expect(await run('update_item', { itemId, patch: { ownerId: 'chr_ffffffffff' } })).toMatchObject({ ok: false, content: 'Unknown character: chr_ffffffffff' })
  })

  it('list_items is compact and hides archived items', async () => {
    const { run, ctx, s } = await setup()
    const a = json(await run('create_item', { ...blaster, aliases: ['the blaster'] }))
    const b = json(await run('create_item', { ...blaster, name: 'Moon lantern', generateBaseImage: false }))
    await s.items.archive(ctx, b.itemId)
    expect(json(await run('list_items', {}))).toEqual({
      items: [
        {
          id: a.itemId,
          name: 'Kestrel blaster',
          aliases: ['the blaster'],
          ownerId: null,
          usages: [{ id: a.baseUsageId, name: 'At rest', kind: 'base', status: 'ready' }]
        }
      ]
    })
  })

  it('get_item returns the full item, archived or not, and rejects unknown ids', async () => {
    const { run, ctx, s } = await setup()
    const { itemId } = json(await run('create_item', blaster))
    await s.items.archive(ctx, itemId)
    const full = json(await run('get_item', { itemId })) as Item
    expect(full).toMatchObject({ id: itemId, name: 'Kestrel blaster', appearanceLock: 'BLOCK', archived: true })
    expect(full.usages).toHaveLength(1)
    expect(await run('get_item', { itemId: 'itm_ffffffffff' })).toMatchObject({ ok: false, content: 'Unknown item: itm_ffffffffff' })
  })

  it('treats a name or path where an id belongs as an unknown item', async () => {
    const { run } = await setup()
    expect(await run('get_item', { itemId: 'Kestrel blaster' })).toMatchObject({ ok: false, content: 'Unknown item: Kestrel blaster' })
    expect(await run('get_item', { itemId: '../project' })).toMatchObject({ ok: false, content: 'Unknown item: ../project' })
    expect(await run('create_item_usage', { itemId: 'Kestrel blaster', name: 'Firing', kind: 'action', delta: 'x' })).toMatchObject({ ok: false, content: 'Unknown item: Kestrel blaster' })
  })
})
