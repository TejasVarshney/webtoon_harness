import fs from 'node:fs'
import path from 'node:path'
import { newId } from '@shared/ids'
import { ProjectMetaSchema } from '@shared/schemas'
import type { ProjectMeta, ProjectProblem } from '@shared/types'
import { EntityNotFoundError } from '../domain/errors'
import type { EventBus } from '../events/bus'
import { readJson, writeJsonAtomic } from './atomic'
import { KeyedMutex } from './mutex'
import { ProjectPaths } from './project-paths'

/**
 * What every service needs to work inside one project. `mutex` is the single lock for the whole
 * project (key it by the absolute path a `ProjectPaths` method returns), so there must only ever be
 * one context per project id: the store hands out the same object from `create` and `open`.
 */
export interface ProjectContext {
  id: string
  paths: ProjectPaths
  mutex: KeyedMutex
  /**
   * Files that failed to load (corrupt JSON, schema mismatch), as project-relative POSIX paths.
   * Mutable on purpose: services append to it when they meet a bad file, and the project still opens.
   */
  problems: ProjectProblem[]
}

export interface ProjectHooks {
  /** Runs once, right after a new project's folder and `project.json` exist (seed the per-project agent docs here). */
  onCreate?: (ctx: ProjectContext) => Promise<void>
  /** Runs the first time this store instance opens a project, before `open` resolves. */
  onOpen?: (ctx: ProjectContext) => Promise<void>
}

type Hook = (ctx: ProjectContext) => Promise<void>

export interface ProjectStoreOptions {
  projectsRoot: string
  bus: EventBus
}

export interface ProjectInput {
  title: string
  logline?: string
  stylePreset?: string
}

/** The fields a caller may change; `id`, `createdAt` and `updatedAt` are the store's. */
const PATCHABLE_FIELDS = ['title', 'logline', 'stylePreset', 'storyMode', 'defaultAspect', 'autopilotPanels', 'consistencyRetries'] as const

export type ProjectMetaPatch = Partial<Pick<ProjectMeta, (typeof PATCHABLE_FIELDS)[number]>>

/** Subfolders created with every project (spec §5); `project.json` is written separately. */
const PROJECT_SUBDIRS = ['story', 'characters', 'episodes', 'panels', 'sessions', 'uploads', 'agent'] as const

const PROJECT_FILE = 'project.json'

/**
 * Lowercase only: the id is a folder name, and `webtoon-asset://` hosts are lowercased by Chromium.
 * It also keeps `..`, separators and drive letters out of the path built from it.
 */
const PROJECT_ID = /^prj_[a-z0-9]+$/

function isNotFound(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code: unknown }).code : undefined
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/**
 * The set of projects under one projects root. Each project lives in `<projectsRoot>/<projectId>/`
 * (spec §5). The store owns project creation, discovery, per-project contexts and `project.json`.
 */
export class ProjectStore {
  private readonly projectsRoot: string
  private readonly bus: EventBus
  private readonly createHooks: Hook[] = []
  private readonly openHooks: Hook[] = []
  /** The one context per project id. */
  private readonly contexts = new Map<string, ProjectContext>()
  /** In-flight and finished opens, so concurrent callers share one open and the hooks run once. */
  private readonly opens = new Map<string, Promise<ProjectContext>>()
  private lastIssued = 0

  constructor(options: ProjectStoreOptions) {
    this.projectsRoot = path.resolve(options.projectsRoot)
    this.bus = options.bus
  }

  /** Hooks accumulate across calls and run in registration order. They do not run retroactively. */
  addHooks(hooks: ProjectHooks): void {
    if (hooks.onCreate) this.createHooks.push(hooks.onCreate)
    if (hooks.onOpen) this.openHooks.push(hooks.onOpen)
  }

  /**
   * Every project under the root, newest `updatedAt` first. A folder with no `project.json` is not
   * a project and is skipped. One whose `project.json` is unreadable, corrupt, or names a different
   * id than its folder is reported in `problems` (`path` is `<folder>/project.json`, relative to the
   * projects root, because the list spans projects) and never fails the whole listing.
   */
  async list(): Promise<{ projects: ProjectMeta[]; problems: ProjectProblem[] }> {
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(this.projectsRoot, { withFileTypes: true })
    } catch (error) {
      if (isNotFound(error)) return { projects: [], problems: [] }
      throw error
    }

    const projects: ProjectMeta[] = []
    const problems: ProjectProblem[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const relPath = `${entry.name}/${PROJECT_FILE}`
      try {
        const meta = await readJson(path.join(this.projectsRoot, entry.name, PROJECT_FILE), ProjectMetaSchema)
        if (meta.id === entry.name) projects.push(meta)
        else problems.push({ path: relPath, message: `project.json has id ${meta.id}, which does not match its folder name ${entry.name}` })
      } catch (error) {
        if (isNotFound(error)) continue
        problems.push({ path: relPath, message: error instanceof Error ? error.message : String(error) })
      }
    }

    projects.sort((a, b) => (a.updatedAt !== b.updatedAt ? (a.updatedAt < b.updatedAt ? 1 : -1) : a.id < b.id ? -1 : 1))
    return { projects, problems }
  }

  /** Creates the project's folders and `project.json`, then runs the `onCreate` hooks and emits `project.changed`. */
  async create(input: ProjectInput): Promise<ProjectContext> {
    const id = newId('prj')
    const now = this.nextTimestamp()
    // `undefined` for logline / stylePreset lets the schema fill its defaults.
    const meta = ProjectMetaSchema.parse({ id, title: input.title, logline: input.logline, stylePreset: input.stylePreset, createdAt: now, updatedAt: now })

    const ctx = this.newContext(id)
    for (const dir of PROJECT_SUBDIRS) await fs.promises.mkdir(ctx.paths.resolveAsset(dir), { recursive: true })
    // Last, so a half-created project (no project.json) is invisible to `list`.
    await ctx.mutex.run(ctx.paths.projectFile(), () => writeJsonAtomic(ctx.paths.projectFile(), meta))

    this.contexts.set(id, ctx)
    for (const hook of this.createHooks) await hook(ctx)
    this.bus.emit({ type: 'project.changed', projectId: id })
    return ctx
  }

  /**
   * The project's context, the same object on every call (and the one `create` returned). The first
   * open per id runs the `onOpen` hooks; concurrent opens share it, and a failed open is not cached.
   * Throws `EntityNotFoundError('project', id)` for a malformed id or a folder without `project.json`,
   * and `CorruptFileError` if `project.json` is unreadable.
   */
  open(projectId: string): Promise<ProjectContext> {
    let attempt = this.opens.get(projectId)
    if (!attempt) {
      const started = this.openFirstTime(projectId)
      attempt = started
      this.opens.set(projectId, started)
      started.catch(() => {
        if (this.opens.get(projectId) === started) this.opens.delete(projectId)
      })
    }
    return attempt
  }

  async getMeta(ctx: ProjectContext): Promise<ProjectMeta> {
    return readJson(ctx.paths.projectFile(), ProjectMetaSchema)
  }

  /** Merges the patch into `project.json`, bumps `updatedAt`, then emits `project.changed`. A value the schema rejects is not written. */
  async updateMeta(ctx: ProjectContext, patch: ProjectMetaPatch): Promise<ProjectMeta> {
    const file = ctx.paths.projectFile()
    const updated = await ctx.mutex.run(file, async () => {
      const current = await readJson(file, ProjectMetaSchema)
      // Only the named fields, and never `undefined`: a defaulted field set to undefined would be reset to its default.
      const changes: Record<string, unknown> = {}
      for (const field of PATCHABLE_FIELDS) {
        if (patch[field] !== undefined) changes[field] = patch[field]
      }
      const next = ProjectMetaSchema.parse({ ...current, ...changes, updatedAt: this.nextTimestamp() })
      await writeJsonAtomic(file, next)
      return next
    })
    this.bus.emit({ type: 'project.changed', projectId: ctx.id })
    return updated
  }

  private async openFirstTime(projectId: string): Promise<ProjectContext> {
    if (!PROJECT_ID.test(projectId)) throw new EntityNotFoundError('project', projectId)
    const ctx = this.contexts.get(projectId) ?? this.newContext(projectId)
    try {
      await readJson(ctx.paths.projectFile(), ProjectMetaSchema)
    } catch (error) {
      if (isNotFound(error)) throw new EntityNotFoundError('project', projectId)
      throw error
    }
    this.contexts.set(projectId, ctx)
    for (const hook of this.openHooks) await hook(ctx)
    return ctx
  }

  private newContext(id: string): ProjectContext {
    return { id, paths: new ProjectPaths(path.join(this.projectsRoot, id)), mutex: new KeyedMutex(), problems: [] }
  }

  /** Strictly increasing within this process, so two projects made in the same millisecond still sort in creation order. */
  private nextTimestamp(): string {
    this.lastIssued = Math.max(Date.now(), this.lastIssued + 1)
    return new Date(this.lastIssued).toISOString()
  }
}
