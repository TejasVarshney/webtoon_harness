import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@shared/types'
import { EntityNotFoundError } from '../domain/errors'
import { tempProject, type TempProject } from '../test/temp-project'
import { SessionStore } from './session-store'

let t: TempProject
let trash: ReturnType<typeof vi.fn<(p: string) => Promise<void>>>
let sessions: SessionStore

beforeEach(async () => {
  t = await tempProject()
  trash = vi.fn(async (p: string) => {
    await fs.promises.rm(p)
  })
  sessions = new SessionStore(t.bus, trash)
})
afterEach(() => t.cleanup())

let n = 0
function userMsg(text: string): ChatMessage {
  n++
  return { id: `msg_${String(n).padStart(10, '0')}`, role: 'user', text, imagePaths: [], stateSnapshot: null, createdAt: new Date(Date.now() + n).toISOString() }
}

describe('SessionStore', () => {
  it('creates, auto-titles, lists newest first', async () => {
    const { ctx } = t
    const a = await sessions.create(ctx)
    const b = await sessions.create(ctx)
    expect(a.id).toMatch(/^ses_[0-9a-f]{10}$/)
    await sessions.append(ctx, a.id, [userMsg('Create a cyberpunk heroine named Mina with silver hair\nand a red jacket please')])
    const list = await sessions.list(ctx)
    expect(list[0].id).toBe(a.id)
    expect(list[0].title).toBe('Create a cyberpunk heroine named Mina with silver hair and a')
    expect(list[0].title).toHaveLength(60)
    expect(list[0].messageCount).toBe(1)
    expect(list[1].id).toBe(b.id)
    expect(list[1].title).toBe('New session')
  })

  it('does not retitle once titled', async () => {
    const { ctx } = t
    const a = await sessions.create(ctx)
    await sessions.append(ctx, a.id, [userMsg('first')])
    await sessions.append(ctx, a.id, [userMsg('second')])
    expect((await sessions.list(ctx))[0].title).toBe('first')
  })

  it('loads messages in order and survives a truncated last line', async () => {
    const { ctx } = t
    const s = await sessions.create(ctx)
    const m1 = userMsg('one')
    const m2 = userMsg('two')
    await sessions.append(ctx, s.id, [m1])
    await sessions.append(ctx, s.id, [m2])
    await fs.promises.appendFile(ctx.paths.sessionFile(s.id), '{"type":"mess', 'utf8')
    expect((await sessions.load(ctx, s.id)).map((m) => m.id)).toEqual([m1.id, m2.id])
    const m3 = userMsg('three')
    await sessions.append(ctx, s.id, [m3])
    expect((await sessions.load(ctx, s.id)).map((m) => m.id)).toEqual([m1.id, m2.id, m3.id])
  })

  it('rename persists for a new store instance', async () => {
    const { ctx } = t
    const s = await sessions.create(ctx)
    await sessions.rename(ctx, s.id, 'My chat')
    const fresh = new SessionStore(t.bus, trash)
    expect((await fresh.list(ctx))[0].title).toBe('My chat')
  })

  it('delete sends the file to trash and emits', async () => {
    const { ctx } = t
    const s = await sessions.create(ctx)
    t.events.length = 0
    await sessions.delete(ctx, s.id)
    expect(trash).toHaveBeenCalledWith(ctx.paths.sessionFile(s.id))
    expect(t.events).toContainEqual({ type: 'session.changed', projectId: ctx.id, sessionId: s.id })
    expect(await sessions.list(ctx)).toEqual([])
  })

  it('emits session.changed on create, append and rename', async () => {
    const { ctx } = t
    t.events.length = 0
    const s = await sessions.create(ctx)
    await sessions.append(ctx, s.id, [userMsg('x')])
    await sessions.rename(ctx, s.id, 'y')
    expect(t.events.filter((e) => e.type === 'session.changed')).toHaveLength(3)
  })

  it('throws EntityNotFoundError for an unknown session and does not create a file', async () => {
    const { ctx } = t
    const id = 'ses_0000000000'
    await expect(sessions.load(ctx, id)).rejects.toThrow(EntityNotFoundError)
    await expect(sessions.append(ctx, id, [userMsg('x')])).rejects.toThrow('Unknown session: ses_0000000000')
    await expect(sessions.rename(ctx, id, 't')).rejects.toThrow(EntityNotFoundError)
    await expect(sessions.delete(ctx, id)).rejects.toThrow(EntityNotFoundError)
    expect(fs.existsSync(ctx.paths.sessionFile(id))).toBe(false)
  })

  it('list skips non-jsonl files and reports a file without meta as a problem', async () => {
    const { ctx } = t
    const s = await sessions.create(ctx)
    await fs.promises.writeFile(`${ctx.paths.sessionsDir()}/notes.txt`, 'hi')
    await fs.promises.writeFile(`${ctx.paths.sessionsDir()}/ses_bad0000000.jsonl`, 'garbage\n')
    const list = await sessions.list(ctx)
    expect(list.map((x) => x.id)).toEqual([s.id])
    expect(ctx.problems.map((p) => p.path)).toEqual(['sessions/ses_bad0000000.jsonl'])
  })

  it('serializes concurrent appends without losing messages', async () => {
    const { ctx } = t
    const s = await sessions.create(ctx)
    await Promise.all(Array.from({ length: 10 }, (_, i) => sessions.append(ctx, s.id, [userMsg(`m${i}`)])))
    expect(await sessions.load(ctx, s.id)).toHaveLength(10)
  })
})
