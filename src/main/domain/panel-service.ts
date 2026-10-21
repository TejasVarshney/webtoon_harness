import fs from 'node:fs'
import path from 'node:path'
import { newId } from '@shared/ids'
import { PanelSchema } from '@shared/schemas'
import type { Character, DialogueLine, Episode, Panel, PanelCharacter, PanelDraft, PanelPatch, PanelVersion } from '@shared/types'
import type { EventBus } from '../events/bus'
import { readJson, writeFileAtomic, writeJsonAtomic } from '../storage/atomic'
import type { ProjectContext, ProjectStore } from '../storage/project-store'
import type { CharacterService, PanelUsageLookup } from './character-service'
import type { EpisodeService } from './episode-service'
import { EntityNotFoundError } from './errors'
import type { ImageGenRequest, ImageGenResult, ImageService } from './image-service'
import { validatePanelDraft } from './panel-validation'
import { composePanelPrompt, editPanelPrompt } from './prompts'

/** A panel draft or patch broke a consistency rule. `issues` lists every problem, one per line in the message. */
export class PanelValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join('\n'))
    this.name = 'PanelValidationError'
  }
}

export interface PanelServiceOptions {
  bus: EventBus
  projects: ProjectStore
  episodes: EpisodeService
  characters: CharacterService
  images: ImageService
  /** Moves a path to the OS trash. */
  trash: (absPath: string) => Promise<void>
}

const INTERRUPTED = 'Interrupted: the app closed during generation'
const PANEL_DELETED = 'Panel was deleted'
const UPLOAD_EXTS = ['png', 'jpg', 'webp'] as const
type UploadExt = (typeof UPLOAD_EXTS)[number]
const PANEL_FILE = /^pnl_[A-Za-z0-9]+\.json$/

function isNotFound(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code: unknown }).code : undefined
  return code === 'ENOENT' || code === 'ENOTDIR'
}

const now = (): string => new Date().toISOString()

/** What a version records about how it was made, before the image call runs. */
interface Attempt {
  source: 'generate' | 'edit'
  prompt: string
  referenceImagePaths: string[]
  instruction: string | null
  parentVersionId: string | null
}

/** Either the image call to make, or the reason it cannot be made (recorded as a `failed` version). */
type Preparation = { call: () => Promise<ImageGenResult> } | { error: string }

/**
 * Panels and their version history (`panels/<pnlId>.json`, images in `panels/<pnlId>/<verId>.<ext>`).
 * Lock discipline (Ruling T18c): a panel's file lock is never held together with an episode lock, and
 * no lock is ever held across an image call.
 */
export class PanelService implements PanelUsageLookup {
  constructor(private readonly opts: PanelServiceOptions) {}

  /** The episode's panels in episode order. Unreadable panel files are reported in `ctx.problems` and skipped. */
  async list(ctx: ProjectContext, episodeId: string): Promise<Panel[]> {
    const episode = await this.opts.episodes.get(ctx, episodeId)
    const panels: Panel[] = []
    for (const id of episode.panelIds) {
      const panel = await this.tryRead(ctx, id)
      if (panel) panels.push(panel)
    }
    return panels
  }

  async get(ctx: ProjectContext, id: string): Promise<Panel> {
    try {
      return await readJson(ctx.paths.panelFile(id), PanelSchema)
    } catch (error) {
      if (isNotFound(error)) throw new EntityNotFoundError('panel', id)
      throw error
    }
  }

  /** The panel just before this one in its episode, or null for the first panel. */
  async previousPanel(ctx: ProjectContext, panelId: string): Promise<Panel | null> {
    return this.previousOf(ctx, await this.get(ctx, panelId))
  }

  async create(ctx: ProjectContext, draft: PanelDraft, opts: { createdBy: Panel['createdBy']; strictMentions: boolean }): Promise<{ panel: Panel; warnings: string[] }> {
    const episode = await this.opts.episodes.get(ctx, draft.episodeId)
    if (typeof draft.afterPanelId === 'string' && !episode.panelIds.includes(draft.afterPanelId)) throw new EntityNotFoundError('panel', draft.afterPanelId)

    const roster = await this.opts.characters.list(ctx, { includeArchived: true })
    const check = validatePanelDraft(draft, roster, { strictMentions: opts.strictMentions })
    if (check.errors.length > 0) throw new PanelValidationError(check.errors)

    const meta = await this.opts.projects.getMeta(ctx)
    const id = newId('pnl')
    const at = now()
    const panel = PanelSchema.parse({
      id,
      episodeId: draft.episodeId,
      description: draft.description,
      setting: draft.setting,
      shot: draft.shot,
      aspect: draft.aspect ?? meta.defaultAspect,
      characters: draft.characters,
      dialogue: draft.dialogue.map(withId),
      continuityNotes: draft.continuityNotes ?? '',
      offPanelMentions: draft.offPanelMentions ?? [],
      versions: [],
      currentVersionId: null,
      createdBy: opts.createdBy,
      createdAt: at,
      updatedAt: at
    })

    // Ruling T18c: the panel file first, then the episode, with no lock held across the two steps.
    const file = ctx.paths.panelFile(id)
    await ctx.mutex.run(file, () => writeJsonAtomic(file, panel))
    try {
      await this.opts.episodes.insertPanel(ctx, draft.episodeId, id, draft.afterPanelId)
    } catch (error) {
      // Nothing else knows this id yet, so removing the file is not a user deletion (no trash).
      await fs.promises.rm(file, { force: true }).catch(() => undefined)
      throw error
    }
    this.emit(ctx, id)
    return { panel, warnings: check.warnings }
  }

  /**
   * Applies a patch to the stored panel and validates the merged result. Ruling T18b: the archived
   * check applies only to cast entries that are new or whose variation changed, so a panel that casts
   * a since-archived character stays editable.
   */
  async update(ctx: ProjectContext, id: string, patch: PanelPatch, opts: { strictMentions: boolean }): Promise<{ panel: Panel; warnings: string[] }> {
    const file = ctx.paths.panelFile(id)
    const roster = await this.opts.characters.list(ctx, { includeArchived: true })
    const out = await ctx.mutex.run(file, async () => {
      const current = await this.get(ctx, id)
      const merged = {
        description: patch.description ?? current.description,
        setting: patch.setting ?? current.setting,
        shot: patch.shot ?? current.shot,
        aspect: patch.aspect ?? current.aspect,
        characters: patch.characters ?? current.characters,
        dialogue: patch.dialogue ? patch.dialogue.map(withId) : current.dialogue,
        continuityNotes: patch.continuityNotes ?? current.continuityNotes,
        offPanelMentions: patch.offPanelMentions ?? current.offPanelMentions
      }
      const check = validatePanelDraft(merged, grandfatherArchived(roster, current.characters, merged.characters), { strictMentions: opts.strictMentions })
      if (check.errors.length > 0) throw new PanelValidationError(check.errors)
      const next = PanelSchema.parse({ ...current, ...merged, updatedAt: now() })
      await writeJsonAtomic(file, next)
      return { panel: next, warnings: check.warnings }
    })
    this.emit(ctx, id)
    return out
  }

  /**
   * Ruling T18a. Prepares first (an unknown cast, no image model, ... becomes a `failed` version and
   * never a throw), appends the version under the panel lock, calls the model OUTSIDE it, then
   * re-reads and records the outcome under the lock. A failure leaves `currentVersionId` alone.
   * Only an unknown panel throws.
   */
  async generate(ctx: ProjectContext, id: string, opts: { signal?: AbortSignal; extraInstruction?: string } = {}): Promise<PanelVersion> {
    const panel = await this.get(ctx, id)
    const attempt: Attempt = { source: 'generate', prompt: '', referenceImagePaths: [], instruction: null, parentVersionId: null }
    let request: ImageGenRequest
    try {
      const meta = await this.opts.projects.getMeta(ctx)
      const roster = await this.roster(ctx)
      const previous = readyImage(await this.previousOf(ctx, panel))
      const maxReferences = this.opts.images.maxReferences('image')
      const composed = composePanelPrompt({ stylePreset: meta.stylePreset, panel, roster, previous, maxReferences })
      const fix = opts.extraInstruction
      attempt.prompt = fix && fix.trim() ? `${composed.prompt}\n[FIX] ${fix}` : composed.prompt
      attempt.referenceImagePaths = composed.references.map((r) => r.relPath)
      request = { prompt: attempt.prompt, references: composed.references, aspect: panel.aspect, signal: opts.signal }
    } catch (error) {
      return this.record(ctx, id, attempt, { error: failureMessage(error) })
    }
    return this.record(ctx, id, attempt, { call: () => this.opts.images.generate(ctx, request) })
  }

  /** Edits the current ready image into a child version. Same recording rules as `generate`. */
  async editImage(ctx: ProjectContext, id: string, instruction: string, opts: { signal?: AbortSignal } = {}): Promise<PanelVersion> {
    const panel = await this.get(ctx, id)
    const attempt: Attempt = { source: 'edit', prompt: '', referenceImagePaths: [], instruction, parentVersionId: panel.currentVersionId }
    let request: ImageGenRequest & { sourceRelPath: string }
    try {
      const source = panel.versions.find((v) => v.id === panel.currentVersionId)
      if (!source || source.status !== 'ready' || !source.imagePath) throw new Error('No ready image to edit')
      const meta = await this.opts.projects.getMeta(ctx)
      const roster = await this.roster(ctx)
      const maxReferences = this.opts.images.maxReferences('imageEdit')
      // The cast references (and the unknown-cast errors) come from composePanelPrompt so an edit
      // sees exactly the images a generation would; the edit has no previous panel and its own prompt.
      const { references } = composePanelPrompt({ stylePreset: meta.stylePreset, panel, roster, previous: null, maxReferences })
      const cast = panel.characters.flatMap((entry) => {
        const character = roster.get(entry.characterId)
        return character ? [{ name: character.name, appearanceLock: character.appearanceLock }] : []
      })
      attempt.prompt = editPanelPrompt(instruction, cast)
      attempt.referenceImagePaths = references.map((r) => r.relPath)
      request = { prompt: attempt.prompt, references, aspect: panel.aspect, signal: opts.signal, sourceRelPath: source.imagePath }
    } catch (error) {
      return this.record(ctx, id, attempt, { error: failureMessage(error) })
    }
    return this.record(ctx, id, attempt, { call: () => this.opts.images.edit(ctx, request) })
  }

  /** Stores the user's own image as a new current version. The bytes are in hand, so there is no pending phase. */
  async uploadImage(ctx: ProjectContext, id: string, data: Buffer, ext: UploadExt): Promise<PanelVersion> {
    if (!UPLOAD_EXTS.includes(ext)) throw new Error(`Unsupported image extension: ${String(ext)} (use png, jpg or webp)`)
    const file = ctx.paths.panelFile(id)
    const version = await ctx.mutex.run(file, async () => {
      const current = await this.get(ctx, id)
      const versionId = newId('ver')
      const rel = imageRelPath(id, versionId, ext)
      const abs = ctx.paths.resolveAsset(rel)
      await writeFileAtomic(abs, data)
      const uploaded: PanelVersion = {
        id: versionId,
        source: 'upload',
        status: 'ready',
        error: null,
        imagePath: rel,
        prompt: '',
        referenceImagePaths: [],
        instruction: null,
        parentVersionId: null,
        check: null,
        createdAt: now()
      }
      try {
        await writeJsonAtomic(file, { ...current, versions: [...current.versions, uploaded], currentVersionId: versionId, updatedAt: now() })
      } catch (error) {
        await fs.promises.rm(abs, { force: true }).catch(() => undefined)
        throw error
      }
      return uploaded
    })
    this.emit(ctx, id)
    return version
  }

  /** Makes a ready version current. No version is deleted. */
  revert(ctx: ProjectContext, id: string, versionId: string): Promise<Panel> {
    return this.mutate(ctx, id, (panel) => {
      const target = panel.versions.find((v) => v.id === versionId)
      if (!target || target.status !== 'ready') throw new EntityNotFoundError('version', versionId)
      return { ...panel, currentVersionId: versionId, updatedAt: now() }
    })
  }

  /** Removes the panel from its episode, then trashes its JSON and image folder (Ruling T18c: never both locks at once). */
  async delete(ctx: ProjectContext, id: string): Promise<void> {
    const panel = await this.get(ctx, id)
    try {
      await this.opts.episodes.removePanel(ctx, panel.episodeId, id)
    } catch (error) {
      // An episode that is already gone must not make the panel undeletable.
      if (!(error instanceof EntityNotFoundError)) throw error
    }
    const file = ctx.paths.panelFile(id)
    await ctx.mutex.run(file, async () => {
      await this.opts.trash(file)
      const dir = ctx.paths.panelDir(id)
      if (fs.existsSync(dir)) await this.opts.trash(dir)
    })
    this.emit(ctx, id)
  }

  async move(ctx: ProjectContext, id: string, toIndex: number): Promise<void> {
    const panel = await this.get(ctx, id)
    await this.opts.episodes.movePanel(ctx, panel.episodeId, id, toIndex)
    this.emit(ctx, id)
  }

  /** Panels that cast the character or give it a dialogue line, whether or not an episode lists them. */
  async panelsUsingCharacter(ctx: ProjectContext, characterId: string): Promise<string[]> {
    const panels = await this.scan(ctx)
    return panels.filter((p) => p.characters.some((c) => c.characterId === characterId) || p.dialogue.some((d) => d.speakerId === characterId)).map((p) => p.id)
  }

  async panelsUsingVariation(ctx: ProjectContext, variationId: string): Promise<string[]> {
    const panels = await this.scan(ctx)
    return panels.filter((p) => p.characters.some((c) => c.variationId === variationId)).map((p) => p.id)
  }

  /**
   * Startup repair: a generation cannot survive the app closing, so every `pending` version becomes
   * `failed`. Never throws: an unreadable panel (or folder) is reported in `ctx.problems` and skipped.
   */
  async recoverInterrupted(ctx: ProjectContext): Promise<void> {
    let panels: Panel[]
    try {
      panels = await this.scan(ctx)
    } catch (error) {
      this.report(ctx, ctx.paths.panelsDir(), error)
      return
    }
    for (const panel of panels) {
      if (!panel.versions.some((v) => v.status === 'pending')) continue
      try {
        await this.mutate(ctx, panel.id, (cur) => ({
          ...cur,
          versions: cur.versions.map((v) => (v.status === 'pending' ? { ...v, status: 'failed' as const, error: INTERRUPTED } : v))
        }))
      } catch (error) {
        if (error instanceof EntityNotFoundError) continue
        this.report(ctx, ctx.paths.panelFile(panel.id), error)
      }
    }
  }

  /**
   * Runs one attempt: append the version (already `failed` when preparation failed), call the model
   * outside the lock, then record the outcome. Never throws.
   */
  private async record(ctx: ProjectContext, panelId: string, attempt: Attempt, preparation: Preparation): Promise<PanelVersion> {
    const preFailed = 'error' in preparation
    const version: PanelVersion = {
      id: newId('ver'),
      source: attempt.source,
      status: preFailed ? 'failed' : 'pending',
      error: preFailed ? preparation.error : null,
      imagePath: null,
      prompt: attempt.prompt,
      referenceImagePaths: attempt.referenceImagePaths,
      instruction: attempt.instruction,
      parentVersionId: attempt.parentVersionId,
      check: null,
      createdAt: now()
    }
    const problem = await this.append(ctx, panelId, version)
    if (problem !== null) return { ...version, status: 'failed', error: problem }
    this.emit(ctx, panelId)
    if (preFailed) return version

    let result: ImageGenResult | null = null
    let failure: string | null = null
    try {
      result = await preparation.call()
    } catch (error) {
      failure = failureMessage(error)
    }
    return this.finish(ctx, panelId, version, result, failure)
  }

  /** Appends the version under the panel lock. Returns null when saved, else why it could not be (nothing was written). */
  private async append(ctx: ProjectContext, panelId: string, version: PanelVersion): Promise<string | null> {
    const file = ctx.paths.panelFile(panelId)
    try {
      await ctx.mutex.run(file, async () => {
        const current = await readJson(file, PanelSchema)
        await writeJsonAtomic(file, { ...current, versions: [...current.versions, version], updatedAt: now() })
      })
      return null
    } catch (error) {
      return isNotFound(error) ? PANEL_DELETED : failureMessage(error)
    }
  }

  /**
   * Under the lock, record the outcome if the version still exists. Never throws: if recording
   * fails the version is marked `failed` (best effort; `recoverInterrupted` is the backstop for a file
   * that cannot be written) and a `failed` version is returned. Success also makes it current.
   */
  private async finish(ctx: ProjectContext, panelId: string, started: PanelVersion, result: ImageGenResult | null, failure: string | null): Promise<PanelVersion> {
    const file = ctx.paths.panelFile(panelId)
    const failed = (v: PanelVersion, error: string): PanelVersion => ({ ...v, status: 'failed', error })
    const outcome = await ctx.mutex.run(file, async (): Promise<{ version: PanelVersion; persisted: boolean } | null> => {
      let current: Panel
      try {
        current = await readJson(file, PanelSchema)
      } catch (error) {
        if (isNotFound(error)) return null
        // Corrupt or unreadable: rewriting it from our stale snapshot could destroy the user's edits.
        return { version: failed(started, failureMessage(error)), persisted: false }
      }
      const existing = current.versions.find((v) => v.id === started.id)
      if (!existing) return { version: failed(started, 'Version was removed'), persisted: false }
      const save = (v: PanelVersion, makeCurrent: boolean): Promise<void> =>
        writeJsonAtomic(file, {
          ...current,
          versions: current.versions.map((x) => (x.id === v.id ? v : x)),
          currentVersionId: makeCurrent ? v.id : current.currentVersionId,
          updatedAt: now()
        })
      let imageAbs: string | null = null
      try {
        if (result && failure === null) {
          const rel = imageRelPath(panelId, started.id, result.ext)
          imageAbs = ctx.paths.resolveAsset(rel)
          await writeFileAtomic(imageAbs, result.data)
          const ready: PanelVersion = { ...existing, status: 'ready', error: null, imagePath: rel }
          await save(ready, true)
          return { version: ready, persisted: true }
        }
        const next = failed(existing, failure ?? 'Image generation failed')
        await save(next, false)
        return { version: next, persisted: true }
      } catch (error) {
        // The image file is not referenced by anything yet, so it would be an orphan.
        if (imageAbs) await fs.promises.rm(imageAbs, { force: true }).catch(() => undefined)
        const next = failed(existing, failureMessage(error))
        try {
          await save(next, false)
          return { version: next, persisted: true }
        } catch {
          return { version: next, persisted: false }
        }
      }
    })
    if (!outcome) return failed(started, PANEL_DELETED)
    if (outcome.persisted) this.emit(ctx, panelId)
    return outcome.version
  }

  private async mutate(ctx: ProjectContext, id: string, fn: (p: Panel) => Panel): Promise<Panel> {
    const file = ctx.paths.panelFile(id)
    const next = await ctx.mutex.run(file, async () => {
      const valid = PanelSchema.parse(fn(await this.get(ctx, id)))
      await writeJsonAtomic(file, valid)
      return valid
    })
    this.emit(ctx, id)
    return next
  }

  private async previousOf(ctx: ProjectContext, panel: Panel): Promise<Panel | null> {
    let episode: Episode
    try {
      episode = await this.opts.episodes.get(ctx, panel.episodeId)
    } catch (error) {
      if (error instanceof EntityNotFoundError) return null
      throw error
    }
    const index = episode.panelIds.indexOf(panel.id)
    return index > 0 ? this.tryRead(ctx, episode.panelIds[index - 1]) : null
  }

  /** Every character, archived ones included: existing panels keep regenerating after a character is archived. */
  private async roster(ctx: ProjectContext): Promise<Map<string, Character>> {
    return new Map((await this.opts.characters.list(ctx, { includeArchived: true })).map((c) => [c.id, c]))
  }

  /** The panel, or null if it is missing or unreadable (an unreadable file is reported in `ctx.problems`). */
  private async tryRead(ctx: ProjectContext, id: string): Promise<Panel | null> {
    let file: string
    try {
      file = ctx.paths.panelFile(id)
    } catch {
      return null // a malformed id in a hand-edited episode names no panel
    }
    try {
      return await readJson(file, PanelSchema)
    } catch (error) {
      if (!isNotFound(error)) this.report(ctx, file, error)
      return null
    }
  }

  /** Every readable panel file in `panels/`, whether or not an episode lists it. */
  private async scan(ctx: ProjectContext): Promise<Panel[]> {
    let names: string[]
    try {
      names = await fs.promises.readdir(ctx.paths.panelsDir())
    } catch (error) {
      if (isNotFound(error)) return []
      throw error
    }
    const panels: Panel[] = []
    for (const name of names) {
      if (!PANEL_FILE.test(name)) continue
      const abs = path.join(ctx.paths.panelsDir(), name)
      try {
        panels.push(await readJson(abs, PanelSchema))
      } catch (error) {
        if (!isNotFound(error)) this.report(ctx, abs, error)
      }
    }
    return panels
  }

  private report(ctx: ProjectContext, abs: string, error: unknown): void {
    const rel = ctx.paths.toRelative(abs)
    if (!ctx.problems.some((p) => p.path === rel)) ctx.problems.push({ path: rel, message: error instanceof Error ? error.message : String(error) })
  }

  private emit(ctx: ProjectContext, panelId: string): void {
    this.opts.bus.emit({ type: 'panel.changed', projectId: ctx.id, panelId })
  }
}

/** The previous panel's current image, if that version is ready. */
function readyImage(panel: Panel | null): { panelId: string; imagePath: string } | null {
  const version = panel?.versions.find((v) => v.id === panel.currentVersionId)
  return panel && version && version.status === 'ready' && version.imagePath ? { panelId: panel.id, imagePath: version.imagePath } : null
}

/**
 * Ruling T18b: a roster in which a since-archived character reads as active when its cast entry is
 * unchanged (same character and variation as stored), so `validatePanelDraft` reports "is archived"
 * only for entries that are new or changed. A character that also has a changed entry stays archived.
 */
function grandfatherArchived(roster: Character[], stored: PanelCharacter[], next: PanelCharacter[]): Character[] {
  const unchanged = (entry: PanelCharacter): boolean => stored.some((s) => s.characterId === entry.characterId && s.variationId === entry.variationId)
  const changedIds = new Set(next.filter((entry) => !unchanged(entry)).map((entry) => entry.characterId))
  const keep = new Set(next.filter(unchanged).map((entry) => entry.characterId))
  return roster.map((c) => (c.archived && keep.has(c.id) && !changedIds.has(c.id) ? { ...c, archived: false } : c))
}

function withId(line: Omit<DialogueLine, 'id'>): DialogueLine {
  return { id: newId('dlg'), speakerId: line.speakerId, kind: line.kind, text: line.text }
}

function imageRelPath(panelId: string, versionId: string, ext: string): string {
  return `panels/${panelId}/${versionId}.${ext}`
}

function failureMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'Cancelled'
  return error instanceof Error && error.message ? error.message : String(error)
}
