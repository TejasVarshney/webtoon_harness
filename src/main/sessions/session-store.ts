import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { newId } from '@shared/ids'
import { ChatMessageSchema } from '@shared/schemas'
import type { ChatMessage, SessionSummary } from '@shared/types'
import { EntityNotFoundError } from '../domain/errors'
import type { EventBus } from '../events/bus'
import { appendJsonl, readJsonl } from '../storage/jsonl'
import type { ProjectContext } from '../storage/project-store'
import { isNotFound } from '../storage/fs-errors'

const DEFAULT_TITLE = 'New session'
const TITLE_MAX = 60

const MetaRecord = z.object({
  type: z.literal('meta'),
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  driver: z.enum(['claude-code']).nullable().optional()
})
const TitleRecord = z.object({ type: z.literal('title'), title: z.string(), at: z.string() })
const MessageRecord = z.object({ type: z.literal('message'), message: ChatMessageSchema })
/** The Claude Code session this chat continues (`--resume`); the last one wins, and '' clears it. */
const LinkRecord = z.object({ type: z.literal('link'), claudeSessionId: z.string(), at: z.string() })
/** Pins the whole session to the top of the list; the last one wins. */
const BookmarkRecord = z.object({ type: z.literal('bookmark'), bookmarked: z.boolean(), at: z.string() })
const RecordSchema = z.discriminatedUnion('type', [MetaRecord, TitleRecord, MessageRecord, LinkRecord, BookmarkRecord])
type SessionRecord = z.infer<typeof RecordSchema>

function summarize(records: SessionRecord[]): SessionSummary | null {
  const meta = records.find((r): r is z.infer<typeof MetaRecord> => r.type === 'meta')
  if (!meta) return null
  let title = meta.title
  let updatedAt = meta.createdAt
  let messageCount = 0
  let claudeSessionId: string | null = null
  let bookmarked = false
  for (const record of records) {
    if (record.type === 'title') {
      title = record.title
      updatedAt = record.at
    } else if (record.type === 'message') {
      messageCount++
      updatedAt = record.message.createdAt
    } else if (record.type === 'link') {
      claudeSessionId = record.claudeSessionId === '' ? null : record.claudeSessionId
    } else if (record.type === 'bookmark') {
      bookmarked = record.bookmarked
    }
  }
  return { id: meta.id, title, createdAt: meta.createdAt, updatedAt, messageCount, driver: meta.driver ?? null, claudeSessionId, bookmarked }
}

/** Chat transcripts, one JSONL file per session under `sessions/`. */
export class SessionStore {
  constructor(
    private readonly bus: EventBus,
    private readonly trash: (absPath: string) => Promise<void>
  ) {}

  /** Newest `updatedAt` first. Non-`.jsonl` files are ignored; an unreadable session is reported in `ctx.problems`. */
  async list(ctx: ProjectContext): Promise<SessionSummary[]> {
    let names: string[]
    try {
      names = await fs.promises.readdir(ctx.paths.sessionsDir())
    } catch (error) {
      if (isNotFound(error)) return []
      throw error
    }
    const summaries: SessionSummary[] = []
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue
      const abs = path.join(ctx.paths.sessionsDir(), name)
      const rel = ctx.paths.toRelative(abs)
      try {
        const { records } = await readJsonl(abs, RecordSchema)
        const summary = summarize(records)
        if (summary) summaries.push(summary)
        else this.report(ctx, rel, 'Session file has no readable meta record')
      } catch (error) {
        if (isNotFound(error)) continue
        this.report(ctx, rel, error instanceof Error ? error.message : String(error))
      }
    }
    return summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
  }

  /** `driver` marks a session written by something other than the in-app chat (e.g. Claude Code over MCP). */
  async create(ctx: ProjectContext, opts: { title?: string; driver?: 'claude-code' | null } = {}): Promise<SessionSummary> {
    const id = newId('ses')
    const createdAt = new Date().toISOString()
    const title = opts.title ?? DEFAULT_TITLE
    const driver = opts.driver ?? null
    const file = ctx.paths.sessionFile(id)
    await ctx.mutex.run(file, () => appendJsonl(file, [{ type: 'meta', id, title, createdAt, driver }]))
    this.emit(ctx, id)
    return { id, title, createdAt, updatedAt: createdAt, messageCount: 0, driver, claudeSessionId: null, bookmarked: false }
  }

  async load(ctx: ProjectContext, sessionId: string): Promise<ChatMessage[]> {
    const { records } = await this.read(ctx, sessionId)
    return records.flatMap((r) => (r.type === 'message' ? [r.message] : []))
  }

  async append(ctx: ProjectContext, sessionId: string, messages: ChatMessage[]): Promise<void> {
    if (messages.length === 0) return
    const file = ctx.paths.sessionFile(sessionId)
    await ctx.mutex.run(file, async () => {
      const { records } = await this.read(ctx, sessionId)
      const out: unknown[] = messages.map((message) => ({ type: 'message', message }))
      const summary = summarize(records)
      if (summary?.title === DEFAULT_TITLE) {
        const first = messages.find((m) => m.role === 'user')
        const title = first && first.role === 'user' ? first.text.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX) : ''
        if (title !== '') out.push({ type: 'title', title, at: new Date().toISOString() })
      }
      await appendJsonl(file, out)
    })
    this.emit(ctx, sessionId)
  }

  async rename(ctx: ProjectContext, sessionId: string, title: string): Promise<void> {
    const file = ctx.paths.sessionFile(sessionId)
    await ctx.mutex.run(file, async () => {
      await this.read(ctx, sessionId)
      await appendJsonl(file, [{ type: 'title', title, at: new Date().toISOString() }])
    })
    this.emit(ctx, sessionId)
  }

  /** Records the Claude Code session id the next run resumes ('' forgets it). Does not change `updatedAt`. */
  async setClaudeSessionId(ctx: ProjectContext, sessionId: string, claudeSessionId: string): Promise<void> {
    const file = ctx.paths.sessionFile(sessionId)
    await ctx.mutex.run(file, async () => {
      await this.read(ctx, sessionId)
      await appendJsonl(file, [{ type: 'link', claudeSessionId, at: new Date().toISOString() }])
    })
    this.emit(ctx, sessionId)
  }

  /** Pins or unpins a session. Like the Claude Code link, it does not change `updatedAt`. */
  async setBookmarked(ctx: ProjectContext, sessionId: string, bookmarked: boolean): Promise<void> {
    const file = ctx.paths.sessionFile(sessionId)
    await ctx.mutex.run(file, async () => {
      await this.read(ctx, sessionId)
      await appendJsonl(file, [{ type: 'bookmark', bookmarked, at: new Date().toISOString() }])
    })
    this.emit(ctx, sessionId)
  }

  async delete(ctx: ProjectContext, sessionId: string): Promise<void> {
    const file = ctx.paths.sessionFile(sessionId)
    await ctx.mutex.run(file, async () => {
      await this.read(ctx, sessionId)
      await this.trash(file)
    })
    this.emit(ctx, sessionId)
  }

  private async read(ctx: ProjectContext, sessionId: string): Promise<{ records: SessionRecord[]; skipped: number }> {
    try {
      return await readJsonl(ctx.paths.sessionFile(sessionId), RecordSchema)
    } catch (error) {
      if (isNotFound(error)) throw new EntityNotFoundError('session', sessionId)
      throw error
    }
  }

  private report(ctx: ProjectContext, path: string, message: string): void {
    if (!ctx.problems.some((p) => p.path === path)) ctx.problems.push({ path, message })
  }

  private emit(ctx: ProjectContext, sessionId: string): void {
    this.bus.emit({ type: 'session.changed', projectId: ctx.id, sessionId })
  }
}
