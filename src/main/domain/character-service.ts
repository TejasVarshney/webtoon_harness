import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { newId } from '@shared/ids'
import { CharacterSchema } from '@shared/schemas'
import type { Character, CharacterInput, CharacterPatch, Variation, VariationInput } from '@shared/types'
import type { EventBus } from '../events/bus'
import { readJson, writeFileAtomic, writeJsonAtomic } from '../storage/atomic'
import type { ProjectContext, ProjectStore } from '../storage/project-store'
import { EntityNotFoundError } from './errors'
import type { ImageService } from './image-service'
import { baseReferencePrompt, variationPrompt } from './prompts'

type CreatedBy = Variation['createdBy']

export class DuplicateCharacterError extends Error {
  constructor(readonly characterName: string) {
    super(`A character named "${characterName}" already exists`)
    this.name = 'DuplicateCharacterError'
  }
}

/** The character (or variation) is used by panels, so it can only be archived, not deleted. */
export class CharacterInUseError extends Error {
  constructor(
    readonly panelIds: string[],
    what = 'character'
  ) {
    super(`This ${what} is used by ${panelIds.length} panel(s): ${panelIds.join(', ')}. Archive it instead.`)
    this.name = 'CharacterInUseError'
  }
}

/** Which panels reference a character or variation. Task 18 backs this with PanelService. */
export interface PanelUsageLookup {
  panelsUsingCharacter(ctx: ProjectContext, characterId: string): Promise<string[]>
  panelsUsingVariation(ctx: ProjectContext, variationId: string): Promise<string[]>
}

export interface CharacterServiceOptions {
  bus: EventBus
  images: ImageService
  projects: ProjectStore
  usage: PanelUsageLookup
  /** Moves a path to the OS trash. */
  trash: (absPath: string) => Promise<void>
}

const INTERRUPTED = 'Interrupted: the app closed during generation'
const UPLOAD_EXTS = ['png', 'jpg', 'webp'] as const
type UploadExt = (typeof UPLOAD_EXTS)[number]
const CHARACTER_FILE = /^chr_[A-Za-z0-9]+\.json$/

function isNotFound(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code: unknown }).code : undefined
  return code === 'ENOENT' || code === 'ENOTDIR'
}

const now = (): string => new Date().toISOString()

export class CharacterService {
  constructor(private readonly opts: CharacterServiceOptions) {}

  async list(ctx: ProjectContext, opts: { includeArchived?: boolean } = {}): Promise<Character[]> {
    let names: string[]
    try {
      names = await fs.promises.readdir(ctx.paths.charactersDir())
    } catch (error) {
      if (isNotFound(error)) return []
      throw error
    }
    const out: Character[] = []
    for (const name of names) {
      if (!CHARACTER_FILE.test(name)) continue
      const abs = path.join(ctx.paths.charactersDir(), name)
      try {
        out.push(await readJson(abs, CharacterSchema))
      } catch (error) {
        if (isNotFound(error)) continue
        const rel = ctx.paths.toRelative(abs)
        if (!ctx.problems.some((p) => p.path === rel)) ctx.problems.push({ path: rel, message: error instanceof Error ? error.message : String(error) })
      }
    }
    out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))
    return opts.includeArchived ? out : out.filter((c) => !c.archived)
  }

  async get(ctx: ProjectContext, id: string): Promise<Character> {
    try {
      return await readJson(ctx.paths.characterFile(id), CharacterSchema)
    } catch (error) {
      if (isNotFound(error)) throw new EntityNotFoundError('character', id)
      throw error
    }
  }

  async create(ctx: ProjectContext, input: CharacterInput, createdBy: CreatedBy): Promise<Character> {
    // The name check and the write share one lock so two concurrent creates cannot both pass it.
    const character = await ctx.mutex.run(ctx.paths.charactersDir(), async () => {
      await this.assertNameFree(ctx, input.name)
      const id = newId('chr')
      const at = now()
      const c = CharacterSchema.parse({
        id,
        name: input.name,
        aliases: input.aliases,
        role: input.role,
        characterization: input.characterization,
        appearance: input.appearance,
        appearanceLock: input.appearanceLock,
        variations: [{ id: newId('var'), characterId: id, name: 'Base', kind: 'base', delta: '', imagePath: null, status: 'pending', error: null, createdBy, createdAt: at }],
        archived: false,
        createdBy,
        createdAt: at,
        updatedAt: at
      })
      await ctx.mutex.run(ctx.paths.characterFile(id), () => writeJsonAtomic(ctx.paths.characterFile(id), c))
      return c
    })
    this.emit(ctx, character.id)
    return character
  }

  async update(ctx: ProjectContext, id: string, patch: CharacterPatch): Promise<{ character: Character; appearanceLockChanged: boolean }> {
    const run = () =>
      this.mutate(ctx, id, (c) => {
        const next: Character = {
          ...c,
          name: patch.name ?? c.name,
          role: patch.role ?? c.role,
          aliases: patch.aliases ?? c.aliases,
          characterization: { ...c.characterization, ...definedOnly(patch.characterization) },
          appearance: { ...c.appearance, ...definedOnly(patch.appearance) },
          appearanceLock: patch.appearanceLock ?? c.appearanceLock,
          updatedAt: now()
        }
        return { character: CharacterSchema.parse(next), appearanceLockChanged: next.appearanceLock !== c.appearanceLock }
      })
    // A rename must stay unique, so it takes the same lock `create` uses.
    if (patch.name === undefined) return run()
    const name = patch.name
    return ctx.mutex.run(ctx.paths.charactersDir(), async () => {
      await this.assertNameFree(ctx, name, id)
      return run()
    })
  }

  async archive(ctx: ProjectContext, id: string): Promise<void> {
    await this.mutate(ctx, id, (c) => ({ character: { ...c, archived: true, updatedAt: now() } }))
  }

  async unarchive(ctx: ProjectContext, id: string): Promise<void> {
    await ctx.mutex.run(ctx.paths.charactersDir(), async () => {
      await this.assertNameFree(ctx, (await this.get(ctx, id)).name, id)
      await this.mutate(ctx, id, (c) => ({ character: { ...c, archived: false, updatedAt: now() } }))
    })
  }

  async delete(ctx: ProjectContext, id: string): Promise<void> {
    await this.get(ctx, id)
    const panelIds = await this.opts.usage.panelsUsingCharacter(ctx, id)
    if (panelIds.length > 0) throw new CharacterInUseError(panelIds)
    const file = ctx.paths.characterFile(id)
    await ctx.mutex.run(file, async () => {
      await this.opts.trash(file)
      const dir = ctx.paths.characterDir(id)
      if (fs.existsSync(dir)) await this.opts.trash(dir)
    })
    this.emit(ctx, id)
  }

  async addVariation(ctx: ProjectContext, characterId: string, input: VariationInput, createdBy: CreatedBy): Promise<Variation> {
    const variation: Variation = {
      id: newId('var'),
      characterId,
      name: input.name,
      kind: input.kind,
      delta: input.delta,
      imagePath: null,
      status: 'pending',
      error: null,
      createdBy,
      createdAt: now()
    }
    await this.mutate(ctx, characterId, (c) => ({ character: { ...c, variations: [...c.variations, variation], updatedAt: now() } }))
    return variation
  }

  /**
   * Ruling T15a: mark pending under the lock, generate OUTSIDE it, then re-read and record the
   * outcome under the lock. Never throws for generation failures; the previous image is kept.
   */
  async generateVariationImage(ctx: ProjectContext, characterId: string, variationId: string, opts: { signal?: AbortSignal } = {}): Promise<Variation> {
    const started = await this.mutate(ctx, characterId, (c) => {
      const v = findVariation(c, variationId)
      const pending: Variation = { ...v, status: 'pending', error: null }
      return { character: { ...c, variations: c.variations.map((x) => (x.id === variationId ? pending : x)), updatedAt: now() } }
    })
    const snapshot = started.character
    const variation = findVariation(snapshot, variationId)
    const isBase = variation.kind === 'base'
    const base = snapshot.variations.find((v) => v.kind === 'base')

    let result: { data: Buffer; ext: string } | null = null
    let failure: string | null = null
    try {
      if (!isBase && (!base || base.status !== 'ready' || !base.imagePath)) {
        failure = 'Base reference image is not ready'
      } else {
        const stylePreset = (await this.opts.projects.getMeta(ctx)).stylePreset
        result = await this.opts.images.generate(ctx, {
          prompt: isBase ? baseReferencePrompt(snapshot, stylePreset) : variationPrompt(snapshot, variation, stylePreset),
          references: isBase ? [] : [{ relPath: base!.imagePath!, label: 'base reference' }],
          aspect: '2:3',
          signal: opts.signal
        })
      }
    } catch (error) {
      failure = failureMessage(error)
    }

    return this.finish(ctx, characterId, variation, result, failure)
  }

  async uploadVariationImage(ctx: ProjectContext, characterId: string, variationId: string, data: Buffer, ext: UploadExt): Promise<Variation> {
    if (!UPLOAD_EXTS.includes(ext)) throw new Error(`Unsupported image extension: ${String(ext)} (use png, jpg or webp)`)
    const { character } = await this.mutate(ctx, characterId, (c) => {
      const v = findVariation(c, variationId)
      return { character: { ...c, variations: c.variations.map((x) => (x.id === variationId ? { ...v, status: 'pending' as const, error: null } : x)), updatedAt: now() } }
    })
    return this.finish(ctx, characterId, findVariation(character, variationId), { data, ext }, null)
  }

  async deleteVariation(ctx: ProjectContext, characterId: string, variationId: string): Promise<void> {
    const c = await this.get(ctx, characterId)
    const v = findVariation(c, variationId)
    if (v.kind === 'base') throw new Error('The base variation cannot be deleted')
    const panelIds = await this.opts.usage.panelsUsingVariation(ctx, variationId)
    if (panelIds.length > 0) throw new CharacterInUseError(panelIds, 'variation')
    await this.mutate(ctx, characterId, (cur) => ({ character: { ...cur, variations: cur.variations.filter((x) => x.id !== variationId), updatedAt: now() } }))
    if (v.imagePath) {
      const abs = ctx.paths.resolveAsset(v.imagePath)
      if (fs.existsSync(abs)) await this.opts.trash(abs)
    }
  }

  /** Startup repair: a generation cannot survive the app closing, so every `pending` becomes `failed`. */
  async recoverInterrupted(ctx: ProjectContext): Promise<void> {
    for (const c of await this.list(ctx, { includeArchived: true })) {
      if (!c.variations.some((v) => v.status === 'pending')) continue
      try {
        await this.mutate(ctx, c.id, (cur) => ({
          character: { ...cur, variations: cur.variations.map((v) => (v.status === 'pending' ? { ...v, status: 'failed' as const, error: INTERRUPTED } : v)) }
        }))
      } catch (error) {
        if (!(error instanceof EntityNotFoundError)) throw error
      }
    }
  }

  /** Step 3 of Ruling T15a: under the lock, record the outcome if the variation still exists. */
  private async finish(
    ctx: ProjectContext,
    characterId: string,
    fallback: Variation,
    result: { data: Buffer; ext: string } | null,
    failure: string | null
  ): Promise<Variation> {
    const file = ctx.paths.characterFile(characterId)
    let final: Variation = fallback
    const changed = await ctx.mutex.run(file, async () => {
      let current: Character
      try {
        current = await readJson(file, CharacterSchema)
      } catch (error) {
        if (isNotFound(error)) return false
        throw error
      }
      const existing = current.variations.find((v) => v.id === fallback.id)
      if (!existing) return false
      let next: Variation
      try {
        if (result && failure === null) {
          const rel = `characters/${characterId}/${fallback.id}_${randomBytes(3).toString('hex')}.${result.ext}`
          await writeFileAtomic(ctx.paths.resolveAsset(rel), result.data)
          next = { ...existing, status: 'ready', error: null, imagePath: rel }
        } else {
          next = { ...existing, status: 'failed', error: failure ?? 'Image generation failed' }
        }
      } catch (error) {
        next = { ...existing, status: 'failed', error: failureMessage(error) }
      }
      await writeJsonAtomic(file, { ...current, variations: current.variations.map((v) => (v.id === next.id ? next : v)), updatedAt: now() })
      final = next
      return true
    })
    if (changed) this.emit(ctx, characterId)
    return final
  }

  private async mutate<R extends { character: Character }>(ctx: ProjectContext, id: string, fn: (c: Character) => R): Promise<R> {
    const file = ctx.paths.characterFile(id)
    const out = await ctx.mutex.run(file, async () => {
      const current = await this.get(ctx, id)
      const r = fn(current)
      await writeJsonAtomic(file, r.character)
      return r
    })
    this.emit(ctx, id)
    return out
  }

  private async assertNameFree(ctx: ProjectContext, name: string, exceptId?: string): Promise<void> {
    const wanted = name.trim().toLowerCase()
    const clash = (await this.list(ctx)).find((c) => c.id !== exceptId && c.name.trim().toLowerCase() === wanted)
    if (clash) throw new DuplicateCharacterError(name)
  }

  private emit(ctx: ProjectContext, characterId: string): void {
    this.opts.bus.emit({ type: 'character.changed', projectId: ctx.id, characterId })
  }
}

function findVariation(c: Character, variationId: string): Variation {
  const v = c.variations.find((x) => x.id === variationId)
  if (!v) throw new EntityNotFoundError('variation', variationId)
  return v
}

function failureMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'Cancelled'
  return error instanceof Error && error.message ? error.message : String(error)
}

/** Drops `undefined` values so a patch never blanks a field it does not name. */
function definedOnly<T extends object>(o: T | undefined): Partial<T> {
  return Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>
}
