import fs from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeJsonAtomic } from '../storage/atomic'
import { ProviderError } from '../models/providers/types'
import { encodeSolidPng } from '../models/providers/png'
import { makeItem, makeItemUsage } from '../test/factories'
import { tempProject, type TempProject } from '../test/temp-project'
import type { ImageGenRequest, ImageService } from './image-service'
import { DuplicateItemError, DuplicateUsageError, ItemInUseError, ItemService, type ItemUsageLookup } from './item-service'
import { itemReferencePrompt } from './prompts'

// Failure injection: while `disk.failJsonWrites > 0`, that many writeJsonAtomic calls reject.
const disk = vi.hoisted(() => ({ failJsonWrites: 0 }))
vi.mock('../storage/atomic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storage/atomic')>()
  return {
    ...actual,
    writeJsonAtomic: async (path: string, value: unknown) => {
      if (disk.failJsonWrites > 0) {
        disk.failJsonWrites--
        throw new Error('disk full')
      }
      return actual.writeJsonAtomic(path, value)
    }
  }
})

const input = (name = 'Kestrel blaster') => ({ name, appearanceLock: 'LOCK' })
const PNG = encodeSolidPng(2, 3, [1, 2, 3])

let tp: TempProject | undefined
afterEach(async () => {
  disk.failJsonWrites = 0
  await tp?.cleanup()
  tp = undefined
})

type Gen = (req: ImageGenRequest) => Promise<{ data: Buffer; ext: 'png' | 'jpg' | 'webp' }>

async function setup(gen: Gen = async () => ({ data: PNG, ext: 'png' }), used: string[] = []) {
  const t = await tempProject()
  tp = t
  const calls: ImageGenRequest[] = []
  const images = {
    generate: (_c: unknown, req: ImageGenRequest) => {
      calls.push(req)
      return gen(req)
    }
  } as unknown as ImageService
  const trashed: string[] = []
  const usage: ItemUsageLookup = { panelsUsingItem: async () => used, panelsUsingItemUsage: async () => used }
  const svc = new ItemService({ bus: t.bus, images, projects: t.store, usage, trash: async (p) => void trashed.push(p) })
  return { svc, calls, trashed, ctx: t.ctx, events: t.events, store: t.store }
}

describe('ItemService', () => {
  it('creates an item with a pending At rest usage and generates it from the lock alone', async () => {
    const { svc, calls, ctx, events, store } = await setup()
    events.length = 0
    const item = await svc.create(ctx, input(), 'user')
    expect(item.id).toMatch(/^itm_[0-9a-f]{10}$/)
    expect(item.usages).toMatchObject([{ kind: 'base', name: 'At rest', delta: '', status: 'pending', imagePath: null, itemId: item.id }])
    expect(events).toContainEqual({ type: 'item.changed', projectId: ctx.id, itemId: item.id })

    const usage = await svc.generateUsageImage(ctx, item.id, item.usages[0].id)
    expect(usage.status).toBe('ready')
    expect(usage.imagePath).toMatch(new RegExp(`^items/${item.id}/${item.usages[0].id}_[0-9a-f]{6}\\.png$`))
    expect(fs.existsSync(ctx.paths.resolveAsset(usage.imagePath!))).toBe(true)
    expect(calls[0].prompt).toBe(itemReferencePrompt(item, (await store.getMeta(ctx)).stylePreset))
    expect(calls[0].references).toEqual([])
    expect(calls[0].aspect).toBe('1:1')
    expect((await svc.get(ctx, item.id)).usages[0].status).toBe('ready')
  })

  it('records an item created without a generation as failed, not pending (Ruling F4)', async () => {
    const { svc, ctx, calls } = await setup()
    const item = await svc.create(ctx, input(), 'ai', { generate: false })
    expect(item.usages[0]).toMatchObject({ status: 'failed', error: 'No image yet: upload one or regenerate', imagePath: null })
    const u = await svc.addUsage(ctx, item.id, { name: 'Firing', kind: 'action', delta: 'x' }, 'ai', { generate: false })
    expect(u).toMatchObject({ status: 'failed', error: 'No image yet: upload one or regenerate' })
    expect((await svc.addUsage(ctx, item.id, { name: 'Folded', kind: 'state', delta: 'y' }, 'ai')).status).toBe('pending')
    expect(calls).toEqual([])
  })

  it('generates an action usage from the base image', async () => {
    const { svc, calls, ctx } = await setup()
    const item = await svc.create(ctx, input(), 'user')
    const base = await svc.generateUsageImage(ctx, item.id, item.usages[0].id)
    const added = await svc.addUsage(ctx, item.id, { name: 'Firing', kind: 'action', delta: 'both hands, right index finger on the trigger' }, 'ai')
    expect(added).toMatchObject({ status: 'pending', kind: 'action', itemId: item.id })
    const out = await svc.generateUsageImage(ctx, item.id, added.id)
    expect(out.status).toBe('ready')
    expect(calls[1].references).toEqual([{ relPath: base.imagePath, label: 'item base reference' }])
    expect(calls[1].aspect).toBe('1:1')
    expect(calls[1].prompt).toContain('Show only plain gray hands')
    expect(calls[1].prompt).toContain('Usage: Firing — both hands, right index finger on the trigger')
  })

  it('refuses a duplicate usage name, case-insensitively', async () => {
    const { svc, ctx } = await setup()
    const item = await svc.create(ctx, input(), 'user')
    await svc.addUsage(ctx, item.id, { name: 'Firing', kind: 'action', delta: 'x' }, 'user')
    const dup = svc.addUsage(ctx, item.id, { name: ' firing ', kind: 'action', delta: 'y' }, 'user')
    await expect(dup).rejects.toBeInstanceOf(DuplicateUsageError)
    await expect(dup).rejects.toThrow('Kestrel blaster already has a usage named "Firing": use that one')
    await expect(svc.addUsage(ctx, item.id, { name: 'AT REST', kind: 'state', delta: 'y' }, 'user')).rejects.toBeInstanceOf(DuplicateUsageError)
    expect((await svc.get(ctx, item.id)).usages).toHaveLength(2)
  })

  it('serializes concurrent adds of the same usage name', async () => {
    const { svc, ctx } = await setup()
    const item = await svc.create(ctx, input(), 'user')
    const results = await Promise.allSettled([
      svc.addUsage(ctx, item.id, { name: 'Firing', kind: 'action', delta: 'x' }, 'ai'),
      svc.addUsage(ctx, item.id, { name: 'firing', kind: 'action', delta: 'y' }, 'ai')
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(DuplicateUsageError)
    expect((await svc.get(ctx, item.id)).usages).toHaveLength(2)
  })

  it('fails a usage whose base is not ready, keeping no image', async () => {
    const { svc, calls, ctx } = await setup()
    const item = await svc.create(ctx, input(), 'user')
    const u = await svc.addUsage(ctx, item.id, { name: 'Firing', kind: 'action', delta: 'x' }, 'user')
    const out = await svc.generateUsageImage(ctx, item.id, u.id)
    expect(out).toMatchObject({ status: 'failed', error: 'Base reference image is not ready', imagePath: null })
    expect(calls).toHaveLength(0)
  })

  it('keeps the previous image when regeneration fails', async () => {
    let fail = false
    const { svc, ctx } = await setup(async () => {
      if (fail) throw new ProviderError('unknown', 'boom')
      return { data: PNG, ext: 'png' }
    })
    const item = await svc.create(ctx, input(), 'user')
    const first = await svc.generateUsageImage(ctx, item.id, item.usages[0].id)
    fail = true
    const out = await svc.generateUsageImage(ctx, item.id, item.usages[0].id)
    expect(out).toMatchObject({ status: 'failed', error: 'boom', imagePath: first.imagePath })
    expect((await svc.get(ctx, item.id)).usages[0]).toMatchObject({ status: 'failed', error: 'boom', imagePath: first.imagePath })
    expect(fs.existsSync(ctx.paths.resolveAsset(first.imagePath!))).toBe(true)
  })

  it('shows pending while generating and does not hold the lock across the image call (Ruling T15a)', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const { svc, ctx } = await setup(async () => {
      await gate
      return { data: PNG, ext: 'png' }
    })
    // `generate: false` starts the usage `failed`, so `pending` below can only come from the generation itself.
    const item = await svc.create(ctx, input(), 'user', { generate: false })
    expect(item.usages[0].status).toBe('failed')
    const running = svc.generateUsageImage(ctx, item.id, item.usages[0].id)
    // The pending write is disk I/O; wait for it rather than a fixed delay, which is too short on a loaded machine.
    await vi.waitFor(async () => expect((await svc.get(ctx, item.id)).usages[0].status).toBe('pending'), { timeout: 4000, interval: 10 })
    await svc.update(ctx, item.id, { notes: 'edited meanwhile' })
    release()
    expect((await running).status).toBe('ready')
    expect((await svc.get(ctx, item.id)).notes).toBe('edited meanwhile')
  })

  it('an aborted generation ends failed Cancelled', async () => {
    const { svc, ctx } = await setup(async () => {
      const e = new Error('x')
      e.name = 'AbortError'
      throw e
    })
    const item = await svc.create(ctx, input(), 'user')
    const out = await svc.generateUsageImage(ctx, item.id, item.usages[0].id, { signal: new AbortController().signal })
    expect(out).toMatchObject({ status: 'failed', error: 'Cancelled' })
  })

  it('refuses to delete an item or a usage that panels use', async () => {
    const { svc, ctx, trashed } = await setup(undefined, ['pnl_1'])
    const item = await svc.create(ctx, input(), 'user')
    await expect(svc.delete(ctx, item.id)).rejects.toMatchObject({ name: 'ItemInUseError', panelIds: ['pnl_1'] })
    await expect(svc.delete(ctx, item.id)).rejects.toThrow('This item is used by 1 panel(s): pnl_1. Archive it instead.')
    const u = await svc.addUsage(ctx, item.id, { name: 'Firing', kind: 'action', delta: 'x' }, 'user')
    await expect(svc.deleteUsage(ctx, item.id, u.id)).rejects.toBeInstanceOf(ItemInUseError)
    await expect(svc.deleteUsage(ctx, item.id, u.id)).rejects.toThrow(/This usage is used by/)
    expect(trashed).toEqual([])
    expect((await svc.get(ctx, item.id)).usages).toHaveLength(2)
    await svc.archive(ctx, item.id)
    expect((await svc.list(ctx)).map((x) => x.id)).toEqual([])
    expect((await svc.list(ctx, { includeArchived: true })).map((x) => x.id)).toEqual([item.id])
  })

  it('deletes an unused item to the trash', async () => {
    const { svc, ctx, trashed } = await setup()
    const item = await svc.create(ctx, input(), 'user')
    await svc.generateUsageImage(ctx, item.id, item.usages[0].id)
    await svc.delete(ctx, item.id)
    expect(trashed).toEqual([ctx.paths.itemFile(item.id), ctx.paths.itemDir(item.id)])
  })

  it('refuses to delete the base usage', async () => {
    const { svc, ctx } = await setup()
    const item = await svc.create(ctx, input(), 'user')
    await expect(svc.deleteUsage(ctx, item.id, item.usages[0].id)).rejects.toThrow(/base/i)
    const u = await svc.addUsage(ctx, item.id, { name: 'Firing', kind: 'action', delta: 'x' }, 'user')
    await svc.deleteUsage(ctx, item.id, u.id)
    expect((await svc.get(ctx, item.id)).usages).toHaveLength(1)
  })

  it("trashes a deleted usage's image only when it lies in the item's own folder (I4)", async () => {
    const { svc, ctx, trashed } = await setup()
    const item = await svc.create(ctx, input(), 'user')
    const other = await svc.create(ctx, input('Zed lantern'), 'user')
    const files = [`items/${item.id}/own.png`, `items/${other.id}/theirs.png`, 'uploads/shared.png']
    for (const rel of files) {
      fs.mkdirSync(ctx.paths.resolveAsset(rel.split('/').slice(0, -1).join('/')), { recursive: true })
      fs.writeFileSync(ctx.paths.resolveAsset(rel), PNG)
    }
    // A hand-edited file can point a usage anywhere in the project, the project folder itself included.
    const hostile = [...files, 'items', `items/${item.id}/..`, 'items/..']
    const us = hostile.map((imagePath, i) => ({ ...makeItemUsage({ itemId: item.id, kind: 'state', name: `U${i}`, status: 'ready' }), id: `use_00000000a${i}`, imagePath }))
    await writeJsonAtomic(ctx.paths.itemFile(item.id), { ...(await svc.get(ctx, item.id)), usages: [item.usages[0], ...us] })
    for (const u of us) await svc.deleteUsage(ctx, item.id, u.id)
    expect(trashed).toEqual([ctx.paths.resolveAsset(files[0])])
    expect((await svc.get(ctx, item.id)).usages.map((u) => u.id)).toEqual([item.usages[0].id])
  })

  it('refuses a duplicate item name and allows it once the other is archived', async () => {
    const { svc, ctx } = await setup()
    const a = await svc.create(ctx, input('Kestrel blaster'), 'user')
    await expect(svc.create(ctx, input(' kestrel BLASTER '), 'user')).rejects.toBeInstanceOf(DuplicateItemError)
    await expect(svc.create(ctx, input('kestrel blaster'), 'user')).rejects.toThrow('An item named "kestrel blaster" already exists')
    await svc.archive(ctx, a.id)
    const b = await svc.create(ctx, input('kestrel blaster'), 'user')
    // Unarchiving would now clash with the active one, and a rename must stay unique too.
    await expect(svc.unarchive(ctx, a.id)).rejects.toBeInstanceOf(DuplicateItemError)
    await svc.create(ctx, input('Other'), 'user')
    await expect(svc.update(ctx, b.id, { name: 'OTHER' })).rejects.toBeInstanceOf(DuplicateItemError)
  })

  it('serializes concurrent creates of the same name', async () => {
    const { svc, ctx } = await setup()
    const results = await Promise.allSettled([svc.create(ctx, input('Lamp'), 'user'), svc.create(ctx, input('lamp'), 'user')])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(DuplicateItemError)
    expect(await svc.list(ctx)).toHaveLength(1)
  })

  it('updates fields, clears the owner with null, and flags lock changes', async () => {
    const { svc, ctx } = await setup()
    const item = await svc.create(ctx, { ...input(), ownerId: 'chr_aaaaaaaaaa', aliases: ['blaster'] }, 'user')
    expect(item).toMatchObject({ ownerId: 'chr_aaaaaaaaaa', aliases: ['blaster'], notes: '' })
    const kept = await svc.update(ctx, item.id, { notes: 'n' })
    expect(kept.item).toMatchObject({ ownerId: 'chr_aaaaaaaaaa', notes: 'n' })
    expect(kept.appearanceLockChanged).toBe(false)
    expect((await svc.update(ctx, item.id, { ownerId: null })).item.ownerId).toBeNull()
    expect((await svc.update(ctx, item.id, { appearanceLock: 'NEW' })).appearanceLockChanged).toBe(true)
    expect((await svc.update(ctx, item.id, { appearanceLock: 'NEW' })).appearanceLockChanged).toBe(false)
  })

  it('uploads an image and validates the extension', async () => {
    const { svc, ctx } = await setup()
    const item = await svc.create(ctx, input(), 'user')
    const u = await svc.uploadUsageImage(ctx, item.id, item.usages[0].id, PNG, 'png')
    expect(u.status).toBe('ready')
    expect(fs.readFileSync(ctx.paths.resolveAsset(u.imagePath!)).equals(PNG)).toBe(true)
    await expect(svc.uploadUsageImage(ctx, item.id, item.usages[0].id, PNG, 'gif' as 'png')).rejects.toThrow(/extension/i)
  })

  it('recovers interrupted generations', async () => {
    const { svc, ctx } = await setup()
    const item = makeItem({ id: 'itm_aaaaaaaaaa', usages: [makeItemUsage({ itemId: 'itm_aaaaaaaaaa', status: 'pending' })] })
    await writeJsonAtomic(ctx.paths.itemFile(item.id), item)
    await svc.recoverInterrupted(ctx)
    expect((await svc.get(ctx, item.id)).usages[0]).toMatchObject({ status: 'failed', error: 'Interrupted: the app closed during generation' })
  })

  it('fails pending usages on recoverInterrupted', async () => {
    const { svc, ctx } = await setup()
    const item = await svc.create(ctx, input(), 'user')
    await svc.addUsage(ctx, item.id, { name: 'Firing', kind: 'action', delta: 'x' }, 'user')
    await svc.recoverInterrupted(ctx)
    expect((await svc.get(ctx, item.id)).usages.map((u) => [u.status, u.error])).toEqual([
      ['failed', 'Interrupted: the app closed during generation'],
      ['failed', 'Interrupted: the app closed during generation']
    ])
  })

  it('skips and reports a corrupt item file (Review Focus 5)', async () => {
    const { svc, ctx } = await setup()
    const item = await svc.create(ctx, input(), 'user')
    await fs.promises.writeFile(ctx.paths.itemFile('itm_ffffffffff'), '{oops')
    expect((await svc.list(ctx)).map((x) => x.id)).toEqual([item.id])
    expect(ctx.problems.map((p) => p.path)).toContain('items/itm_ffffffffff.json')
  })

  it('reports an item file whose id does not match its name in ctx.problems and skips it', async () => {
    const { svc, ctx } = await setup()
    const good = makeItem({ id: 'itm_bbbbbbbbbb', name: 'Bee' })
    await writeJsonAtomic(ctx.paths.itemFile('itm_aaaaaaaaaa'), good)
    await writeJsonAtomic(ctx.paths.itemFile('itm_bbbbbbbbbb'), good)
    await writeJsonAtomic(ctx.paths.itemFile('itm_cccccccccc'), { ...good, id: '../escape' })
    expect((await svc.list(ctx, { includeArchived: true })).map((i) => i.id)).toEqual(['itm_bbbbbbbbbb'])
    await expect(svc.get(ctx, 'itm_aaaaaaaaaa')).rejects.toThrow(/does not match its file name/)
    expect(ctx.problems.map((p) => p.path).sort()).toEqual(['items/itm_aaaaaaaaaa.json', 'items/itm_cccccccccc.json'])
    expect(ctx.problems[0].message).toMatch(/does not match its file name/)
  })
})

describe('ItemService recording failures', () => {
  const imagesIn = (ctx: { paths: { itemDir(id: string): string } }, id: string): string[] => {
    try {
      return fs.readdirSync(ctx.paths.itemDir(id))
    } catch {
      return []
    }
  }

  it('records failed and removes the orphan image when the success write fails', async () => {
    const { svc, ctx } = await setup(async () => {
      disk.failJsonWrites = 1
      return { data: PNG, ext: 'png' }
    })
    const item = await svc.create(ctx, input(), 'user')
    const out = await svc.generateUsageImage(ctx, item.id, item.usages[0].id)
    expect(out).toMatchObject({ status: 'failed', error: 'disk full' })
    expect((await svc.get(ctx, item.id)).usages[0]).toMatchObject({ status: 'failed', error: 'disk full', imagePath: null })
    expect(imagesIn(ctx, item.id)).toEqual([])
  })

  it('resolves failed, never throws, and leaves recoverInterrupted as backstop when every write fails', async () => {
    const { svc, ctx } = await setup(async () => {
      disk.failJsonWrites = 2
      return { data: PNG, ext: 'png' }
    })
    const item = await svc.create(ctx, input(), 'user')
    const out = await svc.generateUsageImage(ctx, item.id, item.usages[0].id)
    expect(out).toMatchObject({ status: 'failed', error: 'disk full' })
    expect(imagesIn(ctx, item.id)).toEqual([])
    expect((await svc.get(ctx, item.id)).usages[0].status).toBe('pending')
    await svc.recoverInterrupted(ctx)
    expect((await svc.get(ctx, item.id)).usages[0]).toMatchObject({ status: 'failed', error: 'Interrupted: the app closed during generation' })
  })

  it('resolves failed and leaves a file corrupted mid-generation alone', async () => {
    let file = ''
    const { svc, ctx } = await setup(async () => {
      await fs.promises.writeFile(file, '{oops')
      return { data: PNG, ext: 'png' }
    })
    const item = await svc.create(ctx, input(), 'user')
    file = ctx.paths.itemFile(item.id)
    const out = await svc.generateUsageImage(ctx, item.id, item.usages[0].id)
    expect(out.status).toBe('failed')
    expect(out.error).toMatch(/corrupt/i)
    expect(fs.readFileSync(file, 'utf8')).toBe('{oops')
    expect(imagesIn(ctx, item.id)).toEqual([])
  })

  it('reports Usage was deleted when the usage is removed mid-generation', async () => {
    let drop: () => Promise<void> = async () => undefined
    const { svc, ctx } = await setup(async () => {
      await drop()
      return { data: PNG, ext: 'png' }
    })
    const item = await svc.create(ctx, input(), 'user')
    await svc.generateUsageImage(ctx, item.id, item.usages[0].id)
    const u = await svc.addUsage(ctx, item.id, { name: 'Firing', kind: 'action', delta: 'x' }, 'user')
    drop = () => svc.deleteUsage(ctx, item.id, u.id)
    const out = await svc.generateUsageImage(ctx, item.id, u.id)
    expect(out).toMatchObject({ id: u.id, status: 'failed', error: 'Usage was deleted' })
    expect((await svc.get(ctx, item.id)).usages).toHaveLength(1)
    expect(imagesIn(ctx, item.id)).toHaveLength(1)
  })

  it('reports Usage was deleted when the item is removed mid-generation', async () => {
    let file = ''
    const { svc, ctx } = await setup(async () => {
      await fs.promises.rm(file)
      return { data: PNG, ext: 'png' }
    })
    const item = await svc.create(ctx, input(), 'user')
    file = ctx.paths.itemFile(item.id)
    expect(await svc.generateUsageImage(ctx, item.id, item.usages[0].id)).toMatchObject({ status: 'failed', error: 'Usage was deleted' })
    expect(imagesIn(ctx, item.id)).toEqual([])
  })

  it('upload never marks pending and leaves the usage untouched when recording fails', async () => {
    const { svc, ctx } = await setup()
    const item = await svc.create(ctx, input(), 'user')
    const ready = await svc.generateUsageImage(ctx, item.id, item.usages[0].id)
    disk.failJsonWrites = 1
    await expect(svc.uploadUsageImage(ctx, item.id, item.usages[0].id, PNG, 'jpg')).rejects.toThrow('disk full')
    expect((await svc.get(ctx, item.id)).usages[0]).toMatchObject({ status: 'ready', imagePath: ready.imagePath })
    expect(imagesIn(ctx, item.id)).toHaveLength(1)
  })

  it('recoverInterrupted skips a corrupt file, reports it, and still recovers the others', async () => {
    const { svc, ctx } = await setup()
    const item = makeItem({ id: 'itm_aaaaaaaaaa', usages: [makeItemUsage({ itemId: 'itm_aaaaaaaaaa', status: 'pending' })] })
    await writeJsonAtomic(ctx.paths.itemFile(item.id), item)
    await fs.promises.writeFile(ctx.paths.itemFile('itm_ffffffffff'), '{oops')
    await expect(svc.recoverInterrupted(ctx)).resolves.toBeUndefined()
    expect((await svc.get(ctx, item.id)).usages[0].status).toBe('failed')
    expect(ctx.problems.map((p) => p.path)).toContain('items/itm_ffffffffff.json')
  })

  it('recoverInterrupted skips a file that holds another valid id instead of rewriting the wrong file (Ruling T18f)', async () => {
    const { svc, ctx } = await setup()
    const pending = makeItem({ id: 'itm_bbbbbbbbbb', name: 'Bee', usages: [makeItemUsage({ id: 'use_bbbbbbbbbb', itemId: 'itm_bbbbbbbbbb', status: 'pending' })] })
    await writeJsonAtomic(ctx.paths.itemFile('itm_aaaaaaaaaa'), pending)
    await writeJsonAtomic(ctx.paths.itemFile('itm_bbbbbbbbbb'), pending)
    await expect(svc.recoverInterrupted(ctx)).resolves.toBeUndefined()
    expect((await svc.get(ctx, 'itm_bbbbbbbbbb')).usages[0].status).toBe('failed')
    expect(JSON.parse(fs.readFileSync(ctx.paths.itemFile('itm_aaaaaaaaaa'), 'utf8')).usages[0].status).toBe('pending')
    expect(ctx.problems.map((p) => p.path)).toEqual(['items/itm_aaaaaaaaaa.json'])
  })

  it('recoverInterrupted keeps going when one item cannot be rewritten', async () => {
    const { svc, ctx } = await setup()
    const mk = (id: string) => makeItem({ id, name: id, usages: [makeItemUsage({ itemId: id, status: 'pending' })] })
    await writeJsonAtomic(ctx.paths.itemFile('itm_aaaaaaaaaa'), mk('itm_aaaaaaaaaa'))
    await writeJsonAtomic(ctx.paths.itemFile('itm_bbbbbbbbbb'), mk('itm_bbbbbbbbbb'))
    disk.failJsonWrites = 1
    await expect(svc.recoverInterrupted(ctx)).resolves.toBeUndefined()
    const states = [(await svc.get(ctx, 'itm_aaaaaaaaaa')).usages[0].status, (await svc.get(ctx, 'itm_bbbbbbbbbb')).usages[0].status]
    expect(states.sort()).toEqual(['failed', 'pending'])
    expect(ctx.problems).toHaveLength(1)
  })
})
