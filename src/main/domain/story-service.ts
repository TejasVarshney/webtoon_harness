import fs from 'node:fs'
import { newId } from '@shared/ids'
import { BeatSchema, OutlineSchema } from '@shared/schemas'
import type { Beat, BeatPatch, ProjectMeta, StoryMode } from '@shared/types'
import type { EventBus } from '../events/bus'
import { readJson, stripBom, writeFileAtomic, writeJsonAtomic } from '../storage/atomic'
import { isNotFound } from '../storage/fs-errors'
import type { ProjectContext, ProjectStore } from '../storage/project-store'
import { CorruptFileError, EntityNotFoundError } from './errors'
import { checkedHeading, listSections, upsertMarkdownSection } from './markdown-sections'

/** The sections a new story bible starts with (spec §10). */
export const BIBLE_SECTIONS = ['Premise', 'World', 'Tone', 'Characters & Relationships', 'Arcs', 'Open Threads'] as const

export const BIBLE_TEMPLATE = `# Story Bible\n\n${BIBLE_SECTIONS.map((name) => `## ${name}\n`).join('\n')}`

export interface StoryServiceOptions {
  bus: EventBus
  projects: ProjectStore
}

export type StoryView = {
  mode: StoryMode
  bible: string
  beats: Beat[]
}

/** What reading `story/outline.json` found. `corrupt` is set when the file is there but unusable; its beats are then []. */
interface OutlineRead {
  beats: Beat[]
  corrupt: CorruptFileError | null
}

const now = (): string => new Date().toISOString()

/**
 * The story bible (`story/bible.md`), the beat outline (`story/outline.json`) and the story mode (a
 * `project.json` field, so that goes through the ProjectStore).
 *
 * Locking: each file is read, created when missing and written inside `ctx.mutex.run(<its path>)`, so the
 * first-access template can never overwrite a write that raced it. The two locks are never held together,
 * and nothing here takes another service's lock. Reads and writes are atomic renames, so a crash leaves the
 * previous file. A corrupt outline is reported in `ctx.problems` and never replaced: only the user may repair it.
 */
export class StoryService {
  constructor(private readonly opts: StoryServiceOptions) {}

  /**
   * The mode, the bible and the beats (those of `episodeId` when given, else all, in the order they were added).
   * The first call in a project creates the bible template and an empty outline. It announces nothing, even then:
   * what it returns is what it wrote, and a reload triggered by it would only read it again.
   */
  async get(ctx: ProjectContext, episodeId?: string): Promise<StoryView> {
    const meta = await this.opts.projects.getMeta(ctx)
    const bible = await ctx.mutex.run(ctx.paths.storyBible(), () => this.bibleLocked(ctx))
    const outline = await ctx.mutex.run(ctx.paths.storyOutline(), () => this.outlineLocked(ctx))
    const beats = episodeId === undefined ? outline.beats : outline.beats.filter((b) => b.episodeId === episodeId)
    return { mode: meta.storyMode, bible, beats }
  }

  /** Persists the mode in `project.json` (announced as `project.changed`) and announces `story.changed` too. */
  async setMode(ctx: ProjectContext, mode: StoryMode): Promise<ProjectMeta> {
    const meta = await this.opts.projects.updateMeta(ctx, { storyMode: mode })
    this.emit(ctx)
    return meta
  }

  /**
   * Replaces the body of one `## <section>` (case-insensitive) or appends the section. Returns the new bible.
   * Content may not contain `## ` headings of its own: they would split the section; `### ` is fine.
   */
  async updateBibleSection(ctx: ProjectContext, section: string, content: string): Promise<string> {
    const heading = checkedHeading(section)
    if (listSections(content).length > 0) {
      throw new Error('Section content cannot contain "## " headings, since they would start new sections. Use "### " for sub-headings.')
    }
    const file = ctx.paths.storyBible()
    const { bible, changed } = await ctx.mutex.run(file, async () => {
      const current = await this.bibleLocked(ctx)
      const next = upsertMarkdownSection(current, heading, content)
      if (next === current) return { bible: current, changed: false }
      await writeFileAtomic(file, next)
      return { bible: next, changed: true }
    })
    if (changed) this.emit(ctx)
    return bible
  }

  /** The UI editor's save: the whole bible, exactly as typed. */
  async replaceBible(ctx: ProjectContext, markdown: string): Promise<void> {
    const file = ctx.paths.storyBible()
    await ctx.mutex.run(file, () => writeFileAtomic(file, markdown))
    this.emit(ctx)
  }

  /** Adds planned beats to an episode, in order. Blank summaries are refused before anything is written. */
  async addBeats(ctx: ProjectContext, episodeId: string, summaries: string[]): Promise<Beat[]> {
    const cleaned = summaries.map((summary) => summary.trim())
    if (cleaned.some((summary) => summary === '')) throw new Error('A beat summary cannot be empty')
    if (cleaned.length === 0) return []
    const createdAt = now()
    const created = cleaned.map((summary) => BeatSchema.parse({ id: newId('bt'), episodeId, summary, status: 'planned', createdAt }))
    await this.mutateOutline(ctx, (beats) => ({ beats: [...beats, ...created], result: created }))
    this.emit(ctx)
    return created
  }

  /** Changes a beat's summary and/or status. An empty patch changes and announces nothing. */
  async updateBeat(ctx: ProjectContext, beatId: string, patch: BeatPatch): Promise<Beat> {
    const summary = patch.summary?.trim()
    if (summary === '') throw new Error('A beat summary cannot be empty')
    const { beat, changed } = await this.mutateOutline(ctx, (beats) => {
      const index = beats.findIndex((b) => b.id === beatId)
      if (index < 0) throw new EntityNotFoundError('beat', beatId)
      const current = beats[index]
      const next = BeatSchema.parse({ ...current, summary: summary ?? current.summary, status: patch.status ?? current.status })
      if (next.summary === current.summary && next.status === current.status) return { beats: null, result: { beat: current, changed: false } }
      return { beats: beats.map((b, i) => (i === index ? next : b)), result: { beat: next, changed: true } }
    })
    if (changed) this.emit(ctx)
    return beat
  }

  /**
   * Read-modify-write of the outline under its lock. `fn` returns the new beat list (null for "no change") and what
   * to hand back. A corrupt outline throws its CorruptFileError before `fn` runs: it must not be overwritten.
   */
  private mutateOutline<R>(ctx: ProjectContext, fn: (beats: Beat[]) => { beats: Beat[] | null; result: R }): Promise<R> {
    const file = ctx.paths.storyOutline()
    return ctx.mutex.run(file, async () => {
      const outline = await this.outlineLocked(ctx)
      if (outline.corrupt) throw outline.corrupt
      const out = fn(outline.beats)
      if (out.beats) await writeJsonAtomic(file, OutlineSchema.parse({ beats: out.beats }))
      return out.result
    })
  }

  /** The bible, creating the template when there is none. The caller holds the bible lock. */
  private async bibleLocked(ctx: ProjectContext): Promise<string> {
    const file = ctx.paths.storyBible()
    try {
      return stripBom(await fs.promises.readFile(file, 'utf8'))
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
    await writeFileAtomic(file, BIBLE_TEMPLATE)
    return BIBLE_TEMPLATE
  }

  /** The outline, creating `{beats: []}` when there is none. The caller holds the outline lock. */
  private async outlineLocked(ctx: ProjectContext): Promise<OutlineRead> {
    const file = ctx.paths.storyOutline()
    try {
      return { beats: (await readJson(file, OutlineSchema)).beats, corrupt: null }
    } catch (error) {
      if (error instanceof CorruptFileError) {
        const rel = ctx.paths.toRelative(file)
        if (!ctx.problems.some((p) => p.path === rel)) ctx.problems.push({ path: rel, message: error.message })
        return { beats: [], corrupt: error }
      }
      if (!isNotFound(error)) throw error
    }
    await writeJsonAtomic(file, { beats: [] })
    return { beats: [], corrupt: null }
  }

  private emit(ctx: ProjectContext): void {
    this.opts.bus.emit({ type: 'story.changed', projectId: ctx.id })
  }
}
