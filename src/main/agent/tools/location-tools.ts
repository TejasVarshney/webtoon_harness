import { z } from 'zod'
import { LocationInputSchema, LocationPatchSchema, LocationStateInputSchema } from '@shared/schemas'
import type { Location, LocationState } from '@shared/types'
import { DuplicateLocationError, DuplicateStateError } from '../../domain/location-service'
import { EntityNotFoundError, PathEscapeError } from '../../domain/errors'
import { joinIssues, sheetCheckFailure, sheetCheckState } from '../../domain/panel-validation'
import { ToolError, defineTool, type ToolContext, type ToolDefinition, type ToolOutput } from './registry'

// The twin of item-tools.ts: a change here usually belongs there too. No tool deletes a location.

const LAYOUT_CHANGED = 'layout changed: regenerate the base picture and every state picture so new panels stay consistent.'

/** What the model is told when a generated picture failed its check after the redraws. */
const PICTURE_FAILED_NOTE = 'The picture failed its check after the redraws. Regenerate it, fix the layout, or ask the user.'

const locationId = z.string().describe('Location id, e.g. loc_0123456789')
const stateId = z.string().describe('State id, e.g. lst_0123456789')

/** A model that passes a name or a mangled id gets the same answer as for an id that does not exist. */
async function loadLocation(ctx: ToolContext, id: string): Promise<Location> {
  try {
    return await ctx.services.locations.get(ctx.project, id)
  } catch (error) {
    if (error instanceof EntityNotFoundError || error instanceof PathEscapeError) throw new ToolError(`Unknown location: ${id}`)
    throw error
  }
}

function findState(location: Location, id: string): LocationState {
  const found = location.states.find((s) => s.id === id)
  if (!found) throw new ToolError(`Unknown state: ${id}`)
  return found
}

/**
 * States are drawn from the base picture, so none is created or redrawn while the base picture has failed its check.
 * Redrawing the base itself stays allowed: pass `target` and the base is let through.
 */
function refuseWhileBaseFailed(location: Location, target?: LocationState): void {
  if (target?.kind === 'base') return
  const base = location.states.find((s) => s.kind === 'base')
  const issues = base ? sheetCheckFailure(base) : null
  if (issues) throw new ToolError(`The base picture of ${location.name} failed its check: ${joinIssues(issues)}. Regenerate the base first.`)
}

/** The picture check as the model reads it in a list: the state, and the issues when it failed. */
function checkFields(s: LocationState): { check: 'passed' | 'failed' | 'skipped' | null; checkIssues?: string[] } {
  const issues = sheetCheckFailure(s)
  return issues ? { check: 'failed', checkIssues: issues } : { check: sheetCheckState(s.check) }
}

/** The note for a picture that came out failed after the redraws: only a `ready` picture whose check failed. */
function failedNote(s: LocationState): { note?: string } {
  return s.status === 'ready' && sheetCheckFailure(s) ? { note: PICTURE_FAILED_NOTE } : {}
}

/** The outcome of a picture generation. A `failed` status is a result for the model to read, not a thrown error. */
function stateOutcome(s: LocationState): ToolOutput {
  return {
    content: { stateId: s.id, status: s.status, error: s.error, imagePath: s.imagePath, check: s.check, ...failedNote(s) },
    images: s.status === 'ready' && s.imagePath !== null ? [s.imagePath] : []
  }
}

const listLocations = defineTool({
  name: 'list_locations',
  description: 'List the active (non-archived) locations with their ids, aliases and states (id, name, kind, picture status). Use it to look up ids and to see which states exist before you create one.',
  input: z.object({}),
  handler: async (_input, ctx) => {
    const locations = await ctx.services.locations.list(ctx.project)
    return {
      content: {
        locations: locations.map((l) => ({
          id: l.id,
          name: l.name,
          aliases: l.aliases,
          states: l.states.map((s) => ({ id: s.id, name: s.name, kind: s.kind, status: s.status, ...checkFields(s) }))
        }))
      }
    }
  }
})

const getLocation = defineTool({
  name: 'get_location',
  description: 'Get one location in full: notes, layout and every state with its delta.',
  input: z.object({ locationId }),
  handler: async ({ locationId }, ctx) => ({ content: await loadLocation(ctx, locationId) })
})

const createLocation = defineTool({
  name: 'create_location',
  description:
    'Create a recurring place (a room, a street, a rooftop) and, unless generateBaseImage is false, generate its base picture (the empty place from its main camera angle) and wait for it. ' +
    'The layout is written from that main camera angle: what the camera faces, then each landmark and which side of the frame it is on (frame-left, center, frame-right, foreground, background), ' +
    'for example "Camera faces the back wall. Back door at frame-left; shelves along the right wall at frame-right; a barrel in the center foreground." ' +
    'It is injected verbatim into every panel prompt set there and is what the consistency check judges the staging against. ' +
    'If the picture fails the location is still created: read baseStatus and baseError, and call regenerate_location_state with baseStateId to retry.',
  input: LocationInputSchema.extend({
    name: z.string().min(1).describe('Unique location name, e.g. "Supermart back stockroom"'),
    layout: z.string().min(1).describe('The landmarks and their sides of the frame, seen from the main camera angle'),
    generateBaseImage: z.boolean().optional().describe('Generate the base picture now. Default true.')
  }),
  handler: async ({ generateBaseImage, ...input }, ctx) => {
    const { locations } = ctx.services
    let created: Location
    try {
      created = await locations.create(ctx.project, input, 'ai', { generate: generateBaseImage !== false })
    } catch (error) {
      if (error instanceof DuplicateLocationError) throw new ToolError(error.message)
      throw error
    }
    const base = created.states[0]
    // Generation never throws for provider failures; a failed picture is reported in the result.
    const settled = generateBaseImage === false ? base : await locations.generateStateImage(ctx.project, created.id, base.id, { signal: ctx.signal })
    return {
      content: { locationId: created.id, baseStateId: base.id, baseStatus: settled.status, baseError: settled.error, imagePath: settled.imagePath, baseCheck: settled.check, ...failedNote(settled) },
      images: settled.status === 'ready' && settled.imagePath !== null ? [settled.imagePath] : []
    }
  }
})

const updateLocation = defineTool({
  name: 'update_location',
  description: 'Update fields of a location. Only the fields named in patch change. Changing layout does not regenerate any picture, and the result warns about it.',
  input: z.object({ locationId, patch: LocationPatchSchema }),
  handler: async ({ locationId, patch }, ctx) => {
    await loadLocation(ctx, locationId)
    try {
      const { location, layoutChanged } = await ctx.services.locations.update(ctx.project, locationId, patch)
      return { content: { location, warnings: layoutChanged ? [LAYOUT_CHANGED] : [] } }
    } catch (error) {
      if (error instanceof DuplicateLocationError) throw new ToolError(error.message)
      throw error
    }
  }
})

const createLocationState = defineTool({
  name: 'create_location_state',
  description:
    'Add a recurring look of a location ("Night, embers only", "Back door open to a blizzard") and, if generateImage is true, draw its own picture from the base picture and wait for it. ' +
    'By default no picture is drawn: a panel in a state without its own picture is drawn from the base picture and the delta in words, which is usually enough. ' +
    'delta says only what differs from the base: light, weather, damage, what is open or broken. The layout never changes between states. ' +
    'State names are unique per location: if one already exists the call is refused and names it, so use that one.',
  input: LocationStateInputSchema.extend({
    locationId,
    name: z.string().min(1).describe('For example "Night" or "Back door open"'),
    delta: z.string().describe('What differs from the base look: light, weather, damage, what is open'),
    generateImage: z.boolean().optional().describe('Draw a picture of its own now. Default false.')
  }),
  handler: async ({ locationId, generateImage, ...input }, ctx) => {
    const location = await loadLocation(ctx, locationId)
    if (generateImage === true) refuseWhileBaseFailed(location)
    const { locations } = ctx.services
    let added: LocationState
    try {
      added = await locations.addState(ctx.project, locationId, input, 'ai', { generate: generateImage === true })
    } catch (error) {
      if (error instanceof DuplicateStateError) throw new ToolError(error.message)
      throw error
    }
    const settled = generateImage === true ? await locations.generateStateImage(ctx.project, locationId, added.id, { signal: ctx.signal }) : added
    return stateOutcome(settled)
  }
})

const regenerateLocationState = defineTool({
  name: 'regenerate_location_state',
  description:
    "Draw a state's picture again (the base state included) and wait for it. " +
    'Use it to retry a failed picture, after a layout change, or to give a state a picture of its own. If the new picture fails, the previous one stays current.',
  input: z.object({ locationId, stateId }),
  handler: async ({ locationId, stateId }, ctx) => {
    const location = await loadLocation(ctx, locationId)
    refuseWhileBaseFailed(location, findState(location, stateId))
    return stateOutcome(await ctx.services.locations.generateStateImage(ctx.project, locationId, stateId, { signal: ctx.signal }))
  }
})

export const locationTools: ToolDefinition[] = [listLocations, getLocation, createLocation, updateLocation, createLocationState, regenerateLocationState]
