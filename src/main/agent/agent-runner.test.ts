import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentEvent, AppEvent } from '@shared/types'
import { MockTextProvider, resetMockScripts } from '../models/providers/mock'
import type { TextProvider } from '../models/providers/types'
import { testServices, type TestServices } from '../test/test-services'
import { AgentRunner, SessionBusyError } from './agent-runner'

let s: TestServices | undefined
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-script-'))
let n = 0
beforeEach(() => resetMockScripts())
afterEach(async () => {
  s?.agent.cancelAll()
  await s?.cleanup()
  s = undefined
})

function script(turns: unknown[]): string {
  const p = path.join(dir, `script-${n++}.json`)
  fs.writeFileSync(p, JSON.stringify({ turns }))
  return p
}

/** Blocks until aborted, then rejects the way a real provider does. */
const hangingProvider: TextProvider = {
  runTurn: (req) =>
    new Promise((_, reject) => {
      req.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })
}

async function setup(turns: unknown[]) {
  s = await testServices()
  const ctx = await s.projects.create({ title: 'Moon Diary' })
  const ses = await s.sessions.create(ctx)
  const events: AgentEvent[] = []
  s.bus.subscribe((e: AppEvent) => {
    if (e.type === 'agent.event') events.push(e.event)
  })
  const p = script(turns)
  const runner = new AgentRunner({ services: s, createTextProvider: () => new MockTextProvider(p) })
  return { s, runner, projectId: ctx.id, sessionId: ses.id, events }
}

function finished(events: AgentEvent[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const tick = (): void => {
      if (events.some((e) => e.kind === 'run-finished')) return resolve()
      if (Date.now() - t0 > 5000) return reject(new Error('timeout waiting for run-finished'))
      setTimeout(tick, 5)
    }
    tick()
  })
}

const input = (projectId: string, sessionId: string, text = 'Hi') => ({ projectId, sessionId, text, imagePaths: [], activeEpisodeId: null })

describe('AgentRunner', () => {
  it('persists the user message with snapshot and replies', async () => {
    const { s, runner, projectId, sessionId, events } = await setup([{ text: 'Hello from mock' }])
    const { runId } = await runner.start(input(projectId, sessionId))
    expect(runId).toMatch(/^run_/)
    await finished(events)
    const msgs = await s.sessions.load(await s.projects.open(projectId), sessionId)
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toMatchObject({ role: 'user', text: 'Hi' })
    expect((msgs[0] as { stateSnapshot: string }).stateSnapshot.startsWith('<project_state>')).toBe(true)
    expect(msgs[1]).toMatchObject({ role: 'assistant', text: 'Hello from mock' })
    expect(events.map((e) => e.kind)).toEqual(['run-started', 'text-delta', 'message', 'run-finished'])
    expect(events.at(-1)).toMatchObject({ kind: 'run-finished', outcome: 'end', error: null })
    await new Promise((r) => setTimeout(r, 10))
    expect(runner.isRunning(sessionId)).toBe(false)
  })

  it('rejects a second run on a busy session', async () => {
    const { runner, projectId, sessionId, events } = await setup([{ text: 'one' }, { text: 'two' }])
    const first = runner.start(input(projectId, sessionId))
    const second = runner.start(input(projectId, sessionId))
    await expect(second).rejects.toBeInstanceOf(SessionBusyError)
    await first
    await finished(events)
  })

  it('reports a missing agent model (Review Focus 3)', async () => {
    const { s, runner, projectId, sessionId, events } = await setup([{ text: 'x' }])
    await s.registry.removeModel('mdl_000000000a')
    const { runId } = await runner.start(input(projectId, sessionId))
    expect(runId).toMatch(/^run_/)
    expect(events).toEqual([{ kind: 'run-finished', runId, outcome: 'error', error: "No model assigned to role 'agent'. Open Settings → Models." }])
    const msgs = await s.sessions.load(await s.projects.open(projectId), sessionId)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('user')
    expect(runner.isRunning(sessionId)).toBe(false)
  })

  it('cancel aborts a running run; cancel of an unknown id is a no-op', async () => {
    const { s, projectId, sessionId, events } = await setup([])
    const slow = new AgentRunner({ services: s, createTextProvider: () => hangingProvider })
    slow.cancel('run_unknown')
    const { runId } = await slow.start(input(projectId, sessionId))
    expect(slow.isRunning(sessionId)).toBe(true)
    slow.cancel(runId)
    await finished(events)
    expect(events.at(-1)).toMatchObject({ outcome: 'cancelled' })
    await new Promise((r) => setTimeout(r, 10))
    expect(slow.isRunning(sessionId)).toBe(false)
  })

  it('cancelAll aborts every run', async () => {
    const { s, projectId, sessionId, events } = await setup([])
    const slow = new AgentRunner({ services: s, createTextProvider: () => hangingProvider })
    await slow.start(input(projectId, sessionId))
    slow.cancelAll()
    await finished(events)
    expect(events.at(-1)).toMatchObject({ outcome: 'cancelled' })
  })

  it('rejects an unknown session without leaving the slot busy', async () => {
    const { runner, projectId } = await setup([])
    await expect(runner.start(input(projectId, 'ses_doesnotexist'))).rejects.toThrow(/Unknown session/)
    expect(runner.isRunning('ses_doesnotexist')).toBe(false)
  })
})
