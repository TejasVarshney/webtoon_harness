import fs from 'node:fs'
import path from 'node:path'
import { CharacterInputSchema, CharacterPatchSchema, VariationInputSchema } from '@shared/schemas'
import { EntityNotFoundError } from '../../domain/errors'
import type { Services } from '../../services'
import type { ProjectContext } from '../../storage/project-store'
import type { HandlerMap } from './projects'
import { STORED_EXT, type PickFiles } from './uploads'

export interface CharactersDeps {
  /** Shows the native file dialog. Absent (tests, headless) behaves like a cancelled dialog. */
  pickFiles?: PickFiles
}

/** Starts a task the caller does not wait for. Its outcome is recorded on the entity and announced as `character.changed`. */
function inBackground(task: Promise<unknown>, what: string): void {
  task.catch((error: unknown) => console.error(`${what} failed`, error))
}

export function charactersHandlers(s: Services, deps: CharactersDeps = {}): HandlerMap {
  const { characters } = s
  const pickFiles: PickFiles = deps.pickFiles ?? (async () => [])

  /** The variation must exist before any work (or a file dialog) starts. */
  async function requireVariation(ctx: ProjectContext, characterId: string, variationId: string) {
    const character = await characters.get(ctx, characterId)
    const variation = character.variations.find((v) => v.id === variationId)
    if (!variation) throw new EntityNotFoundError('variation', variationId)
    return variation
  }

  return {
    'characters:list': async ({ projectId, includeArchived }) => characters.list(await s.projects.open(projectId), { includeArchived }),
    'characters:get': async ({ projectId, characterId }) => characters.get(await s.projects.open(projectId), characterId),

    'characters:create': async ({ projectId, input, generateBase }) => {
      const ctx = await s.projects.open(projectId)
      const created = await characters.create(ctx, CharacterInputSchema.parse(input), 'user')
      if (generateBase) inBackground(characters.generateVariationImage(ctx, created.id, created.variations[0].id), 'Base image generation')
      return created
    },

    'characters:update': async ({ projectId, characterId, patch }) => {
      const { character } = await characters.update(await s.projects.open(projectId), characterId, CharacterPatchSchema.parse(patch))
      return character
    },

    'characters:archive': async ({ projectId, characterId }) => characters.archive(await s.projects.open(projectId), characterId),
    'characters:unarchive': async ({ projectId, characterId }) => characters.unarchive(await s.projects.open(projectId), characterId),
    'characters:delete': async ({ projectId, characterId }) => characters.delete(await s.projects.open(projectId), characterId),

    'characters:addVariation': async ({ projectId, characterId, input, generate }) => {
      const ctx = await s.projects.open(projectId)
      // Parsed here because the service does not check `kind`: a second `base` would break the one-base invariant.
      const added = await characters.addVariation(ctx, characterId, VariationInputSchema.parse(input), 'user')
      if (generate) inBackground(characters.generateVariationImage(ctx, characterId, added.id), 'Variation image generation')
      return added
    },

    'characters:generateVariation': async ({ projectId, characterId, variationId }) => {
      const ctx = await s.projects.open(projectId)
      const variation = await requireVariation(ctx, characterId, variationId)
      inBackground(characters.generateVariationImage(ctx, characterId, variationId), 'Variation image generation')
      // The service marks it pending as its first step; the caller can show that right away.
      return { ...variation, status: 'pending', error: null }
    },

    'characters:deleteVariation': async ({ projectId, characterId, variationId }) => characters.deleteVariation(await s.projects.open(projectId), characterId, variationId),

    'characters:uploadVariationImage': async ({ projectId, characterId, variationId }, event) => {
      const ctx = await s.projects.open(projectId)
      await requireVariation(ctx, characterId, variationId)
      const [file] = await pickFiles(event, { multiple: false, title: 'Choose a variation image' })
      if (file === undefined) return null
      const ext = STORED_EXT[path.extname(file).toLowerCase()]
      if (!ext) throw new Error('Unsupported image type: use png, jpg or webp')
      return characters.uploadVariationImage(ctx, characterId, variationId, await fs.promises.readFile(file), ext)
    }
  }
}
