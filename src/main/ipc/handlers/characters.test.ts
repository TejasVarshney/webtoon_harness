import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Character } from '@shared/types'
import { encodeSolidPng } from '../../models/providers/png'
import { testServices, type TestServices } from '../../test/test-services'
import { charactersHandlers } from './characters'
import type { HandlerMap } from './projects'
import type { PickFiles } from './uploads'

let s: TestServices | undefined
let tmp: string | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  await s?.cleanup()
  if (tmp) await fs.promises.rm(tmp, { recursive: true, force: true })
  s = undefined
  tmp = undefined
})

const PNG = encodeSolidPng(2, 3, [9, 9, 9])
const mina = { name: 'Mina', role: 'protagonist' as const, appearanceLock: 'LOCK' }

async function setup(pickFiles?: PickFiles) {
  s = await testServices()
  const ctx = await s.projects.create({ title: 'Moon Diary' })
  // The first open runs the onOpen hooks (interrupted-generation recovery), so do it before any test data exists.
  await s.projects.open(ctx.id)
  const h: Required<HandlerMap> = charactersHandlers(s, { pickFiles }) as Required<HandlerMap>
  const projectId = ctx.id
  const svc = s.characters
  const get = (id: string): Promise<Character> => svc.get(ctx, id)
  /**
   * Fire-and-forget generation must finish before cleanup removes the project folder. Polls gently: on Windows a
   * rename cannot replace a file that a reader has open at that instant, so a tight poll would starve the writer.
   */
  async function settled(id: string, variationId: string): Promise<Character> {
    const t0 = Date.now()
    for (;;) {
      const c = await get(id)
      if (c.variations.find((v) => v.id === variationId)?.status !== 'pending') return c
      if (Date.now() - t0 > 5000) throw new Error('timeout waiting for generation')
      await new Promise((r) => setTimeout(r, 40))
    }
  }
  return { s, ctx, h, projectId, get, settled }
}

/** Holds the next image generation until `release()`. */
function gateImages(services: TestServices) {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const spy = vi.spyOn(services.images, 'generate').mockImplementation(async () => {
    await gate
    return { data: PNG, ext: 'png' }
  })
  return { release, spy }
}

describe('characters IPC handlers', () => {
  it('create returns at once with a pending base and generates it in the background', async () => {
    const { s, h, projectId, get, settled } = await setup()
    const { release, spy } = gateImages(s)
    const created = await h['characters:create']({ projectId, input: mina, generateBase: true })
    expect(created).toMatchObject({ name: 'Mina', createdBy: 'user', variations: [{ kind: 'base', status: 'pending' }] })
    expect((await get(created.id)).variations[0].status).toBe('pending')
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    release()
    const done = await settled(created.id, created.variations[0].id)
    expect(done.variations[0]).toMatchObject({ status: 'ready', error: null, imagePath: expect.stringMatching(/\.png$/) })
  })

  it('create without generateBase makes no image call and records the base failed (Ruling F4)', async () => {
    const { s, h, projectId, get } = await setup()
    const spy = vi.spyOn(s.images, 'generate')
    const created = await h['characters:create']({ projectId, input: mina, generateBase: false })
    await new Promise((r) => setTimeout(r, 20))
    expect(spy).not.toHaveBeenCalled()
    expect(created.variations[0]).toMatchObject({ status: 'failed', error: 'No image yet: upload one or regenerate' })
    expect((await get(created.id)).variations[0]).toMatchObject({ status: 'failed', error: 'No image yet: upload one or regenerate' })
  })

  it('create rejects bad input and duplicate names', async () => {
    const { h, projectId, settled } = await setup()
    await expect(h['characters:create']({ projectId, input: { ...mina, role: 'hero' } as never, generateBase: false })).rejects.toThrow()
    const first = await h['characters:create']({ projectId, input: mina, generateBase: true })
    await expect(h['characters:create']({ projectId, input: { ...mina, name: 'mina' }, generateBase: true })).rejects.toThrow('A character named "mina" already exists')
    await settled(first.id, first.variations[0].id)
  })

  it('a failed background generation ends failed with the message and logs nothing', async () => {
    const { s, h, projectId, settled } = await setup()
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await s.registry.assignRole('image', null)
    const created = await h['characters:create']({ projectId, input: mina, generateBase: true })
    const done = await settled(created.id, created.variations[0].id)
    expect(done.variations[0]).toMatchObject({ status: 'failed', error: expect.stringContaining("No model assigned to role 'image'") })
    expect(log).not.toHaveBeenCalled()
  })

  it('logs, and does not reject, when the background task itself throws', async () => {
    const { s, h, projectId } = await setup()
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(s.characters, 'generateVariationImage').mockRejectedValue(new Error('disk gone'))
    const created = await h['characters:create']({ projectId, input: mina, generateBase: true })
    await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(1))
    expect(log.mock.calls[0].join(' ')).toContain('disk gone')
    expect(created.name).toBe('Mina')
  })

  it('addVariation returns a pending variation and generates it; kind base is refused', async () => {
    const { s, h, projectId, get, settled } = await setup()
    const c = await s.characters.create(await s.projects.open(projectId), mina, 'user')
    const base = await h['characters:generateVariation']({ projectId, characterId: c.id, variationId: c.variations[0].id })
    expect(base.status).toBe('pending')
    await settled(c.id, base.id)

    const { release } = gateImages(s)
    const v = await h['characters:addVariation']({ projectId, characterId: c.id, input: { name: 'Outfit: School uniform', kind: 'outfit', delta: 'navy blazer' }, generate: true })
    expect(v).toMatchObject({ status: 'pending', kind: 'outfit', createdBy: 'user' })
    expect((await get(c.id)).variations).toHaveLength(2)
    release()
    expect((await settled(c.id, v.id)).variations[1]).toMatchObject({ status: 'ready' })

    await expect(h['characters:addVariation']({ projectId, characterId: c.id, input: { name: 'B', kind: 'base', delta: '' } as never, generate: false })).rejects.toThrow()
    expect((await get(c.id)).variations).toHaveLength(2)
  })

  it('addVariation without generate makes no image call and records the variation failed (Ruling F4)', async () => {
    const { s, h, projectId } = await setup()
    const c = await s.characters.create(await s.projects.open(projectId), mina, 'user')
    const spy = vi.spyOn(s.images, 'generate')
    const v = await h['characters:addVariation']({ projectId, characterId: c.id, input: { name: 'Pose', kind: 'pose', delta: 'x' }, generate: false })
    await new Promise((r) => setTimeout(r, 20))
    expect(v).toMatchObject({ status: 'failed', error: 'No image yet: upload one or regenerate' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('generateVariation starts generation without waiting, and rejects unknown ids up front', async () => {
    const { s, h, projectId, ctx, settled } = await setup()
    const c = await s.characters.create(ctx, mina, 'user')
    const spy = vi.spyOn(s.images, 'generate')
    await expect(h['characters:generateVariation']({ projectId, characterId: c.id, variationId: 'var_ffffffffff' })).rejects.toThrow('Unknown variation: var_ffffffffff')
    await expect(h['characters:generateVariation']({ projectId, characterId: 'chr_ffffffffff', variationId: c.variations[0].id })).rejects.toThrow('Unknown character: chr_ffffffffff')
    expect(spy).not.toHaveBeenCalled()

    const { release } = gateImages(s)
    const v = await h['characters:generateVariation']({ projectId, characterId: c.id, variationId: c.variations[0].id })
    expect(v).toMatchObject({ id: c.variations[0].id, status: 'pending', error: null })
    release()
    expect((await settled(c.id, v.id)).variations[0].status).toBe('ready')
  })

  it('lists, gets, updates, archives and unarchives', async () => {
    const { h, projectId } = await setup()
    const a = await h['characters:create']({ projectId, input: mina, generateBase: false })
    const b = await h['characters:create']({ projectId, input: { ...mina, name: 'Jun' }, generateBase: false })
    expect((await h['characters:list']({ projectId })).map((c) => c.name)).toEqual(['Mina', 'Jun'])
    await h['characters:archive']({ projectId, characterId: b.id })
    expect((await h['characters:list']({ projectId })).map((c) => c.name)).toEqual(['Mina'])
    expect((await h['characters:list']({ projectId, includeArchived: true })).map((c) => c.name)).toEqual(['Mina', 'Jun'])
    expect(await h['characters:get']({ projectId, characterId: b.id })).toMatchObject({ name: 'Jun', archived: true })
    await h['characters:unarchive']({ projectId, characterId: b.id })
    expect((await h['characters:get']({ projectId, characterId: b.id })).archived).toBe(false)

    const updated = await h['characters:update']({ projectId, characterId: a.id, patch: { name: 'Mina Park', appearance: { hair: 'silver bob' } } })
    expect(updated).toMatchObject({ id: a.id, name: 'Mina Park', appearance: { hair: 'silver bob', eyes: '' } })
    await expect(h['characters:update']({ projectId, characterId: a.id, patch: { role: 'hero' } as never })).rejects.toThrow()
    await expect(h['characters:update']({ projectId, characterId: a.id, patch: { name: 'jun' } })).rejects.toThrow('A character named "jun" already exists')
  })

  it('deletes a character to the trash and refuses to delete a base variation', async () => {
    const { s, h, projectId, ctx } = await setup()
    const c = await s.characters.create(ctx, mina, 'user')
    await expect(h['characters:deleteVariation']({ projectId, characterId: c.id, variationId: c.variations[0].id })).rejects.toThrow('The base variation cannot be deleted')
    const v = await h['characters:addVariation']({ projectId, characterId: c.id, input: { name: 'Pose', kind: 'pose', delta: 'x' }, generate: false })
    await h['characters:deleteVariation']({ projectId, characterId: c.id, variationId: v.id })
    expect((await s.characters.get(ctx, c.id)).variations).toHaveLength(1)

    await h['characters:delete']({ projectId, characterId: c.id })
    expect(s.trashed).toContain(ctx.paths.characterFile(c.id))
  })

  describe('characters:uploadVariationImage', () => {
    async function files() {
      tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'char upload '))
      const jpeg = path.join(tmp, 'Hero Shot.JPEG')
      const second = path.join(tmp, 'other.png')
      const text = path.join(tmp, 'notes.txt')
      await fs.promises.writeFile(jpeg, Buffer.from([1, 2, 3]))
      await fs.promises.writeFile(second, Buffer.from([4, 5]))
      await fs.promises.writeFile(text, 'x')
      return { jpeg, second, text }
    }

    it('stores the first picked file as the variation image and asks the picker for a single file', async () => {
      const f = await files()
      const picker = vi.fn<PickFiles>(async () => [f.jpeg, f.second])
      const { s, h, projectId, ctx } = await setup(picker)
      const c = await s.characters.create(ctx, mina, 'user')
      const event = { sender: 'window' }
      const v = await h['characters:uploadVariationImage']({ projectId, characterId: c.id, variationId: c.variations[0].id }, event)
      expect(picker).toHaveBeenCalledWith(event, expect.objectContaining({ multiple: false }))
      expect(v).toMatchObject({ status: 'ready', error: null, imagePath: expect.stringMatching(/^characters\/chr_[0-9a-f]{10}\/var_[0-9a-f]{10}_[0-9a-f]{6}\.jpg$/) })
      expect([...fs.readFileSync(ctx.paths.resolveAsset(v!.imagePath!))]).toEqual([1, 2, 3])
      expect((await s.characters.get(ctx, c.id)).variations[0].imagePath).toBe(v!.imagePath)
    })

    it('returns null and changes nothing when the dialog is cancelled', async () => {
      const { s, h, projectId, ctx } = await setup(async () => [])
      const c = await s.characters.create(ctx, mina, 'user')
      expect(await h['characters:uploadVariationImage']({ projectId, characterId: c.id, variationId: c.variations[0].id })).toBeNull()
      expect((await s.characters.get(ctx, c.id)).variations[0]).toMatchObject({ status: 'pending', imagePath: null })
    })

    it('rejects an unsupported file type and leaves the variation untouched', async () => {
      const f = await files()
      const { s, h, projectId, ctx } = await setup(async () => [f.text])
      const c = await s.characters.create(ctx, mina, 'user')
      await expect(h['characters:uploadVariationImage']({ projectId, characterId: c.id, variationId: c.variations[0].id })).rejects.toThrow(/png, jpg or webp/)
      expect((await s.characters.get(ctx, c.id)).variations[0]).toMatchObject({ status: 'pending', imagePath: null })
    })

    it('rejects unknown ids before opening the dialog', async () => {
      const picker = vi.fn<PickFiles>(async () => [])
      const { s, h, projectId, ctx } = await setup(picker)
      const c = await s.characters.create(ctx, mina, 'user')
      await expect(h['characters:uploadVariationImage']({ projectId, characterId: c.id, variationId: 'var_ffffffffff' })).rejects.toThrow('Unknown variation: var_ffffffffff')
      await expect(h['characters:uploadVariationImage']({ projectId, characterId: 'chr_ffffffffff', variationId: c.variations[0].id })).rejects.toThrow('Unknown character: chr_ffffffffff')
      expect(picker).not.toHaveBeenCalled()
    })
  })
})
