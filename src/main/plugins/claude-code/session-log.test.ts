import fs from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEvent, ToolCall, ToolResult } from '@shared/types'
import { SessionStore } from '../../sessions/session-store'
import { tempProject, type TempProject } from '../../test/temp-project'
import { DriverSessionLog } from './session-log'

let t: TempProject
let sessions: SessionStore
let log: DriverSessionLog

beforeEach(async () => {
  t = await tempProject()
  sessions = new SessionStore(t.bus, async () => {})
  log = new DriverSessionLog({ sessions, bus: t.bus })
})
afterEach(() => t.cleanup())

const call = (id: string, name = 'list_characters'): ToolCall => ({ id, name, input: { a: 1 } })
const result = (toolCallId: string, name = 'list_characters'): ToolResult => ({ toolCallId, name, ok: true, content: 'done', images: [] })

describe('DriverSessionLog', () => {
  it('creates one "Claude Code" driver session on first resolve and reuses it', async () => {
    const first = await log.resolve(t.ctx, 'mcp-1', null)
    const second = await log.resolve(t.ctx, 'mcp-1', null)
    expect(second).toBe(first)
    const list = await sessions.list(t.ctx)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: first, title: 'Claude Code', driver: 'claude-code' })
  })

  it('does not create two sessions for concurrent first resolves', async () => {
    const [a, b] = await Promise.all([log.resolve(t.ctx, 'mcp-1', null), log.resolve(t.ctx, 'mcp-1', null)])
    expect(a).toBe(b)
    expect(await sessions.list(t.ctx)).toHaveLength(1)
  })

  it('returns a requested session of the project and creates nothing', async () => {
    const own = await sessions.create(t.ctx, { title: 'Mine' })
    expect(await log.resolve(t.ctx, 'mcp-1', own.id)).toBe(own.id)
    expect(await sessions.list(t.ctx)).toHaveLength(1)
  })

  it('falls back to a driver session when the requested id is unknown', async () => {
    const id = await log.resolve(t.ctx, 'mcp-1', 'ses_0000000000')
    expect(id).not.toBe('ses_0000000000')
    const list = await sessions.list(t.ctx)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id, driver: 'claude-code' })
  })

  it('does not accept a session of another project as requested', async () => {
    const other = await t.store.create({ title: 'Other' })
    const foreign = await sessions.create(other, { title: 'Foreign' })
    const id = await log.resolve(t.ctx, 'mcp-1', foreign.id)
    expect(id).not.toBe(foreign.id)
    expect((await sessions.list(t.ctx)).map((s) => s.id)).toEqual([id])
  })

  it('starts a new log session when the project changes under the same MCP session', async () => {
    const other = await t.store.create({ title: 'Other' })
    const a = await log.resolve(t.ctx, 'mcp-1', null)
    const b = await log.resolve(other, 'mcp-1', null)
    expect(b).not.toBe(a)
    expect((await sessions.list(other)).map((s) => s.id)).toEqual([b])
    expect(await log.resolve(t.ctx, 'mcp-1', null)).toBe(a)
  })

  it('logs two MCP sessions separately', async () => {
    const a = await log.resolve(t.ctx, 'mcp-1', null)
    const b = await log.resolve(t.ctx, 'mcp-2', null)
    expect(b).not.toBe(a)
    await log.recordCall(t.ctx, a, call('call_a'))
    await log.recordResult(t.ctx, a, result('call_a'))
    await log.recordCall(t.ctx, b, call('call_b'))
    const inA = await sessions.load(t.ctx, a)
    const inB = await sessions.load(t.ctx, b)
    expect(inA).toHaveLength(2)
    expect(inB).toHaveLength(1)
    expect(inB[0]).toMatchObject({ role: 'assistant', toolCalls: [{ id: 'call_b' }] })
  })

  it('records a call and its result as chat messages and emits matching events', async () => {
    const id = await log.resolve(t.ctx, 'mcp-1', null)
    t.events.length = 0
    await log.recordCall(t.ctx, id, call('call_1'))
    await log.recordResult(t.ctx, id, result('call_1'))

    const messages = await sessions.load(t.ctx, id)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({
      role: 'assistant',
      text: '',
      toolCalls: [call('call_1')],
      stopReason: 'tool_use',
      model: { endpointId: 'plugin:claude-code', modelId: 'claude-code' },
      raw: null
    })
    expect(messages[1]).toMatchObject({ role: 'tool', results: [result('call_1')] })

    const agentEvents = t.events.filter((e): e is Extract<AppEvent, { type: 'agent.event' }> => e.type === 'agent.event')
    expect(agentEvents.map((e) => e.event.kind)).toEqual(['tool-started', 'message', 'message'])
    for (const e of agentEvents) {
      expect(e.projectId).toBe(t.ctx.id)
      expect(e.threadKey).toBe(id)
    }
    expect(agentEvents[0].event).toMatchObject({ kind: 'tool-started', toolCall: call('call_1') })
    expect(agentEvents[1].event).toMatchObject({ kind: 'message', message: messages[0] })
    expect(agentEvents[2].event).toMatchObject({ kind: 'message', message: messages[1] })
    const runIds = new Set(agentEvents.map((e) => ('runId' in e.event ? e.event.runId : '')))
    expect(runIds.size).toBe(1)
    expect([...runIds][0]).toMatch(/^run_[0-9a-f]{10}$/)
    expect(t.events.some((e) => e.type === 'session.changed' && e.sessionId === id)).toBe(true)
  })

  it('uses one runId for every call of an MCP session', async () => {
    const id = await log.resolve(t.ctx, 'mcp-1', null)
    t.events.length = 0
    await log.recordCall(t.ctx, id, call('call_1'))
    await log.recordCall(t.ctx, id, call('call_2'))
    const runIds = new Set(t.events.flatMap((e) => (e.type === 'agent.event' && 'runId' in e.event ? [e.event.runId] : [])))
    expect(runIds.size).toBe(1)
  })

  it('keeps going and exposes the first error when a write fails', async () => {
    const id = await log.resolve(t.ctx, 'mcp-1', null)
    expect(log.lastError()).toBeNull()
    vi.spyOn(sessions, 'append').mockRejectedValue(new Error('disk full'))
    t.events.length = 0
    await expect(log.recordCall(t.ctx, id, call('call_1'))).resolves.toBeUndefined()
    await expect(log.recordResult(t.ctx, id, result('call_1'))).resolves.toBeUndefined()
    expect(log.lastError()).toBe('disk full')
    expect(t.events.filter((e) => e.type === 'agent.event')).toEqual([])
  })

  it('still returns a session id when the driver session cannot be created', async () => {
    vi.spyOn(sessions, 'create').mockRejectedValueOnce(new Error('read-only'))
    const id = await log.resolve(t.ctx, 'mcp-1', null)
    expect(id).toMatch(/^ses_[0-9a-f]{10}$/)
    expect(log.lastError()).toBe('read-only')
    await expect(log.recordCall(t.ctx, id, call('call_1'))).resolves.toBeUndefined()
    // The failure is not cached: the next resolve retries and succeeds.
    const retry = await log.resolve(t.ctx, 'mcp-1', null)
    expect((await sessions.list(t.ctx)).map((s) => s.id)).toEqual([retry])
  })

  it('makes a fresh driver session once the cached one turns out to be deleted', async () => {
    const first = await log.resolve(t.ctx, 'mcp-1', null)
    // What the trash does when the user deletes the session in the app.
    await fs.promises.rm(t.ctx.paths.sessionFile(first))
    await log.recordCall(t.ctx, first, call('call_1'))
    const second = await log.resolve(t.ctx, 'mcp-1', null)
    expect(second).not.toBe(first)
    expect((await sessions.list(t.ctx)).map((s) => s.id)).toEqual([second])
    await log.recordCall(t.ctx, second, call('call_2'))
    expect(await sessions.load(t.ctx, second)).toHaveLength(1)
  })

  it('keeps the cached driver session when a write fails for another reason', async () => {
    const first = await log.resolve(t.ctx, 'mcp-1', null)
    vi.spyOn(sessions, 'append').mockRejectedValueOnce(new Error('disk full'))
    await log.recordCall(t.ctx, first, call('call_1'))
    expect(await log.resolve(t.ctx, 'mcp-1', null)).toBe(first)
  })

  it('forget drops the reuse mapping', async () => {
    const a = await log.resolve(t.ctx, 'mcp-1', null)
    log.forget('mcp-1')
    const b = await log.resolve(t.ctx, 'mcp-1', null)
    expect(b).not.toBe(a)
  })
})
