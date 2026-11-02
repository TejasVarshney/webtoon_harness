import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { newId } from '@shared/ids'
import { ItemSchema } from '@shared/schemas'
import type { Item, ItemInput, ItemPatch, ItemUsage, ItemUsageInput } from '@shared/types'
import type { EventBus } from '../events/bus'
import { readJson, writeFileAtomic, writeJsonAtomic } from '../storage/atomic'
import { isInside } from '../storage/project-paths'
import type { ProjectContext, ProjectStore } from '../storage/project-store'
import { CorruptFileError, EntityNotFoundError, PathEscapeError } from './errors'
import type { ImageService } from './image-service'
import { itemReferencePrompt, itemUsagePrompt } from './prompts'
import { isNotFound } from '../storage/fs-errors'

type CreatedBy = ItemUsage['createdBy']

export class DuplicateItemError extends Error {
  constructor(readonly itemName: string) {
    super(`An item named "${itemName}" already exists`)
    this.name = 'DuplicateItemError'
  }
}

/** Usage names are unique per item, so a second `Firing` must reuse the first instead of drawing a twin. */
export class DuplicateUsageError extends Error {
  constructor(
    readonly itemName: string,
    readonly usageName: string
  ) {
    super(`${itemName} already has a usage named "${usageName}": use that one`)
    this.name = 'DuplicateUsageError'
  }
}

/** The item (or usage) is used by panels, so it can only be archived, not deleted. */
export class ItemInUseError extends Error {
  constructor(
    readonly panelIds: string[],
    what = 'item'
  ) {
    super(`This ${what} is used by ${panelIds.length} panel(s): ${panelIds.join(', ')}. Archive it instead.`)
    this.name = 'ItemInUseError'
  }
}

/** Which panels attach an item or one of its usages. PanelService answers this once panels can attach items. */
export interface ItemUsageLookup {
  panelsUsingItem(ctx: ProjectContext, itemId: string): Promise<string[]>
  panelsUsingItemUsage(ctx: ProjectContext, usageId: string): Promise<string[]>
}

export interface ItemServiceOptions {
  bus: EventBus
  images: ImageService
  projects: ProjectStore
  usage: ItemUsageLookup
  /** Moves a path to the OS trash. */
  trash: (absPath: string) => Promise<void>
}

const INTERRUPTED = 'Interrupted: the app closed during generation'
/** Ruling F4: a usage created without a generation has nothing that would ever move it out of `pending`. */
export const NO_IMAGE_YET = 'No image yet: upload one or regenerate'

/** `generate: false` means no generation follows, so the new usage is recorded `failed` (Ruling F4). Default true. */
export interface CreateUsageOptions {
  generate?: boolean
}
const UPLOAD_EXTS = ['png', 'jpg', 'webp'] as const
type UploadExt = (typeof UPLOAD_EXTS)[number]
const ITEM_FILE = /^itm_[A-Za-z0-9]+\.json$/

const now = (): string => new Date().toISOString()

/** The state a new usage starts in: `pending` when a generation follows, else failed with `NO_IMAGE_YET`. */
function initialStatus(opts: CreateUsageOptions): Pick<ItemUsage, 'status' | 'error'> {
  return opts.generate === false ? { status: 'failed', error: NO_IMAGE_YET } : { status: 'pending', error: null }
}

export class ItemService {
  constructor(private readonly opts: ItemServiceOptions) {}

  async list(ctx: ProjectContext, opts: { includeArchived?: boolean } = {}): Promise<Item[]> {
    let names: string[]
    try {
      names = await fs.promises.readdir(ctx.paths.itemsDir())
    } catch (error) {
      if (isNotFound(error)) return []
      throw error
    }
    const out: Item[] = []
    for (const name of names) {
      if (!ITEM_FILE.test(name)) continue
      const abs = path.join(ctx.paths.itemsDir(), name)
      try {
        // Ruling T18f: the id comes from the file name; a file holding any other id is reported and skipped.
        out.push(await readItemFile(abs, name.slice(0, -'.json'.length)))
      } catch (error) {
        if (isNotFound(error)) continue
        const rel = ctx.paths.toRelative(abs)
        if (!ctx.problems.some((p) => p.path === rel)) ctx.problems.push({ path: rel, message: error instanceof Error ? error.message : String(error) })
      }
    }
    out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))
    return opts.includeArchived ? out : out.filter((i) => !i.archived)
  }

  async get(ctx: ProjectContext, id: string): Promise<Item> {
    try {
      return await readItemFile(ctx.paths.itemFile(id), id)
    } catch (error) {
      if (isNotFound(error)) throw new EntityNotFoundError('item', id)
      throw error
    }
  }

  async create(ctx: ProjectContext, input: ItemInput, createdBy: CreatedBy, opts: CreateUsageOptions = {}): Promise<Item> {
    // The name check and the write share one lock so two concurrent creates cannot both pass it.
    const item = await ctx.mutex.run(ctx.paths.itemsDir(), async () => {
      await this.assertNameFree(ctx, input.name)
      const id = newId('itm')
      const at = now()
      const i = ItemSchema.parse({
        id,
        name: input.name,
        aliases: input.aliases,
        ownerId: input.ownerId,
        notes: input.notes,
        appearanceLock: input.appearanceLock,
        usages: [{ id: newId('use'), itemId: id, name: 'At rest', kind: 'base', delta: '', imagePath: null, ...initialStatus(opts), createdBy, createdAt: at }],
        archived: false,
        createdBy,
        createdAt: at,
        updatedAt: at
      })
      await ctx.mutex.run(ctx.paths.itemFile(id), () => writeJsonAtomic(ctx.paths.itemFile(id), i))
      return i
    })
    this.emit(ctx, item.id)
    return item
  }

  async update(ctx: ProjectContext, id: string, patch: ItemPatch): Promise<{ item: Item; appearanceLockChanged: boolean }> {
    const run = () =>
      this.mutate(ctx, id, (i) => {
        const next: Item = {
          ...i,
          name: patch.name ?? i.name,
          aliases: patch.aliases ?? i.aliases,
          // `null` clears the owner, so only `undefined` means "leave it".
          ownerId: patch.ownerId === undefined ? i.ownerId : patch.ownerId,
          notes: patch.notes ?? i.notes,
          appearanceLock: patch.appearanceLock ?? i.appearanceLock,
          updatedAt: now()
        }
        return { item: ItemSchema.parse(next), appearanceLockChanged: next.appearanceLock !== i.appearanceLock }
      })
    // A rename must stay unique, so it takes the same lock `create` uses.
    if (patch.name === undefined) return run()
    const name = patch.name
    return ctx.mutex.run(ctx.paths.itemsDir(), async () => {
      await this.assertNameFree(ctx, name, id)
      return run()
    })
  }

  async archive(ctx: ProjectContext, id: string): Promise<void> {
    await this.mutate(ctx, id, (i) => ({ item: { ...i, archived: true, updatedAt: now() } }))
  }

  async unarchive(ctx: ProjectContext, id: string): Promise<void> {
    await ctx.mutex.run(ctx.paths.itemsDir(), async () => {
      await this.assertNameFree(ctx, (await this.get(ctx, id)).name, id)
      await this.mutate(ctx, id, (i) => ({ item: { ...i, archived: false, updatedAt: now() } }))
    })
  }

  async delete(ctx: ProjectContext, id: string): Promise<void> {
    await this.get(ctx, id)
    const panelIds = await this.opts.usage.panelsUsingItem(ctx, id)
    if (panelIds.length > 0) throw new ItemInUseError(panelIds)
    const file = ctx.paths.itemFile(id)
    await ctx.mutex.run(file, async () => {
      await this.opts.trash(file)
      const dir = ctx.paths.itemDir(id)
      if (fs.existsSync(dir)) await this.opts.trash(dir)
    })
    this.emit(ctx, id)
  }

  async addUsage(ctx: ProjectContext, itemId: string, input: ItemUsageInput, createdBy: CreatedBy, opts: CreateUsageOptions = {}): Promise<ItemUsage> {
    const usage: ItemUsage = {
      id: newId('use'),
      itemId,
      name: input.name,
      kind: input.kind,
      delta: input.delta,
      imagePath: null,
      ...initialStatus(opts),
      createdBy,
      createdAt: now()
    }
    // The duplicate check runs inside the item's lock, so two concurrent adds of one name cannot both pass it.
    await this.mutate(ctx, itemId, (i) => {
      const wanted = input.name.trim().toLowerCase()
      if (i.usages.some((u) => u.name.trim().toLowerCase() === wanted)) throw new DuplicateUsageError(i.name, input.name)
      return { item: { ...i, usages: [...i.usages, usage], updatedAt: now() } }
    })
    return usage
  }

  /**
   * Ruling T15a: mark pending under the lock, generate OUTSIDE it, then re-read and record the
   * outcome under the lock. Never throws for generation failures; the previous image is kept.
   */
  async generateUsageImage(ctx: ProjectContext, itemId: string, usageId: string, opts: { signal?: AbortSignal } = {}): Promise<ItemUsage> {
    const started = await this.mutate(ctx, itemId, (i) => {
      const u = findUsage(i, usageId)
      const pending: ItemUsage = { ...u, status: 'pending', error: null }
      return { item: { ...i, usages: i.usages.map((x) => (x.id === usageId ? pending : x)), updatedAt: now() } }
    })
    const snapshot = started.item
    const usage = findUsage(snapshot, usageId)
    const isBase = usage.kind === 'base'
    const base = snapshot.usages.find((u) => u.kind === 'base')

    let result: { data: Buffer; ext: string } | null = null
    let failure: string | null = null
    try {
      if (!isBase && (!base || base.status !== 'ready' || !base.imagePath)) {
        failure = 'Base reference image is not ready'
      } else {
        const stylePreset = (await this.opts.projects.getMeta(ctx)).stylePreset
        result = await this.opts.images.generate(ctx, {
          prompt: isBase ? itemReferencePrompt(snapshot, stylePreset) : itemUsagePrompt(snapshot, usage, stylePreset),
          references: isBase ? [] : [{ relPath: base!.imagePath!, label: 'item base reference' }],
          aspect: '1:1',
          signal: opts.signal
        })
      }
    } catch (error) {
      failure = failureMessage(error)
    }

    return this.finish(ctx, itemId, usage, result, failure)
  }

  async uploadUsageImage(ctx: ProjectContext, itemId: string, usageId: string, data: Buffer, ext: UploadExt): Promise<ItemUsage> {
    if (!UPLOAD_EXTS.includes(ext)) throw new Error(`Unsupported image extension: ${String(ext)} (use png, jpg or webp)`)
    // No `pending` phase: the bytes are in hand, so write the file and record it in one locked step.
    // On failure the usage is untouched and the caller gets the error.
    const file = ctx.paths.itemFile(itemId)
    const next = await ctx.mutex.run(file, async () => {
      const i = await this.get(ctx, itemId)
      const u = findUsage(i, usageId)
      const rel = imageRelPath(itemId, usageId, ext)
      const abs = ctx.paths.resolveAsset(rel)
      await writeFileAtomic(abs, data)
      const ready: ItemUsage = { ...u, status: 'ready', error: null, imagePath: rel }
      try {
        await writeJsonAtomic(file, { ...i, usages: i.usages.map((x) => (x.id === usageId ? ready : x)), updatedAt: now() })
      } catch (error) {
        await fs.promises.rm(abs, { force: true }).catch(() => undefined)
        throw error
      }
      return ready
    })
    this.emit(ctx, itemId)
    return next
  }

  async deleteUsage(ctx: ProjectContext, itemId: string, usageId: string): Promise<void> {
    const i = await this.get(ctx, itemId)
    const u = findUsage(i, usageId)
    if (u.kind === 'base') throw new Error('The base usage cannot be deleted')
    const panelIds = await this.opts.usage.panelsUsingItemUsage(ctx, usageId)
    if (panelIds.length > 0) throw new ItemInUseError(panelIds, 'usage')
    await this.mutate(ctx, itemId, (cur) => ({ item: { ...cur, usages: cur.usages.filter((x) => x.id !== usageId), updatedAt: now() } }))
    const abs = u.imagePath === null ? null : ownImage(ctx, itemId, u.imagePath)
    if (abs !== null && fs.existsSync(abs)) await this.opts.trash(abs)
  }

  /** Startup repair: a generation cannot survive the app closing, so every `pending` becomes `failed`. */
  async recoverInterrupted(ctx: ProjectContext): Promise<void> {
    for (const i of await this.list(ctx, { includeArchived: true })) {
      if (!i.usages.some((u) => u.status === 'pending')) continue
      try {
        await this.mutate(ctx, i.id, (cur) => ({
          item: { ...cur, usages: cur.usages.map((u) => (u.status === 'pending' ? { ...u, status: 'failed' as const, error: INTERRUPTED } : u)) }
        }))
      } catch (error) {
        // One unreadable or unwritable item must not block opening the project.
        if (error instanceof EntityNotFoundError) continue
        // `i.id` came from the file name (list), so this path needs no id validation that could throw.
        const rel = ctx.paths.toRelative(path.join(ctx.paths.itemsDir(), `${i.id}.json`))
        if (!ctx.problems.some((p) => p.path === rel)) ctx.problems.push({ path: rel, message: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  /**
   * Step 3 of Ruling T15a: under the lock, record the outcome if the usage still exists. Never
   * throws: if recording fails, the usage is marked `failed` (best effort; `recoverInterrupted`
   * is the backstop for a file that cannot be written) and a `failed` usage is returned.
   */
  private async finish(
    ctx: ProjectContext,
    itemId: string,
    fallback: ItemUsage,
    result: { data: Buffer; ext: string } | null,
    failure: string | null
  ): Promise<ItemUsage> {
    const file = ctx.paths.itemFile(itemId)
    const outcome = await ctx.mutex.run(file, async (): Promise<{ usage: ItemUsage; persisted: boolean } | null> => {
      let current: Item
      try {
        current = await readItemFile(file, itemId)
      } catch (error) {
        if (isNotFound(error)) return null
        // Corrupt or unreadable: rewriting it from our stale snapshot could destroy the user's edits.
        return { usage: { ...fallback, status: 'failed', error: failureMessage(error) }, persisted: false }
      }
      const existing = current.usages.find((u) => u.id === fallback.id)
      if (!existing) return null
      const save = (u: ItemUsage): Promise<void> =>
        writeJsonAtomic(file, { ...current, usages: current.usages.map((x) => (x.id === u.id ? u : x)), updatedAt: now() })
      let imageAbs: string | null = null
      try {
        let next: ItemUsage
        if (result && failure === null) {
          const rel = imageRelPath(itemId, fallback.id, result.ext)
          imageAbs = ctx.paths.resolveAsset(rel)
          await writeFileAtomic(imageAbs, result.data)
          next = { ...existing, status: 'ready', error: null, imagePath: rel }
        } else {
          next = { ...existing, status: 'failed', error: failure ?? 'Image generation failed' }
        }
        await save(next)
        return { usage: next, persisted: true }
      } catch (error) {
        // The image file is not referenced by anything yet, so it would be an orphan.
        if (imageAbs) await fs.promises.rm(imageAbs, { force: true }).catch(() => undefined)
        const failed: ItemUsage = { ...existing, status: 'failed', error: failureMessage(error) }
        try {
          await save(failed)
          return { usage: failed, persisted: true }
        } catch {
          return { usage: failed, persisted: false }
        }
      }
    })
    if (!outcome) return { ...fallback, status: 'failed', error: 'Usage was deleted' }
    if (outcome.persisted) this.emit(ctx, itemId)
    return outcome.usage
  }

  private async mutate<R extends { item: Item }>(ctx: ProjectContext, id: string, fn: (i: Item) => R): Promise<R> {
    const file = ctx.paths.itemFile(id)
    const out = await ctx.mutex.run(file, async () => {
      const current = await this.get(ctx, id)
      const r = fn(current)
      await writeJsonAtomic(file, r.item)
      return r
    })
    this.emit(ctx, id)
    return out
  }

  private async assertNameFree(ctx: ProjectContext, name: string, exceptId?: string): Promise<void> {
    const wanted = name.trim().toLowerCase()
    const clash = (await this.list(ctx)).find((i) => i.id !== exceptId && i.name.trim().toLowerCase() === wanted)
    if (clash) throw new DuplicateItemError(name)
  }

  private emit(ctx: ProjectContext, itemId: string): void {
    this.opts.bus.emit({ type: 'item.changed', projectId: ctx.id, itemId })
  }
}

/** Reads an item file and checks that it holds the id its file name says (Ruling T18f). */
async function readItemFile(file: string, id: string): Promise<Item> {
  const item = await readJson(file, ItemSchema)
  if (item.id !== id) throw new CorruptFileError(file, `holds item id ${JSON.stringify(item.id)}, which does not match its file name`)
  return item
}

function findUsage(i: Item, usageId: string): ItemUsage {
  const u = i.usages.find((x) => x.id === usageId)
  if (!u) throw new EntityNotFoundError('usage', usageId)
  return u
}

/**
 * The image's absolute path when it lies inside the item's own folder, else null. A hand-edited path can
 * name anything in the project (another item's image, an upload, a folder): deleting a usage must
 * never trash that (I4).
 */
function ownImage(ctx: ProjectContext, itemId: string, relPath: string): string | null {
  try {
    const abs = ctx.paths.resolveAsset(relPath)
    return isInside(ctx.paths.itemDir(itemId), abs) ? abs : null
  } catch (error) {
    if (error instanceof PathEscapeError) return null
    throw error
  }
}

function imageRelPath(itemId: string, usageId: string, ext: string): string {
  return `items/${itemId}/${usageId}_${randomBytes(3).toString('hex')}.${ext}`
}

function failureMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'Cancelled'
  return error instanceof Error && error.message ? error.message : String(error)
}
