import fs from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Character, ToolResult } from '@shared/types'
import { testServices, type TestServices } from '../../test/test-services'
import { buildAgentTools } from '.'
import { characterTools } from './character-tools'
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
  const ctx = await s.projects.create({ title: 'Moon Diary' })
  const tools = new ToolRegistry(characterTools)
  const toolCtx: ToolContext = { project: ctx, services: s, signal, threadKey: 'ses_0000000001' }
  const run = (name: string, input: unknown): Promise<ToolResult> => tools.execute(call(name, input), toolCtx)
  return { s, ctx, tools, toolCtx, run }
}

const mina = { name: 'Mina', role: 'protagonist', appearanceLock: 'LOCK' }
const json = (r: ToolResult): Record<string, any> => JSON.parse(r.content)

describe('character tools', () => {
  it('are part of the agent tool set, ahead of the panel tools', () => {
    expect(buildAgentTools({ vision: false }).names().slice(0, 6)).toEqual([
      'list_characters',
      'get_character',
      'create_character',
      'update_character',
      'create_variation',
      'regenerate_variation'
    ])
  })

  it('describe their inputs as JSON schemas the model can fill in', () => {
    const specs = Object.fromEntries(buildAgentTools({ vision: false }).specs().map((t) => [t.name, t]))
    const schema = (name: string) => specs[name].inputSchema as { required?: string[]; properties: Record<string, any> }
    expect(schema('create_character').required).toEqual(expect.arrayContaining(['name', 'role', 'appearanceLock']))
    expect(schema('create_character').required).not.toContain('generateBaseImage')
    expect(schema('create_character').properties.role.enum).toEqual(['protagonist', 'antagonist', 'supporting', 'minor'])
    expect(schema('create_variation').required).toEqual(expect.arrayContaining(['characterId', 'name', 'kind', 'delta']))
    expect(schema('create_variation').required).not.toContain('generateImage')
    expect(schema('create_variation').properties.kind.enum).toEqual(['outfit', 'expression', 'pose', 'age', 'form', 'other'])
    expect(schema('update_character').required).toEqual(['characterId', 'patch'])
    expect(schema('regenerate_variation').required).toEqual(['characterId', 'variationId'])
    for (const spec of Object.values(specs)) expect(spec.description.length).toBeGreaterThan(20)
  })

  it('create_character awaits the base image', async () => {
    const { run, ctx, s } = await setup()
    const r = await run('create_character', mina)
    expect(r.ok).toBe(true)
    const out = json(r)
    expect(out).toMatchObject({ baseStatus: 'ready', baseError: null })
    expect(out.imagePath).toMatch(/^characters\/chr_[0-9a-f]{10}\/var_[0-9a-f]{10}_[0-9a-f]{6}\.png$/)
    expect(r.images).toEqual([out.imagePath])
    expect(fs.existsSync(ctx.paths.resolveAsset(out.imagePath))).toBe(true)
    const stored = await s.characters.get(ctx, out.characterId)
    expect(stored).toMatchObject({ name: 'Mina', createdBy: 'ai' })
    expect(stored.variations).toMatchObject([{ id: out.baseVariationId, kind: 'base', status: 'ready', createdBy: 'ai' }])
  })

  it('create_character passes the optional fields through', async () => {
    const { run, ctx, s } = await setup()
    const r = await run('create_character', {
      ...mina,
      aliases: ['Min'],
      characterization: { personality: 'shy' },
      appearance: { hair: 'silver bob' },
      generateBaseImage: false
    })
    const c = await s.characters.get(ctx, json(r).characterId)
    expect(c).toMatchObject({ aliases: ['Min'], characterization: { personality: 'shy', backstory: '' }, appearance: { hair: 'silver bob', eyes: '' } })
  })

  it('create_character reports image failure but keeps the character', async () => {
    const { run, ctx, s } = await setup()
    await s.registry.assignRole('image', null)
    const r = await run('create_character', mina)
    expect(r.ok).toBe(true)
    expect(r.images).toEqual([])
    const out = json(r)
    expect(out.baseStatus).toBe('failed')
    expect(out.baseError).toContain("No model assigned to role 'image'")
    expect(out.imagePath).toBeNull()
    const stored = await s.characters.get(ctx, out.characterId)
    expect(stored.variations[0]).toMatchObject({ status: 'failed', error: expect.stringContaining("No model assigned to role 'image'") })
  })

  it('create_character without a base image makes no image call and records the base failed (Ruling F4)', async () => {
    const { run, ctx, s } = await setup()
    await s.registry.assignRole('image', null) // would fail if the tool tried to generate
    const r = await run('create_character', { ...mina, generateBaseImage: false })
    expect(r.ok).toBe(true)
    expect(json(r)).toMatchObject({ baseStatus: 'failed', baseError: 'No image yet: upload one or regenerate', imagePath: null })
    expect((await s.characters.list(ctx))[0].variations[0]).toMatchObject({ status: 'failed', error: 'No image yet: upload one or regenerate' })
    expect(r.images).toEqual([])
    expect((await s.characters.list(ctx))).toHaveLength(1)
  })

  it('create_character turns a duplicate name into a tool error', async () => {
    const { run } = await setup()
    await run('create_character', mina)
    const again = await run('create_character', { ...mina, name: 'mina' })
    expect(again).toMatchObject({ ok: false, content: 'A character named "mina" already exists' })
  })

  it('create_character cancelled mid-image keeps the character and reports failed', async () => {
    const controller = new AbortController()
    controller.abort()
    const { run, ctx, s } = await setup(controller.signal)
    const r = await run('create_character', mina)
    expect(r.ok).toBe(true)
    expect(json(r)).toMatchObject({ baseStatus: 'failed', baseError: 'Cancelled' })
    expect((await s.characters.list(ctx))[0].variations[0]).toMatchObject({ status: 'failed', error: 'Cancelled' })
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
    const pending = run('create_character', mina)
    await vi.waitFor(() => expect(generate).toHaveBeenCalledTimes(1))
    controller.abort()
    const r = await pending
    expect(r.ok).toBe(true)
    expect(json(r)).toMatchObject({ baseStatus: 'failed', baseError: 'Cancelled' })
    expect((await s.characters.list(ctx))[0].variations[0]).toMatchObject({ status: 'failed', error: 'Cancelled' })
  })

  it('create_variation rejects unknown characters', async () => {
    const { run } = await setup()
    const r = await run('create_variation', { characterId: 'chr_ffffffffff', name: 'Outfit', kind: 'outfit', delta: 'x' })
    expect(r).toMatchObject({ ok: false, content: 'Unknown character: chr_ffffffffff' })
  })

  it('create_variation adds a ready variation with its image', async () => {
    const { run, ctx, s } = await setup()
    const { characterId } = json(await run('create_character', mina))
    const r = await run('create_variation', { characterId, name: 'Outfit: School uniform', kind: 'outfit', delta: 'navy blazer' })
    expect(r.ok).toBe(true)
    const out = json(r)
    expect(out).toMatchObject({ status: 'ready', error: null })
    expect(r.images).toEqual([out.imagePath])
    const c = await s.characters.get(ctx, characterId)
    expect(c.variations).toHaveLength(2)
    expect(c.variations[1]).toMatchObject({ id: out.variationId, name: 'Outfit: School uniform', kind: 'outfit', delta: 'navy blazer', createdBy: 'ai', status: 'ready' })
  })

  it('create_variation cannot add a second base and rejects bad input', async () => {
    const { run } = await setup()
    const { characterId } = json(await run('create_character', mina))
    const r = await run('create_variation', { characterId, name: 'B', kind: 'base', delta: '' })
    expect(r.ok).toBe(false)
    expect(r.content).toMatch(/^Invalid input for create_variation: kind: /)
  })

  it('create_variation with generateImage false records the variation failed, not pending, and calls no model (Ruling F4)', async () => {
    const { run, s, ctx } = await setup()
    const { characterId } = json(await run('create_character', mina))
    await s.registry.assignRole('image', null)
    const r = await run('create_variation', { characterId, name: 'Pose: Running', kind: 'pose', delta: 'mid-stride', generateImage: false })
    expect(json(r)).toMatchObject({ status: 'failed', error: 'No image yet: upload one or regenerate', imagePath: null })
    expect(r.images).toEqual([])
    expect((await s.characters.get(ctx, characterId)).variations[1]).toMatchObject({ status: 'failed', error: 'No image yet: upload one or regenerate' })
  })

  it('create_variation fails inside the result when the base image is not ready', async () => {
    const { run, s } = await setup()
    await s.registry.assignRole('image', null)
    const { characterId } = json(await run('create_character', mina))
    const r = await run('create_variation', { characterId, name: 'Outfit', kind: 'outfit', delta: 'x' })
    expect(r.ok).toBe(true)
    expect(json(r)).toMatchObject({ status: 'failed', error: 'Base reference image is not ready', imagePath: null })
    expect(r.images).toEqual([])
  })

  it('regenerate_variation makes a new image, and rejects unknown ids', async () => {
    const { run, ctx, s } = await setup()
    const created = json(await run('create_character', mina))
    const r = await run('regenerate_variation', { characterId: created.characterId, variationId: created.baseVariationId })
    expect(r.ok).toBe(true)
    const out = json(r)
    expect(out).toMatchObject({ variationId: created.baseVariationId, status: 'ready' })
    expect(out.imagePath).not.toBe(created.imagePath)
    expect(r.images).toEqual([out.imagePath])
    expect((await s.characters.get(ctx, created.characterId)).variations[0].imagePath).toBe(out.imagePath)

    expect(await run('regenerate_variation', { characterId: created.characterId, variationId: 'var_ffffffffff' })).toMatchObject({
      ok: false,
      content: 'Unknown variation: var_ffffffffff'
    })
    expect(await run('regenerate_variation', { characterId: 'chr_ffffffffff', variationId: created.baseVariationId })).toMatchObject({
      ok: false,
      content: 'Unknown character: chr_ffffffffff'
    })
  })

  it('regenerate_variation keeps the previous image when the new one fails', async () => {
    const { run, s } = await setup()
    const created = json(await run('create_character', mina))
    await s.registry.assignRole('image', null)
    const r = await run('regenerate_variation', { characterId: created.characterId, variationId: created.baseVariationId })
    expect(r.ok).toBe(true)
    expect(json(r)).toMatchObject({ status: 'failed', imagePath: created.imagePath })
    expect(json(r).error).toContain("No model assigned to role 'image'")
    expect(r.images).toEqual([])
  })

  it('update_character warns on appearance lock change', async () => {
    const { run, ctx, s } = await setup()
    const { characterId } = json(await run('create_character', mina))
    const r = await run('update_character', { characterId, patch: { appearanceLock: 'NEW LOCK' } })
    expect(r.ok).toBe(true)
    expect(r.content).toContain('appearanceLock changed')
    expect(json(r).warnings).toEqual(['appearanceLock changed: regenerate the base and variations so new panels stay consistent.'])
    expect((await s.characters.get(ctx, characterId)).appearanceLock).toBe('NEW LOCK')
  })

  it('update_character merges partial fields without a warning', async () => {
    const { run, ctx, s } = await setup()
    const { characterId } = json(await run('create_character', { ...mina, appearance: { hair: 'black' } }))
    const r = await run('update_character', { characterId, patch: { appearanceLock: 'LOCK', appearance: { eyes: 'amber' }, characterization: { personality: 'bold' } } })
    expect(json(r).warnings).toEqual([])
    expect(json(r).character).toMatchObject({ id: characterId, appearance: { hair: 'black', eyes: 'amber' } })
    const c = await s.characters.get(ctx, characterId)
    expect(c.characterization.personality).toBe('bold')
    expect(c.appearance).toMatchObject({ hair: 'black', eyes: 'amber' })
  })

  it('update_character reports unknown characters and duplicate renames', async () => {
    const { run } = await setup()
    expect(await run('update_character', { characterId: 'chr_ffffffffff', patch: { name: 'X' } })).toMatchObject({ ok: false, content: 'Unknown character: chr_ffffffffff' })
    await run('create_character', { ...mina, generateBaseImage: false })
    const { characterId } = json(await run('create_character', { ...mina, name: 'Jun', generateBaseImage: false }))
    expect(await run('update_character', { characterId, patch: { name: 'MINA' } })).toMatchObject({ ok: false, content: 'A character named "MINA" already exists' })
  })

  it('list_characters is compact and hides archived characters', async () => {
    const { run, ctx, s } = await setup()
    const a = json(await run('create_character', { ...mina, aliases: ['Min'] }))
    const b = json(await run('create_character', { ...mina, name: 'Jun', role: 'supporting', generateBaseImage: false }))
    await s.characters.archive(ctx, b.characterId)
    const out = json(await run('list_characters', {}))
    expect(out).toEqual({
      characters: [
        { id: a.characterId, name: 'Mina', role: 'protagonist', aliases: ['Min'], variations: [{ id: a.baseVariationId, name: 'Base', kind: 'base', status: 'ready' }] }
      ]
    })
  })

  it('get_character returns the full character, archived or not, and rejects unknown ids', async () => {
    const { run, ctx, s } = await setup()
    const { characterId } = json(await run('create_character', mina))
    await s.characters.archive(ctx, characterId)
    const full = json(await run('get_character', { characterId })) as Character
    expect(full).toMatchObject({ id: characterId, name: 'Mina', appearanceLock: 'LOCK', archived: true })
    expect(full.variations).toHaveLength(1)
    expect(await run('get_character', { characterId: 'chr_ffffffffff' })).toMatchObject({ ok: false, content: 'Unknown character: chr_ffffffffff' })
  })

  it('treats a name or path where an id belongs as an unknown character', async () => {
    const { run } = await setup()
    expect(await run('get_character', { characterId: 'Mina' })).toMatchObject({ ok: false, content: 'Unknown character: Mina' })
    expect(await run('get_character', { characterId: '../project' })).toMatchObject({ ok: false, content: 'Unknown character: ../project' })
    expect(await run('create_variation', { characterId: 'Mina', name: 'O', kind: 'outfit', delta: 'x' })).toMatchObject({ ok: false, content: 'Unknown character: Mina' })
  })
})
