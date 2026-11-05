import fs from 'node:fs'
import path from 'node:path'
import { drawAspect } from '@shared/draw-aspect'
import { newId } from '@shared/ids'
import { PanelSchema } from '@shared/schemas'
import type { Character, CheckResult, DialogueLine, Episode, Item, Panel, PanelDraft, PanelPatch, PanelVersion } from '@shared/types'
import { visualFields } from '@shared/visual-fields'
import type { EventBus } from '../events/bus'
import { writeJsonAtomic } from '../storage/atomic'
import type { ProjectContext, ProjectStore } from '../storage/project-store'
import type { CharacterService, PanelUsageLookup } from './character-service'
import type { ConsistencyChecker } from './consistency-checker'
import type { EpisodeService } from './episode-service'
import { EntityNotFoundError } from './errors'
import type { ImageGenRequest, ImageService } from './image-service'
import type { ItemService, ItemUsageLookup } from './item-service'
import { getPanel, reportProblem, scanPanels, tryReadPanel } from './panel-files'
import { readSketchFile, storeSketch, storeUploadedImage } from './panel-images'
import { recordAttempt, recordCheck, type Attempt, type EmitPanelChanged } from './panel-recording'
import { grandfatherUnchangedCast, grandfatherUnchangedItems, validatePanelDraft } from './panel-validation'
import { composePanelPrompt, editPanelPrompt, type PanelPromptReference } from './prompts'
import { failureMessage, INTERRUPTED, now, type UploadExt } from './records'

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
  items: ItemService
  images: ImageService
  /** Moves a path to the OS trash. */
  trash: (absPath: string) => Promise<void>
  /** The vision consistency check. Without one, `generate` never checks or retries. */
  checker?: Pick<ConsistencyChecker, 'check'>
}


/** What the consistency check needs to know about a draw, captured while its prompt was composed. */
interface DrawContext {
  panel: Panel
  roster: Character[]
  /** Every item, archived ones included. */
  itemRoster: Item[]
  /** The references the image model got, in prompt order, with their labels. */
  references: PanelPromptReference[]
  /** The project's `consistencyRetries` when the draw started. */
  retries: number
}

/** One draw of a panel: its version, and (when the prompt could be composed) what the check needs. */
interface Draw {
  version: PanelVersion
  context: DrawContext | null
}

/**
 * Panels and their version history (`panels/<pnlId>.json`, images in `panels/<pnlId>/<verId>.<ext>`).
 * Lock discipline: a panel's file lock is never held together with an episode lock, and
 * no lock is ever held across an image call.
 */
export class PanelService implements PanelUsageLookup, ItemUsageLookup {
  constructor(private readonly opts: PanelServiceOptions) {}

  /** The episode's panels in episode order. Unreadable panel files are reported in `ctx.problems` and skipped. */
  async list(ctx: ProjectContext, episodeId: string): Promise<Panel[]> {
    const episode = await this.opts.episodes.get(ctx, episodeId)
    const panels: Panel[] = []
    for (const id of episode.panelIds) {
      const panel = await tryReadPanel(ctx, id)
      if (panel) panels.push(panel)
    }
    return panels
  }

  get(ctx: ProjectContext, id: string): Promise<Panel> {
    return getPanel(ctx, id)
  }

  /** The panel just before this one in its episode, or null for the first panel. */
  async previousPanel(ctx: ProjectContext, panelId: string): Promise<Panel | null> {
    return this.previousOf(ctx, await this.get(ctx, panelId))
  }

  async create(ctx: ProjectContext, draft: PanelDraft, opts: { createdBy: Panel['createdBy']; strictMentions: boolean; strictSheets: boolean }): Promise<{ panel: Panel; warnings: string[] }> {
    const episode = await this.opts.episodes.get(ctx, draft.episodeId)
    if (typeof draft.afterPanelId === 'string' && !episode.panelIds.includes(draft.afterPanelId)) throw new EntityNotFoundError('panel', draft.afterPanelId)

    const roster = await this.opts.characters.list(ctx, { includeArchived: true })
    const itemRoster = await this.itemRoster(ctx)
    const check = validatePanelDraft(draft, roster, itemRoster, { strictMentions: opts.strictMentions, strictSheets: opts.strictSheets })
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
      frame: draft.frame,
      beside: draft.beside,
      gapAfter: draft.gapAfter,
      gutter: draft.gutter,
      characters: draft.characters,
      items: draft.items ?? [],
      dialogue: draft.dialogue.map((line) => withId(line, null)),
      continuityNotes: draft.continuityNotes ?? '',
      offPanelMentions: draft.offPanelMentions ?? [],
      versions: [],
      currentVersionId: null,
      createdBy: opts.createdBy,
      createdAt: at,
      updatedAt: at
    })

    // The panel file first, then the episode, with no lock held across the two steps.
    const file = ctx.paths.panelFile(id)
    await ctx.mutex.run(file, () => writeJsonAtomic(file, panel))
    try {
      await this.opts.episodes.insertPanel(ctx, draft.episodeId, id, draft.afterPanelId)
    } catch (error) {
      // Nothing else knows this id yet, so removing the file is not a user deletion (no trash).
      await ctx.mutex.run(file, () => fs.promises.rm(file, { force: true })).catch(() => undefined)
      throw error
    }
    this.emit(ctx, id)
    return { panel, warnings: check.warnings }
  }

  /**
   * Applies a patch to the stored panel and validates the merged result. The archived
   * and "no ready reference image" checks apply only to cast entries that are new or whose variation
   * changed, so a panel that casts a since-archived character, or a variation whose regeneration
   * later failed, stays editable. Unknown-character and foreign-variation errors apply to every entry.
   * Items work the same way: an unchanged item and usage pair is grandfathered, and the unknown-item,
   * foreign-usage and holder errors apply to every entry. It also clears a failed sheet check on
   * an unchanged pair, so editing a panel never blocks a cast it already had.
   */
  async update(ctx: ProjectContext, id: string, patch: PanelPatch, opts: { strictMentions: boolean; strictSheets: boolean }): Promise<{ panel: Panel; warnings: string[] }> {
    const file = ctx.paths.panelFile(id)
    const roster = await this.opts.characters.list(ctx, { includeArchived: true })
    const itemRoster = await this.itemRoster(ctx)
    const out = await ctx.mutex.run(file, async () => {
      const current = await this.get(ctx, id)
      const merged = {
        description: patch.description ?? current.description,
        setting: patch.setting ?? current.setting,
        shot: patch.shot ?? current.shot,
        aspect: patch.aspect ?? current.aspect,
        frame: patch.frame ?? current.frame,
        beside: patch.beside ?? current.beside,
        gapAfter: patch.gapAfter ?? current.gapAfter,
        gutter: patch.gutter ?? current.gutter,
        characters: patch.characters ?? current.characters,
        items: patch.items ?? current.items,
        // A line sent without a placement keeps the one stored at its index: agents send the whole array when they reword one line.
        dialogue: patch.dialogue ? patch.dialogue.map((line, i) => withId(line, current.dialogue[i]?.placement ?? null)) : current.dialogue,
        continuityNotes: patch.continuityNotes ?? current.continuityNotes,
        offPanelMentions: patch.offPanelMentions ?? current.offPanelMentions
      }
      const check = validatePanelDraft(merged, grandfatherUnchangedCast(roster, current.characters, merged.characters), grandfatherUnchangedItems(itemRoster, current.items, merged.items), {
        strictMentions: opts.strictMentions,
        strictSheets: opts.strictSheets
      })
      if (check.errors.length > 0) throw new PanelValidationError(check.errors)
      const next = PanelSchema.parse({ ...current, ...merged, updatedAt: now() })
      await writeJsonAtomic(file, next)
      return { panel: next, warnings: check.warnings }
    })
    this.emit(ctx, id)
    return out
  }

  /**
   * Draws the panel, checks the image when a vision model is assigned, and redraws up to the project's
   * `consistencyRetries` times while the check fails. Resolves to the version that
   * became current: the last attempt that landed, which is the passing one when any passed. A first
   * draw that fails is returned as it is (`failed`, never checked). When the user reverts or uploads
   * while a check runs, nothing more is redrawn and the version they made current is returned.
   *
   * Each draw prepares first (an unknown cast, no image model, ... becomes a `failed`
   * version and never a throw), appends the version under the panel lock, calls the model OUTSIDE it,
   * then re-reads and records the outcome under the lock. A ready attempt becomes current when it
   * lands, a failed one never moves `currentVersionId`. The vision call runs outside the
   * lock too; its verdict is recorded on the version with the same re-read pattern. An abort of
   * `opts.signal` stops further checks and redraws and keeps what is recorded. Only an unknown panel throws.
   */
  async generate(ctx: ProjectContext, id: string, opts: { signal?: AbortSignal; extraInstruction?: string } = {}): Promise<PanelVersion> {
    let draw = await this.draw(ctx, id, opts)
    const { checker } = this.opts
    if (!checker) return draw.version
    let landed = draw.version
    let retriesLeft = draw.context?.retries ?? 0
    while (draw.context && landed.status === 'ready' && landed.imagePath !== null && !opts.signal?.aborted) {
      const { panel, roster, itemRoster, references } = draw.context
      const check = await runCheck(checker, ctx, { imageRelPath: landed.imagePath, references, panel, roster, itemRoster, signal: opts.signal })
      if (check === null) return landed
      const stored = await recordCheck(this.emit, ctx, id, landed.id, check)
      landed = { ...landed, check }
      // A check that is not on the version (panel deleted, file unwritable) ends the loop: a redraw would be unreachable or unrecorded too.
      if (stored === null) return landed
      // The user reverted or uploaded while the check ran: their choice stands, and it is what is current now.
      if (stored.currentVersionId !== landed.id) return stored.versions.find((v) => v.id === stored.currentVersionId) ?? landed
      if (check.passed || check.skipped || retriesLeft <= 0 || opts.signal?.aborted) return landed
      retriesLeft--
      try {
        draw = await this.draw(ctx, id, { signal: opts.signal, extraInstruction: fixInstruction(check.issues) })
      } catch {
        return landed // the panel vanished between the attempts
      }
      // A redraw that failed is in the history but never became current: the attempt that did is what we report.
      if (draw.version.status !== 'ready') return landed
      landed = draw.version
    }
    return landed
  }

  /** One draw: compose the prompt, record the attempt, call the image model. See `generate`. */
  private async draw(ctx: ProjectContext, id: string, opts: { signal?: AbortSignal; extraInstruction?: string }): Promise<Draw> {
    const panel = await this.get(ctx, id)
    const attempt: Attempt = { source: 'generate', prompt: '', referenceImagePaths: [], instruction: null, parentVersionId: null, drawnFrom: visualFields(panel) }
    let request: ImageGenRequest
    let context: DrawContext
    try {
      const meta = await this.opts.projects.getMeta(ctx)
      const roster = await this.roster(ctx)
      const itemRoster = await this.itemRoster(ctx)
      const previous = readyImage(await this.previousOf(ctx, panel))
      const maxReferences = this.opts.images.maxReferences('image')
      const composed = composePanelPrompt({ stylePreset: meta.stylePreset, panel, roster, itemRoster: new Map(itemRoster.map((i) => [i.id, i])), previous, sketch: panel.sketchPath ?? null, maxReferences })
      const fix = opts.extraInstruction
      attempt.prompt = fix && fix.trim() ? `${composed.prompt}\n[FIX] ${fix}` : composed.prompt
      attempt.referenceImagePaths = composed.references.map((r) => r.relPath)
      request = { prompt: attempt.prompt, references: composed.references, aspect: drawAspect(panel.aspect), signal: opts.signal }
      // The checker compares the picture with the cast, items and previous panel; the sketch is only a layout guide.
      context = { panel, roster: [...roster.values()], itemRoster, references: composed.references.filter((r) => r.subject.kind !== 'sketch'), retries: meta.consistencyRetries }
    } catch (error) {
      return { version: await recordAttempt(this.emit, ctx, id, attempt, { error: failureMessage(error) }), context: null }
    }
    return { version: await recordAttempt(this.emit, ctx, id, attempt, { call: () => this.opts.images.generate(ctx, request) }), context }
  }

  /** Edits the current ready image into a child version. Same recording rules as `generate`. */
  async editImage(ctx: ProjectContext, id: string, instruction: string, opts: { signal?: AbortSignal } = {}): Promise<PanelVersion> {
    const panel = await this.get(ctx, id)
    const attempt: Attempt = { source: 'edit', prompt: '', referenceImagePaths: [], instruction, parentVersionId: panel.currentVersionId, drawnFrom: visualFields(panel) }
    let request: ImageGenRequest & { sourceRelPath: string }
    try {
      const source = panel.versions.find((v) => v.id === panel.currentVersionId)
      if (!source || source.status !== 'ready' || !source.imagePath) throw new Error('No ready image to edit')
      const meta = await this.opts.projects.getMeta(ctx)
      const roster = await this.roster(ctx)
      const itemRoster = new Map((await this.itemRoster(ctx)).map((i) => [i.id, i]))
      const maxReferences = this.opts.images.maxReferences('imageEdit')
      // The cast and item references (and the unknown-cast and unknown-item errors) come from composePanelPrompt so an edit
      // sees exactly the images a generation would; the edit has no previous panel and its own prompt.
      const { references } = composePanelPrompt({ stylePreset: meta.stylePreset, panel, roster, itemRoster, previous: null, maxReferences })
      const cast = panel.characters.flatMap((entry) => {
        const character = roster.get(entry.characterId)
        return character ? [{ name: character.name, appearanceLock: character.appearanceLock }] : []
      })
      const attached = panel.items.flatMap((entry) => {
        const item = itemRoster.get(entry.itemId)
        return item ? [{ name: item.name, appearanceLock: item.appearanceLock }] : []
      })
      attempt.prompt = editPanelPrompt(instruction, cast, attached)
      attempt.referenceImagePaths = references.map((r) => r.relPath)
      request = { prompt: attempt.prompt, references, aspect: drawAspect(panel.aspect), signal: opts.signal, sourceRelPath: source.imagePath }
    } catch (error) {
      return recordAttempt(this.emit, ctx, id, attempt, { error: failureMessage(error) })
    }
    return recordAttempt(this.emit, ctx, id, attempt, { call: () => this.opts.images.edit(ctx, request) })
  }

  /** Stores the user's own image as a new current version. The bytes are in hand, so there is no pending phase. */
  async uploadImage(ctx: ProjectContext, id: string, data: Buffer, ext: UploadExt): Promise<PanelVersion> {
    const version = await storeUploadedImage(ctx, id, data, ext)
    this.emit(ctx, id)
    return version
  }

  /**
   * Stores the user's layout sketch (a PNG) under a new name, so versions drawn from an older sketch keep pointing at
   * it, or forgets it with `null`. Generation sends it as a reference (see `composePanelPrompt`); edits do not.
   */
  async saveSketch(ctx: ProjectContext, id: string, png: Buffer | null): Promise<Panel> {
    const next = await storeSketch(ctx, id, png)
    this.emit(ctx, id)
    return next
  }

  /** The bytes of the panel's layout sketch, or `null` when it has none (or its file is gone). */
  async readSketch(ctx: ProjectContext, id: string): Promise<Buffer | null> {
    const { sketchPath } = await this.get(ctx, id)
    return sketchPath ? readSketchFile(ctx, sketchPath) : null
  }

  /** Makes a ready version current. No version is deleted. */
  revert(ctx: ProjectContext, id: string, versionId: string): Promise<Panel> {
    return this.mutate(ctx, id, (panel) => {
      const target = panel.versions.find((v) => v.id === versionId)
      if (!target || target.status !== 'ready') throw new EntityNotFoundError('version', versionId)
      return { ...panel, currentVersionId: versionId, updatedAt: now() }
    })
  }

  /** Removes the panel from its episode, then trashes its JSON, image folder and side chat (never both locks at once). */
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
      // The panel's chat thread goes with it.
      const chat = ctx.paths.panelChatFile(id)
      if (fs.existsSync(chat)) await this.opts.trash(chat)
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
    const panels = await scanPanels(ctx)
    return panels.filter((p) => p.characters.some((c) => c.characterId === characterId) || p.dialogue.some((d) => d.speakerId === characterId)).map((p) => p.id)
  }

  async panelsUsingVariation(ctx: ProjectContext, variationId: string): Promise<string[]> {
    const panels = await scanPanels(ctx)
    return panels.filter((p) => p.characters.some((c) => c.variationId === variationId)).map((p) => p.id)
  }

  /** Panels that attach the item, whether or not an episode lists them. */
  async panelsUsingItem(ctx: ProjectContext, itemId: string): Promise<string[]> {
    const panels = await scanPanels(ctx)
    return panels.filter((p) => p.items.some((i) => i.itemId === itemId)).map((p) => p.id)
  }

  async panelsUsingItemUsage(ctx: ProjectContext, usageId: string): Promise<string[]> {
    const panels = await scanPanels(ctx)
    return panels.filter((p) => p.items.some((i) => i.usageId === usageId)).map((p) => p.id)
  }

  /**
   * Startup repair: a generation cannot survive the app closing, so every `pending` version becomes
   * `failed`. Never throws: an unreadable panel (or folder) is reported in `ctx.problems` and skipped.
   */
  async recoverInterrupted(ctx: ProjectContext): Promise<void> {
    let panels: Panel[]
    try {
      panels = await scanPanels(ctx)
    } catch (error) {
      reportProblem(ctx, ctx.paths.panelsDir(), error)
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
        // `panel.id` came from the file name (scan), so this path is built without validation that could throw.
        reportProblem(ctx, path.join(ctx.paths.panelsDir(), `${panel.id}.json`), error)
      }
    }
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
    return index > 0 ? tryReadPanel(ctx, episode.panelIds[index - 1]) : null
  }

  /** Every character, archived ones included: existing panels keep regenerating after a character is archived. */
  private async roster(ctx: ProjectContext): Promise<Map<string, Character>> {
    return new Map((await this.opts.characters.list(ctx, { includeArchived: true })).map((c) => [c.id, c]))
  }

  /** Every item, archived ones included: existing panels keep regenerating after an item is archived. */
  private itemRoster(ctx: ProjectContext): Promise<Item[]> {
    return this.opts.items.list(ctx, { includeArchived: true })
  }

  private readonly emit: EmitPanelChanged = (ctx, panelId) => {
    this.opts.bus.emit({ type: 'panel.changed', projectId: ctx.id, panelId })
  }
}

/** The previous panel's current image, if that version is ready. */
function readyImage(panel: Panel | null): { panelId: string; imagePath: string } | null {
  const version = panel?.versions.find((v) => v.id === panel.currentVersionId)
  return panel && version && version.status === 'ready' && version.imagePath ? { panelId: panel.id, imagePath: version.imagePath } : null
}

/** The checker never throws, but a stand-in might: a check that fails to run is no check (the version keeps `check: null`). */
async function runCheck(checker: Pick<ConsistencyChecker, 'check'>, ctx: ProjectContext, input: Parameters<ConsistencyChecker['check']>[1]): Promise<CheckResult | null> {
  try {
    return await checker.check(ctx, input)
  } catch {
    return null
  }
}

/** The extra instruction for a redraw after a failed check; none when the checker named no issue (the redraw is then a plain re-roll). */
function fixInstruction(issues: string[]): string | undefined {
  return issues.length > 0 ? `Fix these consistency issues: ${issues.join('; ')}` : undefined
}

/** Gives a draft line its id. A line sent without a placement takes `inherited`; an explicit null stays null. */
function withId(line: Omit<DialogueLine, 'id' | 'placement'> & { placement?: DialogueLine['placement'] }, inherited: DialogueLine['placement']): DialogueLine {
  return { id: newId('dlg'), speakerId: line.speakerId, kind: line.kind, text: line.text, placement: line.placement === undefined ? inherited : line.placement }
}
