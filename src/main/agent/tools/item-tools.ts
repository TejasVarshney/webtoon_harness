import { z } from 'zod'
import { ItemInputSchema, ItemPatchSchema, ItemUsageInputSchema } from '@shared/schemas'
import type { Item, ItemUsage } from '@shared/types'
import { DuplicateItemError, DuplicateUsageError } from '../../domain/item-service'
import { EntityNotFoundError, PathEscapeError } from '../../domain/errors'
import { joinIssues, sheetCheckFailure, sheetCheckState } from '../../domain/panel-validation'
import { ToolError, defineTool, type ToolContext, type ToolDefinition, type ToolOutput } from './registry'
import { FIRST_ART_NOTE } from './style-tools'

const APPEARANCE_LOCK_CHANGED = 'appearanceLock changed: regenerate the base and every usage so new panels stay consistent.'

/** What the model is told when a generated sheet failed its check after the redraws. */
const SHEET_FAILED_NOTE = 'The sheet failed its check after the redraws. It cannot be cast until it passes: regenerate it, fix the lock, or ask the user.'

const itemId = z.string().describe('Item id, e.g. itm_0123456789')
const usageId = z.string().describe('Usage id, e.g. use_0123456789')

/** A model that passes a name or a mangled id gets the same answer as for an id that does not exist. */
async function loadItem(ctx: ToolContext, id: string): Promise<Item> {
  try {
    return await ctx.services.items.get(ctx.project, id)
  } catch (error) {
    if (error instanceof EntityNotFoundError || error instanceof PathEscapeError) throw new ToolError(`Unknown item: ${id}`)
    throw error
  }
}

function findUsage(item: Item, id: string): ItemUsage {
  const found = item.usages.find((u) => u.id === id)
  if (!found) throw new ToolError(`Unknown usage: ${id}`)
  return found
}

/** `ownerId` names a character, so a wrong one is refused here rather than stored. `null` and `undefined` mean no owner. */
async function checkOwner(ctx: ToolContext, ownerId: string | null | undefined): Promise<void> {
  if (ownerId === null || ownerId === undefined) return
  try {
    await ctx.services.characters.get(ctx.project, ownerId)
  } catch (error) {
    if (error instanceof EntityNotFoundError || error instanceof PathEscapeError) throw new ToolError(`Unknown character: ${ownerId}`)
    throw error
  }
}

/**
 * Usages are drawn from the base image, so none is created or redrawn while the base sheet has failed its check.
 * Redrawing the base itself stays allowed: pass `target` and the base is let through.
 */
function refuseWhileBaseFailed(item: Item, target?: ItemUsage): void {
  if (target?.kind === 'base') return
  const base = item.usages.find((u) => u.kind === 'base')
  const issues = base ? sheetCheckFailure(base) : null
  if (issues) throw new ToolError(`The base sheet of ${item.name} failed its check: ${joinIssues(issues)}. Regenerate the base first.`)
}

/** The sheet check as the model reads it in a list: the state, and the issues when it failed. */
function checkFields(u: ItemUsage): { check: 'passed' | 'failed' | 'skipped' | null; checkIssues?: string[] } {
  const issues = sheetCheckFailure(u)
  return issues ? { check: 'failed', checkIssues: issues } : { check: sheetCheckState(u.check) }
}

/**
 * The note for a sheet that came out failed after the redraws: only a `ready` sheet whose check failed. A sheet whose
 * drawing failed keeps its older check, and the redraws that note speaks of never happened.
 */
function failedNote(u: ItemUsage): { note?: string } {
  return u.status === 'ready' && sheetCheckFailure(u) ? { note: SHEET_FAILED_NOTE } : {}
}

/** The outcome of an image generation. A `failed` status is a result for the model to read, not a thrown error. A failed sheet check adds a `note`. */
function usageOutcome(u: ItemUsage): ToolOutput {
  return {
    content: {
      usageId: u.id,
      status: u.status,
      error: u.error,
      imagePath: u.imagePath,
      check: u.check,
      ...failedNote(u)
    },
    images: u.status === 'ready' && u.imagePath !== null ? [u.imagePath] : []
  }
}

const listItems = defineTool({
  name: 'list_items',
  description: 'List the active (non-archived) items with their ids, aliases, owner and usages (id, name, kind, image status). Use it to look up ids and to see which usages exist before you create one.',
  input: z.object({}),
  handler: async (_input, ctx) => {
    const items = await ctx.services.items.list(ctx.project)
    return {
      content: {
        items: items.map((i) => ({
          id: i.id,
          name: i.name,
          aliases: i.aliases,
          ownerId: i.ownerId,
          usages: i.usages.map((u) => ({ id: u.id, name: u.name, kind: u.kind, status: u.status, ...checkFields(u) }))
        }))
      }
    }
  }
})

const getItem = defineTool({
  name: 'get_item',
  description: 'Get one item in full: notes, owner, item lock and every usage with its delta.',
  input: z.object({ itemId }),
  handler: async ({ itemId }, ctx) => ({ content: await loadItem(ctx, itemId) })
})

const createItem = defineTool({
  name: 'create_item',
  description:
    'Create a recurring item (a weapon, gadget, artifact or vehicle) and, unless generateBaseImage is false, generate its base reference image and wait for it. ' +
    'The appearanceLock is one paragraph of concrete visual description (about 25-70 words: shape and size compared with a hand, materials, colors, markings, lights, distinctive parts) ' +
    'that is injected verbatim into every image prompt showing the item. Give it a distinctive name ("Kestrel blaster", not "blaster"). ' +
    'If the image fails the item is still created: read baseStatus and baseError, and call regenerate_item_usage with baseUsageId to retry. ' +
    FIRST_ART_NOTE,
  input: ItemInputSchema.extend({
    name: z.string().min(1).describe('Unique item name, distinctive, e.g. "Kestrel blaster"'),
    appearanceLock: z.string().min(1).describe('Canonical visual description injected into every image prompt for this item'),
    ownerId: z.string().nullable().optional().describe('Character id of who usually carries it, or null. Default null.'),
    generateBaseImage: z.boolean().optional().describe('Generate the base reference image now. Default true.')
  }),
  handler: async ({ generateBaseImage, ...input }, ctx) => {
    await checkOwner(ctx, input.ownerId)
    const { items } = ctx.services
    let created: Item
    try {
      created = await items.create(ctx.project, input, 'ai', { generate: generateBaseImage !== false })
    } catch (error) {
      if (error instanceof DuplicateItemError) throw new ToolError(error.message)
      throw error
    }
    const base = created.usages[0]
    // Generation never throws for provider failures; a failed image is reported in the result.
    const settled = generateBaseImage === false ? base : await items.generateUsageImage(ctx.project, created.id, base.id, { signal: ctx.signal })
    return {
      content: { itemId: created.id, baseUsageId: base.id, baseStatus: settled.status, baseError: settled.error, imagePath: settled.imagePath, baseCheck: settled.check, ...failedNote(settled) },
      images: settled.status === 'ready' && settled.imagePath !== null ? [settled.imagePath] : []
    }
  }
})

const updateItem = defineTool({
  name: 'update_item',
  description:
    'Update fields of an item. Only the fields named in patch change; ownerId null clears the owner. ' +
    'Changing appearanceLock does not regenerate any image, and the result warns about it.',
  input: z.object({ itemId, patch: ItemPatchSchema }),
  handler: async ({ itemId, patch }, ctx) => {
    await loadItem(ctx, itemId)
    await checkOwner(ctx, patch.ownerId)
    try {
      const { item, appearanceLockChanged } = await ctx.services.items.update(ctx.project, itemId, patch)
      return { content: { item, warnings: appearanceLockChanged ? [APPEARANCE_LOCK_CHANGED] : [] } }
    } catch (error) {
      if (error instanceof DuplicateItemError) throw new ToolError(error.message)
      throw error
    }
  }
})

const createItemUsage = defineTool({
  name: 'create_item_usage',
  description:
    'Add a recurring way an item looks or is handled and, unless generateImage is false, generate its reference image from the base image and wait for it. ' +
    'kind is state (folded, glowing, broken: the object alone) or action (Firing, Swinging, Scanning: shown with gray hands). ' +
    'delta says what the usage shows; for an action name the grip, the motion and the visible effect. ' +
    'Usage names are unique per item: if one already exists the call is refused and names it, so use that one. A failed image leaves the usage in place with status failed.',
  input: ItemUsageInputSchema.extend({
    itemId,
    name: z.string().min(1).describe('For example "Firing" or "Folded"'),
    delta: z.string().describe('What the usage shows: for an action the grip, the motion and the visible effect'),
    generateImage: z.boolean().optional().describe('Generate the reference image now. Default true.')
  }),
  handler: async ({ itemId, generateImage, ...input }, ctx) => {
    refuseWhileBaseFailed(await loadItem(ctx, itemId))
    const { items } = ctx.services
    let added: ItemUsage
    try {
      added = await items.addUsage(ctx.project, itemId, input, 'ai', { generate: generateImage !== false })
    } catch (error) {
      if (error instanceof DuplicateUsageError) throw new ToolError(error.message)
      throw error
    }
    const settled = generateImage === false ? added : await items.generateUsageImage(ctx.project, itemId, added.id, { signal: ctx.signal })
    return usageOutcome(settled)
  }
})

const regenerateItemUsage = defineTool({
  name: 'regenerate_item_usage',
  description:
    "Generate a usage's reference image again (the base usage included) and wait for it. " +
    'Use it to retry a failed image or after an appearanceLock change. If the new image fails, the previous image stays current.',
  input: z.object({ itemId, usageId }),
  handler: async ({ itemId, usageId }, ctx) => {
    const item = await loadItem(ctx, itemId)
    refuseWhileBaseFailed(item, findUsage(item, usageId))
    return usageOutcome(await ctx.services.items.generateUsageImage(ctx.project, itemId, usageId, { signal: ctx.signal }))
  }
})

export const itemTools: ToolDefinition[] = [listItems, getItem, createItem, updateItem, createItemUsage, regenerateItemUsage]
