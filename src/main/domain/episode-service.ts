import fs from 'node:fs'
import path from 'node:path'
import { newId } from '@shared/ids'
import { EpisodeSchema } from '@shared/schemas'
import type { Episode } from '@shared/types'
import type { EventBus } from '../events/bus'
import { readJson, writeJsonAtomic } from '../storage/atomic'
import type { ProjectContext } from '../storage/project-store'
import { EntityNotFoundError } from './errors'

const EPISODE_FILE = /^epi_[A-Za-z0-9]+\.json$/

function isNotFound(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code: unknown }).code : undefined
  return code === 'ENOENT' || code === 'ENOTDIR'
}

const now = (): string => new Date().toISOString()

/**
 * Episodes and their ordered panel ids (`episodes/<epiId>.json`). Locking: creating an episode (and
 * the automatic Episode 1) takes the `episodes/` folder lock so numbers are unique; every change to
 * one episode takes that episode's file lock. The folder lock is only ever taken before a file lock,
 * never the other way round, and no method here touches a panel file.
 */
export class EpisodeService {
  constructor(private readonly opts: { bus: EventBus }) {}

  /**
   * Episodes in number order. A project with no episode files at all gets `Episode 1`. A folder whose
   * only files are unreadable is NOT given a fresh Episode 1: that file is reported in
   * `ctx.problems`, and inventing a second Episode 1 beside it could duplicate one that is merely locked.
   */
  async list(ctx: ProjectContext): Promise<Episode[]> {
    const found = await this.readAll(ctx)
    if (found.fileCount > 0) return found.episodes
    // The re-check inside the lock keeps concurrent lists (and a racing `create`) from making two.
    const created = await ctx.mutex.run(ctx.paths.episodesDir(), async () => {
      if ((await this.readAll(ctx)).fileCount > 0) return null
      return this.write(ctx, 1, 'Episode 1', '')
    })
    if (created) this.emit(ctx, created.id)
    return (await this.readAll(ctx)).episodes
  }

  async get(ctx: ProjectContext, id: string): Promise<Episode> {
    try {
      return await readJson(ctx.paths.episodeFile(id), EpisodeSchema)
    } catch (error) {
      if (isNotFound(error)) throw new EntityNotFoundError('episode', id)
      throw error
    }
  }

  /** Takes the next free number (highest existing + 1). */
  async create(ctx: ProjectContext, input: { title: string; synopsis?: string }): Promise<Episode> {
    const episode = await ctx.mutex.run(ctx.paths.episodesDir(), async () => {
      const { episodes } = await this.readAll(ctx)
      const number = episodes.reduce((max, e) => Math.max(max, e.number), 0) + 1
      return this.write(ctx, number, input.title, input.synopsis ?? '')
    })
    this.emit(ctx, episode.id)
    return episode
  }

  update(ctx: ProjectContext, id: string, patch: { title?: string; synopsis?: string }): Promise<Episode> {
    return this.mutate(ctx, id, (e) => ({ ...e, title: patch.title ?? e.title, synopsis: patch.synopsis ?? e.synopsis, updatedAt: now() }))
  }

  /**
   * `afterPanelId` undefined appends, null inserts at the start, an id inserts right after that
   * panel. Throws for an anchor that is not in the episode and for a panel that already is.
   */
  insertPanel(ctx: ProjectContext, episodeId: string, panelId: string, afterPanelId: string | null | undefined): Promise<Episode> {
    return this.mutate(ctx, episodeId, (e) => {
      if (e.panelIds.includes(panelId)) throw new Error(`Panel ${panelId} is already in episode ${episodeId}`)
      let index = e.panelIds.length
      if (afterPanelId === null) index = 0
      else if (afterPanelId !== undefined) {
        const anchor = e.panelIds.indexOf(afterPanelId)
        if (anchor < 0) throw new EntityNotFoundError('panel', afterPanelId)
        index = anchor + 1
      }
      return { ...e, panelIds: [...e.panelIds.slice(0, index), panelId, ...e.panelIds.slice(index)], updatedAt: now() }
    })
  }

  /** A panel that is not in the episode is left alone: nothing is written and nothing is announced. */
  removePanel(ctx: ProjectContext, episodeId: string, panelId: string): Promise<Episode> {
    return this.mutate(ctx, episodeId, (e) => (e.panelIds.includes(panelId) ? { ...e, panelIds: e.panelIds.filter((id) => id !== panelId), updatedAt: now() } : null))
  }

  /** `toIndex` is clamped to the episode's range. */
  movePanel(ctx: ProjectContext, episodeId: string, panelId: string, toIndex: number): Promise<Episode> {
    return this.mutate(ctx, episodeId, (e) => {
      if (!e.panelIds.includes(panelId)) throw new EntityNotFoundError('panel', panelId)
      const rest = e.panelIds.filter((id) => id !== panelId)
      const index = Math.min(Math.max(Math.trunc(toIndex), 0), rest.length)
      return { ...e, panelIds: [...rest.slice(0, index), panelId, ...rest.slice(index)], updatedAt: now() }
    })
  }

  /** Read-modify-write of one episode under its file lock. `fn` returning null means "no change". */
  private async mutate(ctx: ProjectContext, id: string, fn: (e: Episode) => Episode | null): Promise<Episode> {
    const file = ctx.paths.episodeFile(id)
    const { episode, changed } = await ctx.mutex.run(file, async () => {
      const current = await this.get(ctx, id)
      const next = fn(current)
      if (!next) return { episode: current, changed: false }
      const valid = EpisodeSchema.parse(next)
      await writeJsonAtomic(file, valid)
      return { episode: valid, changed: true }
    })
    if (changed) this.emit(ctx, id)
    return episode
  }

  private async write(ctx: ProjectContext, number: number, title: string, synopsis: string): Promise<Episode> {
    const id = newId('epi')
    const at = now()
    const episode = EpisodeSchema.parse({ id, number, title, synopsis, panelIds: [], createdAt: at, updatedAt: at })
    await ctx.mutex.run(ctx.paths.episodeFile(id), () => writeJsonAtomic(ctx.paths.episodeFile(id), episode))
    return episode
  }

  /** Every readable episode in number order. `fileCount` counts episode files, readable or not. */
  private async readAll(ctx: ProjectContext): Promise<{ episodes: Episode[]; fileCount: number }> {
    let names: string[]
    try {
      names = await fs.promises.readdir(ctx.paths.episodesDir())
    } catch (error) {
      if (isNotFound(error)) return { episodes: [], fileCount: 0 }
      throw error
    }
    const files = names.filter((name) => EPISODE_FILE.test(name))
    const episodes: Episode[] = []
    for (const name of files) {
      const abs = path.join(ctx.paths.episodesDir(), name)
      try {
        episodes.push(await readJson(abs, EpisodeSchema))
      } catch (error) {
        if (isNotFound(error)) continue
        const rel = ctx.paths.toRelative(abs)
        if (!ctx.problems.some((p) => p.path === rel)) ctx.problems.push({ path: rel, message: error instanceof Error ? error.message : String(error) })
      }
    }
    episodes.sort((a, b) => a.number - b.number || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1))
    return { episodes, fileCount: files.length }
  }

  private emit(ctx: ProjectContext, episodeId: string): void {
    this.opts.bus.emit({ type: 'episode.changed', projectId: ctx.id, episodeId })
  }
}
