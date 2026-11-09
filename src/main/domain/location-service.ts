import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { newId } from '@shared/ids'
import { LocationSchema } from '@shared/schemas'
import type { CheckResult, Location, LocationInput, LocationPatch, LocationState, LocationStateInput } from '@shared/types'
import type { EventBus } from '../events/bus'
import { readJson, writeFileAtomic, writeJsonAtomic } from '../storage/atomic'
import { isInside } from '../storage/project-paths'
import type { ProjectContext, ProjectStore } from '../storage/project-store'
import { CorruptFileError, EntityNotFoundError, PathEscapeError } from './errors'
import type { ImageService } from './image-service'
import type { ConsistencyChecker } from './consistency-checker'
import { locationReferencePrompt, locationStatePrompt, sheetFixInstruction } from './prompts'
import { failureMessage, INTERRUPTED, NO_IMAGE_YET, now, UPLOAD_EXTS, type UploadExt } from './records'
import { isNotFound } from '../storage/fs-errors'

// Locations are the third twin of characters and items: the same file layout, locking and generation rules, with
// states in place of variations or usages. A change here usually belongs in item-service.ts too.

type CreatedBy = LocationState['createdBy']

/** What a location's base state is called. */
const BASE_STATE_NAME = 'Default'

/** What a location picture is drawn at: a wide room, as a landscape. */
const LOCATION_ASPECT = '4:3'

export class DuplicateLocationError extends Error {
  constructor(readonly locationName: string) {
    super(`A location named "${locationName}" already exists`)
    this.name = 'DuplicateLocationError'
  }
}

/** State names are unique per location, so a second `Night` must reuse the first instead of drawing a twin. */
export class DuplicateStateError extends Error {
  constructor(
    readonly locationName: string,
    readonly stateName: string
  ) {
    super(`${locationName} already has a state named "${stateName}": use that one`)
    this.name = 'DuplicateStateError'
  }
}

/** The location (or state) is used by panels, so it can only be archived, not deleted. */
export class LocationInUseError extends Error {
  constructor(
    readonly panelIds: string[],
    what = 'location'
  ) {
    super(`This ${what} is used by ${panelIds.length} panel(s): ${panelIds.join(', ')}. Archive it instead.`)
    this.name = 'LocationInUseError'
  }
}

/** Which panels are set in a location or one of its states. PanelService answers it. */
export interface LocationUsageLookup {
  panelsUsingLocation(ctx: ProjectContext, locationId: string): Promise<string[]>
  panelsUsingLocationState(ctx: ProjectContext, stateId: string): Promise<string[]>
}

export interface LocationServiceOptions {
  bus: EventBus
  images: ImageService
  projects: ProjectStore
  usage: LocationUsageLookup
  /** Moves a path to the OS trash. */
  trash: (absPath: string) => Promise<void>
  /** Judges each drawn picture against the layout. Without it nothing is checked and no picture is redrawn. */
  sheetChecker?: Pick<ConsistencyChecker, 'checkSheet'>
}

/** `generate: false` means no generation follows, so the new state is recorded `failed` (no picture yet). Default true. */
export interface CreateStateOptions {
  generate?: boolean
}
const LOCATION_FILE = /^loc_[A-Za-z0-9]+\.json$/

/** The status a new state starts in: `pending` when a generation follows, else failed with `NO_IMAGE_YET`. */
function initialStatus(opts: CreateStateOptions): Pick<LocationState, 'status' | 'error'> {
  return opts.generate === false ? { status: 'failed', error: NO_IMAGE_YET } : { status: 'pending', error: null }
}

export class LocationService {
  constructor(private readonly opts: LocationServiceOptions) {}

  async list(ctx: ProjectContext, opts: { includeArchived?: boolean } = {}): Promise<Location[]> {
    let names: string[]
    try {
      names = await fs.promises.readdir(ctx.paths.locationsDir())
    } catch (error) {
      if (isNotFound(error)) return []
      throw error
    }
    const out: Location[] = []
    for (const name of names) {
      if (!LOCATION_FILE.test(name)) continue
      const abs = path.join(ctx.paths.locationsDir(), name)
      try {
        // The id comes from the file name; a file holding any other id is reported and skipped.
        out.push(await readLocationFile(abs, name.slice(0, -'.json'.length)))
      } catch (error) {
        if (isNotFound(error)) continue
        const rel = ctx.paths.toRelative(abs)
        if (!ctx.problems.some((p) => p.path === rel)) ctx.problems.push({ path: rel, message: error instanceof Error ? error.message : String(error) })
      }
    }
    out.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))
    return opts.includeArchived ? out : out.filter((l) => !l.archived)
  }

  async get(ctx: ProjectContext, id: string): Promise<Location> {
    try {
      return await readLocationFile(ctx.paths.locationFile(id), id)
    } catch (error) {
      if (isNotFound(error)) throw new EntityNotFoundError('location', id)
      throw error
    }
  }

  async create(ctx: ProjectContext, input: LocationInput, createdBy: CreatedBy, opts: CreateStateOptions = {}): Promise<Location> {
    // The name check and the write share one lock so two concurrent creates cannot both pass it.
    const location = await ctx.mutex.run(ctx.paths.locationsDir(), async () => {
      await this.assertNameFree(ctx, input.name)
      const id = newId('loc')
      const at = now()
      const l = LocationSchema.parse({
        id,
        name: input.name,
        aliases: input.aliases,
        notes: input.notes,
        layout: input.layout,
        states: [{ id: newId('lst'), locationId: id, name: BASE_STATE_NAME, kind: 'base', delta: '', imagePath: null, ...initialStatus(opts), createdBy, createdAt: at }],
        archived: false,
        createdBy,
        createdAt: at,
        updatedAt: at
      })
      await ctx.mutex.run(ctx.paths.locationFile(id), () => writeJsonAtomic(ctx.paths.locationFile(id), l))
      return l
    })
    this.emit(ctx, location.id)
    return location
  }

  /** `layoutChanged` tells the caller the pictures no longer match the words, so they need redrawing. */
  async update(ctx: ProjectContext, id: string, patch: LocationPatch): Promise<{ location: Location; layoutChanged: boolean }> {
    const run = () =>
      this.mutate(ctx, id, (l) => {
        const next: Location = {
          ...l,
          name: patch.name ?? l.name,
          aliases: patch.aliases ?? l.aliases,
          notes: patch.notes ?? l.notes,
          layout: patch.layout ?? l.layout,
          updatedAt: now()
        }
        return { location: LocationSchema.parse(next), layoutChanged: next.layout !== l.layout }
      })
    // A rename must stay unique, so it takes the same lock `create` uses.
    if (patch.name === undefined) return run()
    const name = patch.name
    return ctx.mutex.run(ctx.paths.locationsDir(), async () => {
      await this.assertNameFree(ctx, name, id)
      return run()
    })
  }

  async archive(ctx: ProjectContext, id: string): Promise<void> {
    await this.mutate(ctx, id, (l) => ({ location: { ...l, archived: true, updatedAt: now() } }))
  }

  async unarchive(ctx: ProjectContext, id: string): Promise<void> {
    await ctx.mutex.run(ctx.paths.locationsDir(), async () => {
      await this.assertNameFree(ctx, (await this.get(ctx, id)).name, id)
      await this.mutate(ctx, id, (l) => ({ location: { ...l, archived: false, updatedAt: now() } }))
    })
  }

  async delete(ctx: ProjectContext, id: string): Promise<void> {
    await this.get(ctx, id)
    const panelIds = await this.opts.usage.panelsUsingLocation(ctx, id)
    if (panelIds.length > 0) throw new LocationInUseError(panelIds)
    const file = ctx.paths.locationFile(id)
    await ctx.mutex.run(file, async () => {
      await this.opts.trash(file)
      const dir = ctx.paths.locationDir(id)
      if (fs.existsSync(dir)) await this.opts.trash(dir)
    })
    this.emit(ctx, id)
  }

  async addState(ctx: ProjectContext, locationId: string, input: LocationStateInput, createdBy: CreatedBy, opts: CreateStateOptions = {}): Promise<LocationState> {
    const state: LocationState = {
      id: newId('lst'),
      locationId,
      name: input.name,
      kind: 'state',
      delta: input.delta,
      imagePath: null,
      ...initialStatus(opts),
      check: null,
      createdBy,
      createdAt: now()
    }
    // The duplicate check runs inside the location's lock, so two concurrent adds of one name cannot both pass it.
    await this.mutate(ctx, locationId, (l) => {
      const wanted = input.name.trim().toLowerCase()
      // Name the state that already exists, so the caller is pointed at the one to reuse.
      const existing = l.states.find((s) => s.name.trim().toLowerCase() === wanted)
      if (existing) throw new DuplicateStateError(l.name, existing.name)
      return { location: { ...l, states: [...l.states, state], updatedAt: now() } }
    })
    return state
  }

  /**
   * Mark pending under the lock, generate OUTSIDE it so a slow image call never holds the lock, then re-read and record the
   * outcome under the lock. Never throws for generation failures; the previous picture is kept.
   *
   * Picture check: draw, check, and redraw with the issues up to `consistencyRetries` times while the check fails.
   * Candidates stay in memory; only the last one is written, together with its check, so the state stays `pending`
   * until both are recorded.
   */
  async generateStateImage(ctx: ProjectContext, locationId: string, stateId: string, opts: { signal?: AbortSignal } = {}): Promise<LocationState> {
    const started = await this.mutate(ctx, locationId, (l) => {
      const s = findState(l, stateId)
      const pending: LocationState = { ...s, status: 'pending', error: null }
      return { location: { ...l, states: l.states.map((x) => (x.id === stateId ? pending : x)), updatedAt: now() } }
    })
    const snapshot = started.location
    const state = findState(snapshot, stateId)
    const isBase = state.kind === 'base'
    const base = snapshot.states.find((s) => s.kind === 'base')

    let result: { data: Buffer; ext: string } | null = null
    let check: CheckResult | null = null
    let failure: string | null = null
    try {
      if (!isBase && (!base || base.status !== 'ready' || !base.imagePath)) {
        failure = 'Base picture is not ready'
      } else {
        const meta = await this.opts.projects.getMeta(ctx)
        const baseRel = isBase ? null : base!.imagePath!
        let fix: string | undefined
        for (let attempt = 0; ; attempt++) {
          try {
            result = await this.draw(ctx, snapshot, state, baseRel, meta.stylePreset, fix, opts.signal)
          } catch (error) {
            // A failed first draw is the outcome; a failed redraw leaves the last candidate and its failed check to record.
            if (result === null) failure = failureMessage(error)
            break
          }
          check = await this.runSheetCheck(ctx, snapshot, state, baseRel, result.data, opts.signal)
          if (check === null || check.passed || check.skipped || attempt >= meta.consistencyRetries || opts.signal?.aborted) break
          fix = sheetFixInstruction(check.issues)
        }
      }
    } catch (error) {
      failure = failureMessage(error)
    }

    return this.finish(ctx, locationId, state, result, failure, check)
  }

  /** One image generation for the picture; `fix` is the previous check's issues, if any. */
  private draw(
    ctx: ProjectContext,
    snapshot: Location,
    state: LocationState,
    baseRel: string | null,
    stylePreset: string,
    fix: string | undefined,
    signal: AbortSignal | undefined
  ): Promise<{ data: Buffer; ext: string }> {
    return this.opts.images.generate(ctx, {
      prompt: baseRel === null ? locationReferencePrompt(snapshot, stylePreset, fix) : locationStatePrompt(snapshot, state, stylePreset, fix),
      references: baseRel === null ? [] : [{ relPath: baseRel, label: 'location base picture' }],
      aspect: LOCATION_ASPECT,
      signal
    })
  }

  /** The check of a candidate picture; null when there is no checker or it has no verdict. A throwing checker counts as no verdict. */
  private async runSheetCheck(
    ctx: ProjectContext,
    snapshot: Location,
    state: LocationState,
    baseRel: string | null,
    image: Buffer,
    signal: AbortSignal | undefined
  ): Promise<CheckResult | null> {
    if (!this.opts.sheetChecker) return null
    try {
      return await this.opts.sheetChecker.checkSheet(ctx, { image, subject: { kind: 'location', location: snapshot, state }, baseImageRelPath: baseRel, signal })
    } catch {
      return null
    }
  }

  async uploadStateImage(ctx: ProjectContext, locationId: string, stateId: string, data: Buffer, ext: UploadExt): Promise<LocationState> {
    if (!UPLOAD_EXTS.includes(ext)) throw new Error(`Unsupported image extension: ${String(ext)} (use png, jpg or webp)`)
    // No `pending` phase: the bytes are in hand, so write the file and record it in one locked step.
    // On failure the state is untouched and the caller gets the error.
    const file = ctx.paths.locationFile(locationId)
    const next = await ctx.mutex.run(file, async () => {
      const l = await this.get(ctx, locationId)
      const s = findState(l, stateId)
      const rel = imageRelPath(locationId, stateId, ext)
      const abs = ctx.paths.resolveAsset(rel)
      await writeFileAtomic(abs, data)
      const ready: LocationState = { ...s, status: 'ready', error: null, imagePath: rel, check: null }
      try {
        await writeJsonAtomic(file, { ...l, states: l.states.map((x) => (x.id === stateId ? ready : x)), updatedAt: now() })
      } catch (error) {
        await fs.promises.rm(abs, { force: true }).catch(() => undefined)
        throw error
      }
      return ready
    })
    this.emit(ctx, locationId)
    return next
  }

  async deleteState(ctx: ProjectContext, locationId: string, stateId: string): Promise<void> {
    const l = await this.get(ctx, locationId)
    const s = findState(l, stateId)
    if (s.kind === 'base') throw new Error('The base state cannot be deleted')
    const panelIds = await this.opts.usage.panelsUsingLocationState(ctx, stateId)
    if (panelIds.length > 0) throw new LocationInUseError(panelIds, 'state')
    await this.mutate(ctx, locationId, (cur) => ({ location: { ...cur, states: cur.states.filter((x) => x.id !== stateId), updatedAt: now() } }))
    const abs = s.imagePath === null ? null : ownImage(ctx, locationId, s.imagePath)
    if (abs !== null && fs.existsSync(abs)) await this.opts.trash(abs)
  }

  /** Startup repair: a generation cannot survive the app closing, so every `pending` becomes `failed`. */
  async recoverInterrupted(ctx: ProjectContext): Promise<void> {
    for (const l of await this.list(ctx, { includeArchived: true })) {
      if (!l.states.some((s) => s.status === 'pending')) continue
      try {
        await this.mutate(ctx, l.id, (cur) => ({
          location: { ...cur, states: cur.states.map((s) => (s.status === 'pending' ? { ...s, status: 'failed' as const, error: INTERRUPTED } : s)) }
        }))
      } catch (error) {
        // One unreadable or unwritable location must not block opening the project.
        if (error instanceof EntityNotFoundError) continue
        // `l.id` came from the file name (list), so this path needs no id validation that could throw.
        const rel = ctx.paths.toRelative(path.join(ctx.paths.locationsDir(), `${l.id}.json`))
        if (!ctx.problems.some((p) => p.path === rel)) ctx.problems.push({ path: rel, message: error instanceof Error ? error.message : String(error) })
      }
    }
  }

  /**
   * The last step of a generation: under the lock, record the outcome (the picture with its check) if the state still
   * exists. A failure keeps the stored picture and check. Never throws: if recording fails, the state is marked `failed`
   * (best effort; `recoverInterrupted` is the backstop for a file that cannot be written) and a `failed` state is returned.
   */
  private async finish(
    ctx: ProjectContext,
    locationId: string,
    fallback: LocationState,
    result: { data: Buffer; ext: string } | null,
    failure: string | null,
    check: CheckResult | null
  ): Promise<LocationState> {
    const file = ctx.paths.locationFile(locationId)
    const outcome = await ctx.mutex.run(file, async (): Promise<{ state: LocationState; persisted: boolean } | null> => {
      let current: Location
      try {
        current = await readLocationFile(file, locationId)
      } catch (error) {
        if (isNotFound(error)) return null
        // Corrupt or unreadable: rewriting it from our stale snapshot could destroy the user's edits.
        return { state: { ...fallback, status: 'failed', error: failureMessage(error) }, persisted: false }
      }
      const existing = current.states.find((s) => s.id === fallback.id)
      if (!existing) return null
      const save = (s: LocationState): Promise<void> =>
        writeJsonAtomic(file, { ...current, states: current.states.map((x) => (x.id === s.id ? s : x)), updatedAt: now() })
      let imageAbs: string | null = null
      try {
        let next: LocationState
        if (result && failure === null) {
          const rel = imageRelPath(locationId, fallback.id, result.ext)
          imageAbs = ctx.paths.resolveAsset(rel)
          await writeFileAtomic(imageAbs, result.data)
          next = { ...existing, status: 'ready', error: null, imagePath: rel, check }
        } else {
          next = { ...existing, status: 'failed', error: failure ?? 'Image generation failed' }
        }
        await save(next)
        return { state: next, persisted: true }
      } catch (error) {
        // The image file is not referenced by anything yet, so it would be an orphan.
        if (imageAbs) await fs.promises.rm(imageAbs, { force: true }).catch(() => undefined)
        const failed: LocationState = { ...existing, status: 'failed', error: failureMessage(error) }
        try {
          await save(failed)
          return { state: failed, persisted: true }
        } catch {
          return { state: failed, persisted: false }
        }
      }
    })
    if (!outcome) return { ...fallback, status: 'failed', error: 'State was deleted' }
    if (outcome.persisted) this.emit(ctx, locationId)
    return outcome.state
  }

  private async mutate<R extends { location: Location }>(ctx: ProjectContext, id: string, fn: (l: Location) => R): Promise<R> {
    const file = ctx.paths.locationFile(id)
    const out = await ctx.mutex.run(file, async () => {
      const current = await this.get(ctx, id)
      const r = fn(current)
      await writeJsonAtomic(file, r.location)
      return r
    })
    this.emit(ctx, id)
    return out
  }

  private async assertNameFree(ctx: ProjectContext, name: string, exceptId?: string): Promise<void> {
    const wanted = name.trim().toLowerCase()
    const clash = (await this.list(ctx)).find((l) => l.id !== exceptId && l.name.trim().toLowerCase() === wanted)
    if (clash) throw new DuplicateLocationError(name)
  }

  private emit(ctx: ProjectContext, locationId: string): void {
    this.opts.bus.emit({ type: 'location.changed', projectId: ctx.id, locationId })
  }
}

/** Reads a location file and checks that it holds the id its file name says. */
async function readLocationFile(file: string, id: string): Promise<Location> {
  const location = await readJson(file, LocationSchema)
  if (location.id !== id) throw new CorruptFileError(file, `holds location id ${JSON.stringify(location.id)}, which does not match its file name`)
  return location
}

function findState(l: Location, stateId: string): LocationState {
  const s = l.states.find((x) => x.id === stateId)
  if (!s) throw new EntityNotFoundError('state', stateId)
  return s
}

/**
 * The picture's absolute path when it lies inside the location's own folder, else null. A hand-edited path can name
 * anything in the project (another location's picture, an upload, a folder): deleting a state must never trash that.
 */
function ownImage(ctx: ProjectContext, locationId: string, relPath: string): string | null {
  try {
    const abs = ctx.paths.resolveAsset(relPath)
    return isInside(ctx.paths.locationDir(locationId), abs) ? abs : null
  } catch (error) {
    if (error instanceof PathEscapeError) return null
    throw error
  }
}

function imageRelPath(locationId: string, stateId: string, ext: string): string {
  return `locations/${locationId}/${stateId}_${randomBytes(3).toString('hex')}.${ext}`
}
