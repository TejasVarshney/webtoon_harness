import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { AgentEvent, ChatMessage } from '@shared/types'
import { MockTextProvider, resetMockScripts } from '../models/providers/mock'
import { ProviderError, type TextProvider, type TextTurnResult } from '../models/providers/types'
import { runAgentLoop } from './loop'
import { ToolRegistry, defineTool, type ToolContext } from './tools/registry'

type ToolMessage = Extract<ChatMessage, { role: 'tool' }>

let dir: string
let n = 0
beforeEach(() => {
  resetMockScripts()
  dir = mkdtempSync(join(tmpdir(), 'loop-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function script(turns: unknown[]): MockTextProvider {
  const p = join(dir, `s${n++}.json`)
  writeFileSync(p, JSON.stringify({ turns }))
  return new MockTextProvider(p)
}

const user: ChatMessage = {
  id: 'msg_0000000001',
  role: 'user',
  text: 'hi',
  imagePaths: [],
  stateSnapshot: null,
  createdAt: '2026-01-01T00:00:00.000Z'
}

function setup(
  provider: TextProvider,
  tools: ToolRegistry,
  extra: { signal?: AbortSignal; maxSteps?: number; persist?: (m: ChatMessage[]) => Promise<void> } = {}
) {
  const persisted: ChatMessage[] = []
  const events: AgentEvent[] = []
  const opts = {
    runId: 'run_0000000001',
    provider,
    system: 'sys',
    history: [user],
    tools,
    toolCtx: { project: {}, services: {}, threadKey: 't' } as unknown as Omit<ToolContext, 'signal'>,
    model: { endpointId: 'end_0000000000', modelId: 'mdl_000000000a' },
    loadImage: async () => ({ mime: 'image/png', base64: '' }),
    signal: extra.signal ?? new AbortController().signal,
    maxSteps: extra.maxSteps,
    persist:
      extra.persist ??
      (async (m: ChatMessage[]) => {
        persisted.push(...m)
      }),
    emit: (e: AgentEvent) => {
      events.push(e)
    }
  }
  return { opts, persisted, events }
}

const echo = defineTool({ name: 'echo', description: 'e', input: z.object({ s: z.string() }), handler: async ({ s }) => ({ content: s }) })
const reg = () => new ToolRegistry([echo])
const call = { name: 'echo', input: { s: 'x' } }

describe('runAgentLoop', () => {
  it('runs tool then finishes', async () => {
    const { opts, persisted, events } = setup(script([{ text: 'calling', toolCalls: [call] }, { text: 'done' }]), reg())
    const res = await runAgentLoop(opts)
    expect(res).toEqual({ outcome: 'end', error: null })
    expect(persisted.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant'])
    const kinds = events.map((e) => e.kind)
    expect(kinds).toContain('tool-started')
    expect(kinds.filter((k) => k === 'run-finished')).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({ kind: 'run-finished', outcome: 'end', error: null })
    expect(events.filter((e) => e.kind === 'message')).toHaveLength(3)
    expect(persisted[0]).toMatchObject({
      role: 'assistant',
      stopReason: 'tool_use',
      model: { endpointId: 'end_0000000000', modelId: 'mdl_000000000a' }
    })
  })

  it('stops at maxSteps', async () => {
    const { opts, persisted } = setup(script([{ toolCalls: [call] }, { toolCalls: [call] }, { toolCalls: [call] }]), reg(), { maxSteps: 2 })
    const res = await runAgentLoop(opts)
    expect(res.outcome).toBe('max_steps')
    expect(persisted.map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant', 'tool'])
  })

  it('cancel during tool execution leaves a result for every tool call (Review Focus 1)', async () => {
    const ctrl = new AbortController()
    const aborter = defineTool({
      name: 'abort',
      description: 'a',
      input: z.object({}),
      handler: async (_i, ctx) => {
        expect(ctx.signal).toBe(ctrl.signal)
        ctrl.abort()
        return { content: 'ran' }
      }
    })
    const c = { name: 'abort', input: {} }
    const { opts, persisted, events } = setup(script([{ toolCalls: [c, c, c] }]), new ToolRegistry([aborter]), { signal: ctrl.signal })
    const { outcome } = await runAgentLoop(opts)
    const tool = persisted.find((m) => m.role === 'tool') as ToolMessage
    expect(outcome).toBe('cancelled')
    expect(tool.results.map((r) => r.toolCallId)).toEqual(['mock_call_1', 'mock_call_2', 'mock_call_3'])
    expect(tool.results[0]).toMatchObject({ ok: true, content: 'ran' })
    expect(tool.results.slice(1).every((r) => !r.ok && r.content === 'Cancelled by user')).toBe(true)
    expect(events.filter((e) => e.kind === 'tool-started')).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({ kind: 'run-finished', outcome: 'cancelled' })
  })

  it('cancels when aborted before the turn or while the provider is in flight, persisting nothing', async () => {
    const pre = new AbortController()
    pre.abort()
    const a = setup(script([{ text: 'x' }]), reg(), { signal: pre.signal })
    expect((await runAgentLoop(a.opts)).outcome).toBe('cancelled')
    expect(a.persisted).toEqual([])

    const ctrl = new AbortController()
    const slow: TextProvider = {
      runTurn: (req) =>
        new Promise((_res, rej) => {
          req.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))
          ctrl.abort()
        })
    }
    const b = setup(slow, reg(), { signal: ctrl.signal })
    expect((await runAgentLoop(b.opts)).outcome).toBe('cancelled')
    expect(b.persisted).toEqual([])
    expect(b.events.at(-1)).toMatchObject({ kind: 'run-finished', outcome: 'cancelled' })
  })

  it('reports provider errors and refusals', async () => {
    const rl: TextProvider = {
      runTurn: async () => {
        throw new ProviderError('rate_limit', 'rate limited')
      }
    }
    const a = setup(rl, reg())
    expect(await runAgentLoop(a.opts)).toEqual({ outcome: 'error', error: 'rate limited' })
    expect(a.events.at(-1)).toMatchObject({ kind: 'run-finished', outcome: 'error', error: 'rate limited' })

    const odd: TextProvider = {
      runTurn: async () => {
        throw new TypeError('boom')
      }
    }
    expect(await runAgentLoop(setup(odd, reg()).opts)).toEqual({ outcome: 'error', error: 'boom' })

    const turn = (stopReason: TextTurnResult['stopReason']): TextProvider => ({
      runTurn: async () => ({ text: 'no', toolCalls: [], stopReason, raw: null })
    })
    const r = setup(turn('refusal'), reg())
    expect(await runAgentLoop(r.opts)).toEqual({ outcome: 'refusal', error: 'The model declined this request.' })
    expect(r.persisted.map((m) => m.role)).toEqual(['assistant'])
    expect(await runAgentLoop(setup(turn('max_tokens'), reg()).opts)).toEqual({ outcome: 'max_tokens', error: null })
  })

  it('returns error (and still finishes the run) when persist throws', async () => {
    const { opts, events } = setup(script([{ text: 'x' }]), reg(), {
      persist: async () => {
        throw new Error('disk full')
      }
    })
    expect(await runAgentLoop(opts)).toEqual({ outcome: 'error', error: 'disk full' })
    expect(events.filter((e) => e.kind === 'run-finished')).toHaveLength(1)
  })

  it('a tool that throws becomes an ok:false result and the loop continues', async () => {
    const bad = defineTool({
      name: 'bad',
      description: 'b',
      input: z.object({}),
      handler: async () => {
        throw new Error('nope')
      }
    })
    const { opts, persisted } = setup(script([{ toolCalls: [{ name: 'bad', input: {} }] }, { text: 'ok' }]), new ToolRegistry([bad]))
    expect((await runAgentLoop(opts)).outcome).toBe('end')
    expect((persisted[1] as ToolMessage).results[0]).toMatchObject({ ok: false, content: 'nope' })
  })
})
