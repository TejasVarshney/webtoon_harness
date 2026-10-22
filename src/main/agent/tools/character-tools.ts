import { z } from 'zod'
import { CharacterInputSchema, CharacterPatchSchema, VariationInputSchema } from '@shared/schemas'
import type { Character, Variation } from '@shared/types'
import { DuplicateCharacterError } from '../../domain/character-service'
import { EntityNotFoundError, PathEscapeError } from '../../domain/errors'
import { ToolError, defineTool, type ToolContext, type ToolDefinition, type ToolOutput } from './registry'

const APPEARANCE_LOCK_CHANGED = 'appearanceLock changed: regenerate the base and variations so new panels stay consistent.'

const characterId = z.string().describe('Character id, e.g. chr_0123456789')
const variationId = z.string().describe('Variation id, e.g. var_0123456789')

/** A model that passes a name or a mangled id gets the same answer as for an id that does not exist. */
async function loadCharacter(ctx: ToolContext, id: string): Promise<Character> {
  try {
    return await ctx.services.characters.get(ctx.project, id)
  } catch (error) {
    if (error instanceof EntityNotFoundError || error instanceof PathEscapeError) throw new ToolError(`Unknown character: ${id}`)
    throw error
  }
}

function findVariation(character: Character, id: string): Variation {
  const found = character.variations.find((v) => v.id === id)
  if (!found) throw new ToolError(`Unknown variation: ${id}`)
  return found
}

/** The outcome of an image generation. A `failed` status is a result for the model to read, not a thrown error. */
function variationOutcome(v: Variation): ToolOutput {
  return {
    content: { variationId: v.id, status: v.status, error: v.error, imagePath: v.imagePath },
    images: v.status === 'ready' && v.imagePath !== null ? [v.imagePath] : []
  }
}

const listCharacters = defineTool({
  name: 'list_characters',
  description: 'List the active (non-archived) characters with their ids, roles, aliases and variations (id, name, kind, image status). Use it to look up ids.',
  input: z.object({}),
  handler: async (_input, ctx) => {
    const characters = await ctx.services.characters.list(ctx.project)
    return {
      content: {
        characters: characters.map((c) => ({
          id: c.id,
          name: c.name,
          role: c.role,
          aliases: c.aliases,
          variations: c.variations.map((v) => ({ id: v.id, name: v.name, kind: v.kind, status: v.status }))
        }))
      }
    }
  }
})

const getCharacter = defineTool({
  name: 'get_character',
  description: 'Get one character in full: characterization, appearance, appearance lock and every variation.',
  input: z.object({ characterId }),
  handler: async ({ characterId }, ctx) => ({ content: await loadCharacter(ctx, characterId) })
})

const createCharacter = defineTool({
  name: 'create_character',
  description:
    'Create a character and, unless generateBaseImage is false, generate its base reference image and wait for it. ' +
    'The appearanceLock is one paragraph of concrete visual description (about 40-90 words: age and build, face, hair, eyes, skin, marks, default outfit, palette) ' +
    'that is injected verbatim into every image prompt showing the character. If the image fails the character is still created: read baseStatus and baseError, ' +
    'and call regenerate_variation to retry.',
  input: CharacterInputSchema.extend({
    name: z.string().min(1).describe('Unique character name'),
    appearanceLock: z.string().min(1).describe('Canonical visual description injected into every image prompt for this character'),
    generateBaseImage: z.boolean().optional().describe('Generate the base reference image now. Default true.')
  }),
  handler: async ({ generateBaseImage, ...input }, ctx) => {
    const { characters } = ctx.services
    let created: Character
    try {
      created = await characters.create(ctx.project, input, 'ai', { generate: generateBaseImage !== false })
    } catch (error) {
      if (error instanceof DuplicateCharacterError) throw new ToolError(error.message)
      throw error
    }
    const base = created.variations[0]
    // Generation never throws for provider failures; a failed image is reported in the result.
    const settled = generateBaseImage === false ? base : await characters.generateVariationImage(ctx.project, created.id, base.id, { signal: ctx.signal })
    return {
      content: { characterId: created.id, baseVariationId: base.id, baseStatus: settled.status, baseError: settled.error, imagePath: settled.imagePath },
      images: settled.status === 'ready' && settled.imagePath !== null ? [settled.imagePath] : []
    }
  }
})

const updateCharacter = defineTool({
  name: 'update_character',
  description:
    'Update fields of a character. Only the fields named in patch change; characterization and appearance merge field by field. ' +
    'Changing appearanceLock does not regenerate any image, and the result warns about it.',
  input: z.object({ characterId, patch: CharacterPatchSchema }),
  handler: async ({ characterId, patch }, ctx) => {
    await loadCharacter(ctx, characterId)
    try {
      const { character, appearanceLockChanged } = await ctx.services.characters.update(ctx.project, characterId, patch)
      return { content: { character, warnings: appearanceLockChanged ? [APPEARANCE_LOCK_CHANGED] : [] } }
    } catch (error) {
      if (error instanceof DuplicateCharacterError) throw new ToolError(error.message)
      throw error
    }
  }
})

const createVariation = defineTool({
  name: 'create_variation',
  description:
    'Add a recurring look to a character (an outfit, expression, pose, age, form or other) and, unless generateImage is false, generate its reference image from the base image and wait for it. ' +
    'Name it like "Outfit: School uniform". delta says what differs from the base look. A failed image leaves the variation in place with status failed.',
  input: VariationInputSchema.extend({
    characterId,
    name: z.string().min(1).describe('For example "Outfit: School uniform"'),
    delta: z.string().describe('What differs from the base look'),
    generateImage: z.boolean().optional().describe('Generate the reference image now. Default true.')
  }),
  handler: async ({ characterId, generateImage, ...input }, ctx) => {
    await loadCharacter(ctx, characterId)
    const { characters } = ctx.services
    const added = await characters.addVariation(ctx.project, characterId, input, 'ai', { generate: generateImage !== false })
    const settled = generateImage === false ? added : await characters.generateVariationImage(ctx.project, characterId, added.id, { signal: ctx.signal })
    return variationOutcome(settled)
  }
})

const regenerateVariation = defineTool({
  name: 'regenerate_variation',
  description:
    "Generate a variation's reference image again (the base variation included) and wait for it. " +
    'Use it to retry a failed image or after an appearanceLock change. If the new image fails, the previous image stays current.',
  input: z.object({ characterId, variationId }),
  handler: async ({ characterId, variationId }, ctx) => {
    const character = await loadCharacter(ctx, characterId)
    findVariation(character, variationId)
    return variationOutcome(await ctx.services.characters.generateVariationImage(ctx.project, characterId, variationId, { signal: ctx.signal }))
  }
})

export const characterTools: ToolDefinition[] = [listCharacters, getCharacter, createCharacter, updateCharacter, createVariation, regenerateVariation]
