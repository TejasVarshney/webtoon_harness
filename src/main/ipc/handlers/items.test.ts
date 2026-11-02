import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Item } from '@shared/types'
import { encodeSolidPng } from '../../models/providers/png'
import { testServices, type TestServices } from '../../test/test-services'
import { itemsHandlers } from './items'
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
const NO_IMAGE_YET = 'No image yet: upload one or regenerate'
const rifle = { name: 'Rifle', appearanceLock: 'LOCK' }

async function setup(pickFiles?: PickFiles) {
  s = await testServices()
  const ctx = await s.projects.create({ title: 'Moon Diary' })
  // The first open runs the onOpen hooks (interrupted-generation recovery), so do it before any test data exists.
  await s.projects.open(ctx.id)
  const h: Required<HandlerMap> = itemsHandlers(s, { pickFiles }) as Required<HandlerMap>
  const projectId = ctx.id
  const svc = s.items
  const get = (id: string): Promise<Item> => svc.get(ctx, id)
  /**
   * Fire-and-forget generation must finish before cleanup removes the project folder. Polls gently: on Windows a
   * rename cannot replace a file that a reader has open at that instant, so a tight poll would starve the writer.
   */
  async function settled(id: string, usageId: string): Promise<Item> {
    const t0 = Date.now()
    for (;;) {
      const i = await get(id)
      if (i.usages.find((u) => u.id === usageId)?.status !== 'pending') return i
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

describe('items IPC handlers', () => {
  it('create returns at once with a pending base and generates it in the background', async () => {
    const { s, h, projectId, get, settled } = await setup()
    const { release, spy } = gateImages(s)
    const created = await h['items:create']({ projectId, input: rifle, generateBase: true })
    expect(created).toMatchObject({ name: 'Rifle', createdBy: 'user', usages: [{ kind: 'base', status: 'pending' }] })
    expect((await get(created.id)).usages[0].status).toBe('pending')
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    release()
    const done = await settled(created.id, created.usages[0].id)
    expect(done.usages[0]).toMatchObject({ status: 'ready', error: null, imagePath: expect.stringMatching(/\.png$/) })
  })

  it('create without generateBase makes no image call and records the base failed', async () => {
    const { s, h, projectId, get } = await setup()
    const spy = vi.spyOn(s.images, 'generate')
    const created = await h['items:create']({ projectId, input: rifle, generateBase: false })
    await new Promise((r) => setTimeout(r, 20))
    expect(spy).not.toHaveBeenCalled()
    expect(created.usages[0]).toMatchObject({ status: 'failed', error: NO_IMAGE_YET })
    expect((await get(created.id)).usages[0]).toMatchObject({ status: 'failed', error: NO_IMAGE_YET })
  })

  it('a missing generate flag from the renderer never leaves a usage pending', async () => {
    const { h, projectId, get } = await setup()
    const created = await h['items:create']({ projectId, input: rifle } as never)
    expect((await get(created.id)).usages[0]).toMatchObject({ status: 'failed', error: NO_IMAGE_YET })
    const added = await h['items:addUsage']({ projectId, itemId: created.id, input: { name: 'Firing', kind: 'action', delta: 'muzzle flash' } } as never)
    expect(added).toMatchObject({ status: 'failed', error: NO_IMAGE_YET })
  })

  it('create rejects bad input and duplicate names', async () => {
    const { h, projectId, settled } = await setup()
    await expect(h['items:create']({ projectId, input: { ...rifle, appearanceLock: 5 } as never, generateBase: false })).rejects.toThrow()
    const first = await h['items:create']({ projectId, input: rifle, generateBase: true })
    await expect(h['items:create']({ projectId, input: { ...rifle, name: 'rifle' }, generateBase: true })).rejects.toThrow('An item named "rifle" already exists')
    await settled(first.id, first.usages[0].id)
  })

  it('a failed background generation ends failed with the message and logs nothing', async () => {
    const { s, h, projectId, settled } = await setup()
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await s.registry.assignRole('image', null)
    const created = await h['items:create']({ projectId, input: rifle, generateBase: true })
    const done = await settled(created.id, created.usages[0].id)
    expect(done.usages[0]).toMatchObject({ status: 'failed', error: expect.stringContaining("No model assigned to role 'image'") })
    expect(log).not.toHaveBeenCalled()
  })

  it('logs, and does not reject, when the background task itself throws', async () => {
    const { s, h, projectId } = await setup()
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(s.items, 'generateUsageImage').mockRejectedValue(new Error('disk gone'))
    const created = await h['items:create']({ projectId, input: rifle, generateBase: true })
    await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(1))
    expect(log.mock.calls[0].join(' ')).toContain('disk gone')
    expect(created.name).toBe('Rifle')
  })

  it('addUsage returns a pending usage and generates it; kind base is refused', async () => {
    const { s, h, projectId, get, settled } = await setup()
    const i = await s.items.create(await s.projects.open(projectId), rifle, 'user')
    const base = await h['items:generateUsage']({ projectId, itemId: i.id, usageId: i.usages[0].id })
    expect(base.status).toBe('pending')
    await settled(i.id, base.id)

    const { release } = gateImages(s)
    const u = await h['items:addUsage']({ projectId, itemId: i.id, input: { name: 'Firing', kind: 'action', delta: 'muzzle flash' }, generate: true })
    expect(u).toMatchObject({ status: 'pending', kind: 'action', createdBy: 'user' })
    expect((await get(i.id)).usages).toHaveLength(2)
    release()
    expect((await settled(i.id, u.id)).usages[1]).toMatchObject({ status: 'ready' })

    await expect(h['items:addUsage']({ projectId, itemId: i.id, input: { name: 'B', kind: 'base', delta: '' } as never, generate: false })).rejects.toThrow()
    expect((await get(i.id)).usages).toHaveLength(2)
  })

  it('addUsage without generate makes no image call and records the usage failed', async () => {
    const { s, h, projectId } = await setup()
    const i = await s.items.create(await s.projects.open(projectId), rifle, 'user')
    const spy = vi.spyOn(s.images, 'generate')
    const u = await h['items:addUsage']({ projectId, itemId: i.id, input: { name: 'Slung', kind: 'state', delta: 'x' }, generate: false })
    await new Promise((r) => setTimeout(r, 20))
    expect(u).toMatchObject({ status: 'failed', error: NO_IMAGE_YET })
    expect(spy).not.toHaveBeenCalled()
  })

  it('generateUsage starts generation without waiting, and rejects unknown ids up front', async () => {
    const { s, h, projectId, ctx, settled } = await setup()
    const i = await s.items.create(ctx, rifle, 'user')
    const spy = vi.spyOn(s.images, 'generate')
    await expect(h['items:generateUsage']({ projectId, itemId: i.id, usageId: 'use_ffffffffff' })).rejects.toThrow('Unknown usage: use_ffffffffff')
    await expect(h['items:generateUsage']({ projectId, itemId: 'itm_ffffffffff', usageId: i.usages[0].id })).rejects.toThrow('Unknown item: itm_ffffffffff')
    expect(spy).not.toHaveBeenCalled()

    const { release } = gateImages(s)
    const u = await h['items:generateUsage']({ projectId, itemId: i.id, usageId: i.usages[0].id })
    expect(u).toMatchObject({ id: i.usages[0].id, status: 'pending', error: null })
    release()
    expect((await settled(i.id, u.id)).usages[0].status).toBe('ready')
  })

  it('lists, gets, updates, archives and unarchives', async () => {
    const { h, projectId } = await setup()
    const a = await h['items:create']({ projectId, input: rifle, generateBase: false })
    const b = await h['items:create']({ projectId, input: { ...rifle, name: 'Lantern' }, generateBase: false })
    expect((await h['items:list']({ projectId })).map((i) => i.name)).toEqual(['Rifle', 'Lantern'])
    await h['items:archive']({ projectId, itemId: b.id })
    expect((await h['items:list']({ projectId })).map((i) => i.name)).toEqual(['Rifle'])
    expect((await h['items:list']({ projectId, includeArchived: true })).map((i) => i.name)).toEqual(['Rifle', 'Lantern'])
    expect(await h['items:get']({ projectId, itemId: b.id })).toMatchObject({ name: 'Lantern', archived: true })
    await h['items:unarchive']({ projectId, itemId: b.id })
    expect((await h['items:get']({ projectId, itemId: b.id })).archived).toBe(false)

    const updated = await h['items:update']({ projectId, itemId: a.id, patch: { name: 'Old Rifle', notes: 'family heirloom' } })
    expect(updated).toMatchObject({ id: a.id, name: 'Old Rifle', notes: 'family heirloom' })
    await expect(h['items:update']({ projectId, itemId: a.id, patch: { name: 5 } as never })).rejects.toThrow()
    await expect(h['items:update']({ projectId, itemId: a.id, patch: { name: 'lantern' } })).rejects.toThrow('An item named "lantern" already exists')
  })

  it('deletes an item to the trash, refuses while panels use it, and refuses to delete a base usage', async () => {
    const { s, h, projectId, ctx } = await setup()
    const i = await s.items.create(ctx, rifle, 'user')
    await expect(h['items:deleteUsage']({ projectId, itemId: i.id, usageId: i.usages[0].id })).rejects.toThrow('The base usage cannot be deleted')
    const u = await h['items:addUsage']({ projectId, itemId: i.id, input: { name: 'Slung', kind: 'state', delta: 'x' }, generate: false })

    const used = vi.spyOn(s.panels, 'panelsUsingItem').mockResolvedValue(['pnl_1'])
    await expect(h['items:delete']({ projectId, itemId: i.id })).rejects.toThrow('This item is used by 1 panel(s): pnl_1. Archive it instead.')
    expect(s.trashed).not.toContain(ctx.paths.itemFile(i.id))
    used.mockRestore()

    const usedUsage = vi.spyOn(s.panels, 'panelsUsingItemUsage').mockResolvedValue(['pnl_2'])
    await expect(h['items:deleteUsage']({ projectId, itemId: i.id, usageId: u.id })).rejects.toThrow('This usage is used by 1 panel(s): pnl_2. Archive it instead.')
    usedUsage.mockRestore()
    await h['items:deleteUsage']({ projectId, itemId: i.id, usageId: u.id })
    expect((await s.items.get(ctx, i.id)).usages).toHaveLength(1)

    await h['items:delete']({ projectId, itemId: i.id })
    expect(s.trashed).toContain(ctx.paths.itemFile(i.id))
  })

  describe('items:uploadUsageImage', () => {
    async function files() {
      tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'item upload '))
      const jpeg = path.join(tmp, 'Hero Shot.JPEG')
      const second = path.join(tmp, 'other.png')
      const text = path.join(tmp, 'notes.txt')
      await fs.promises.writeFile(jpeg, Buffer.from([1, 2, 3]))
      await fs.promises.writeFile(second, Buffer.from([4, 5]))
      await fs.promises.writeFile(text, 'x')
      return { jpeg, second, text }
    }

    it('stores the first picked file as the usage image and asks the picker for a single file', async () => {
      const f = await files()
      const picker = vi.fn<PickFiles>(async () => [f.jpeg, f.second])
      const { s, h, projectId, ctx } = await setup(picker)
      const i = await s.items.create(ctx, rifle, 'user')
      const event = { sender: 'window' }
      const u = await h['items:uploadUsageImage']({ projectId, itemId: i.id, usageId: i.usages[0].id }, event)
      expect(picker).toHaveBeenCalledWith(event, expect.objectContaining({ multiple: false, title: 'Choose a usage image' }))
      expect(u).toMatchObject({ status: 'ready', error: null, imagePath: expect.stringMatching(/\.jpg$/) })
      expect([...fs.readFileSync(ctx.paths.resolveAsset(u!.imagePath!))]).toEqual([1, 2, 3])
      expect((await s.items.get(ctx, i.id)).usages[0].imagePath).toBe(u!.imagePath)
    })

    it('returns null and changes nothing when the dialog is cancelled', async () => {
      const { s, h, projectId, ctx } = await setup(async () => [])
      const i = await s.items.create(ctx, rifle, 'user')
      expect(await h['items:uploadUsageImage']({ projectId, itemId: i.id, usageId: i.usages[0].id })).toBeNull()
      expect((await s.items.get(ctx, i.id)).usages[0]).toMatchObject({ status: 'pending', imagePath: null })
    })

    it('rejects an unsupported file type and leaves the usage untouched', async () => {
      const f = await files()
      const { s, h, projectId, ctx } = await setup(async () => [f.text])
      const i = await s.items.create(ctx, rifle, 'user')
      await expect(h['items:uploadUsageImage']({ projectId, itemId: i.id, usageId: i.usages[0].id })).rejects.toThrow(/png, jpg or webp/)
      expect((await s.items.get(ctx, i.id)).usages[0]).toMatchObject({ status: 'pending', imagePath: null })
    })

    it('rejects unknown ids before opening the dialog', async () => {
      const picker = vi.fn<PickFiles>(async () => [])
      const { s, h, projectId, ctx } = await setup(picker)
      const i = await s.items.create(ctx, rifle, 'user')
      await expect(h['items:uploadUsageImage']({ projectId, itemId: i.id, usageId: 'use_ffffffffff' })).rejects.toThrow('Unknown usage: use_ffffffffff')
      await expect(h['items:uploadUsageImage']({ projectId, itemId: 'itm_ffffffffff', usageId: i.usages[0].id })).rejects.toThrow('Unknown item: itm_ffffffffff')
      expect(picker).not.toHaveBeenCalled()
    })
  })
})
