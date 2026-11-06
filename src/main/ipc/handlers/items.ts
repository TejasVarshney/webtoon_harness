import fs from 'node:fs'
import path from 'node:path'
import { ItemInputSchema, ItemPatchSchema, ItemUsageInputSchema } from '@shared/schemas'
import { EntityNotFoundError } from '../../domain/errors'
import type { Services } from '../../services'
import type { ProjectContext } from '../../storage/project-store'
import type { HandlerMap } from './projects'
import { STORED_EXT, type PickFiles } from './uploads'

export interface ItemsDeps {
  /** Shows the native file dialog. Absent (tests, headless) behaves like a cancelled dialog. */
  pickFiles?: PickFiles
}

/** Starts a task the caller does not wait for. Its outcome is recorded on the entity and announced as `item.changed`. */
function inBackground(task: Promise<unknown>, what: string): void {
  task.catch((error: unknown) => console.error(`${what} failed`, error))
}

export function itemsHandlers(s: Services, deps: ItemsDeps = {}): HandlerMap {
  const { items } = s
  const pickFiles: PickFiles = deps.pickFiles ?? (async () => [])

  /** The usage must exist before any work (or a file dialog) starts. */
  async function requireUsage(ctx: ProjectContext, itemId: string, usageId: string) {
    const item = await items.get(ctx, itemId)
    const usage = item.usages.find((u) => u.id === usageId)
    if (!usage) throw new EntityNotFoundError('usage', usageId)
    return usage
  }

  return {
    'items:list': async ({ projectId, includeArchived }) => items.list(await s.projects.open(projectId), { includeArchived }),
    'items:get': async ({ projectId, itemId }) => items.get(await s.projects.open(projectId), itemId),

    'items:create': async ({ projectId, input, generateBase }) => {
      const ctx = await s.projects.open(projectId)
      // `=== true`: a missing flag must not create a pending usage that nothing will ever generate.
      const generate = generateBase === true
      const created = await items.create(ctx, ItemInputSchema.parse(input), 'user', { generate })
      if (generate) inBackground(items.generateUsageImage(ctx, created.id, created.usages[0].id), 'Base image generation')
      return created
    },

    'items:update': async ({ projectId, itemId, patch }) => {
      const { item } = await items.update(await s.projects.open(projectId), itemId, ItemPatchSchema.parse(patch))
      return item
    },

    'items:archive': async ({ projectId, itemId }) => items.archive(await s.projects.open(projectId), itemId),
    'items:unarchive': async ({ projectId, itemId }) => items.unarchive(await s.projects.open(projectId), itemId),
    'items:delete': async ({ projectId, itemId }) => items.delete(await s.projects.open(projectId), itemId),

    'items:addUsage': async ({ projectId, itemId, input, generate }) => {
      const ctx = await s.projects.open(projectId)
      // Parsed here because the service does not check `kind`: a second `base` would break the one-base invariant.
      const run = generate === true
      const added = await items.addUsage(ctx, itemId, ItemUsageInputSchema.parse(input), 'user', { generate: run })
      if (run) inBackground(items.generateUsageImage(ctx, itemId, added.id), 'Usage image generation')
      return added
    },

    'items:generateUsage': async ({ projectId, itemId, usageId }) => {
      const ctx = await s.projects.open(projectId)
      const usage = await requireUsage(ctx, itemId, usageId)
      inBackground(items.generateUsageImage(ctx, itemId, usageId), 'Usage image generation')
      // The service marks it pending as its first step; the caller can show that right away.
      return { ...usage, status: 'pending', error: null }
    },

    'items:deleteUsage': async ({ projectId, itemId, usageId }) => items.deleteUsage(await s.projects.open(projectId), itemId, usageId),

    'items:uploadUsageImage': async ({ projectId, itemId, usageId }, event) => {
      const ctx = await s.projects.open(projectId)
      await requireUsage(ctx, itemId, usageId)
      const [file] = await pickFiles(event, { multiple: false, title: 'Choose a usage image' })
      if (file === undefined) return null
      const ext = STORED_EXT[path.extname(file).toLowerCase()]
      if (!ext) throw new Error('Unsupported image type: use png, jpg or webp')
      return items.uploadUsageImage(ctx, itemId, usageId, await fs.promises.readFile(file), ext)
    }
  }
}
