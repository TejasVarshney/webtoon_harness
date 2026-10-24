import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AgentEvent, AppEvent, PanelDraft } from '@shared/types'
import { AnthropicTextProvider, type AnthropicClientLike, type AnthropicRequestParams, type AnthropicStreamLike } from '../models/providers/anthropic'
import { MockTextProvider, resetMockScripts } from '../models/providers/mock'
import { encodeSolidPng } from '../models/providers/png'
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

  it('puts the active roster, not archived characters, in the state snapshot', async () => {
    const { s, runner, projectId, sessionId, events } = await setup([{ text: 'ok' }])
    const ctx = await s.projects.open(projectId)
    const mina = await s.characters.create(ctx, { name: 'Mina', role: 'protagonist', appearanceLock: 'LOCK' }, 'user')
    const jun = await s.characters.create(ctx, { name: 'Jun', role: 'supporting', appearanceLock: 'LOCK' }, 'user')
    await s.characters.archive(ctx, jun.id)
    await runner.start(input(projectId, sessionId))
    await finished(events)
    const user = (await s.sessions.load(ctx, sessionId))[0] as { stateSnapshot: string }
    expect(user.stateSnapshot).toContain(`- ${mina.id} Mina [protagonist] variations: ${mina.variations[0].id} Base (pending)`)
    expect(user.stateSnapshot).not.toContain('Jun')
  })

  describe('state snapshot: current episode and recent panels', () => {
    async function snapshotOf(h: Awaited<ReturnType<typeof setup>>, activeEpisodeId: string | null = null): Promise<string> {
      const runner = new AgentRunner({ services: h.s, createTextProvider: () => new MockTextProvider(script([{ text: 'ok' }])) })
      await runner.start({ ...input(h.projectId, h.sessionId), activeEpisodeId })
      await finished(h.events)
      const ctx = await h.s.projects.open(h.projectId)
      const users = (await h.s.sessions.load(ctx, h.sessionId)).filter((m) => m.role === 'user')
      return (users[users.length - 1] as { stateSnapshot: string }).stateSnapshot
    }
    const panelDraft = (episodeId: string, description: string, o: Partial<PanelDraft> = {}): PanelDraft => ({
      episodeId,
      description,
      setting: 'Hall',
      shot: 'medium',
      characters: [],
      dialogue: [],
      ...o
    })
    const AI = { createdBy: 'ai' as const, strictMentions: true }

    it('names Episode 1 (created on demand) and has no recent panels in a new project', async () => {
      const h = await setup([])
      const ctx = await h.s.projects.open(h.projectId)
      const snapshot = await snapshotOf(h)
      const [episode] = await h.s.episodes.list(ctx)
      expect(snapshot).toContain(`current_episode: ${episode.id} "Episode 1" (0 panels)`)
      expect(snapshot).toContain('recent_panels: none')
    })

    it('uses the active episode when it exists, otherwise the first episode', async () => {
      const h = await setup([])
      const ctx = await h.s.projects.open(h.projectId)
      const [first] = await h.s.episodes.list(ctx)
      const second = await h.s.episodes.create(ctx, { title: 'The Letter' })
      await h.s.panels.create(ctx, panelDraft(second.id, 'A letter on the mat.'), AI)

      expect(await snapshotOf(h, second.id)).toContain(`current_episode: ${second.id} "The Letter" (1 panels)`)
      h.events.length = 0
      // A stale or made-up id from the renderer must not fail the run: it falls back to the first episode.
      expect(await snapshotOf(h, 'epi_ffffffffff')).toContain(`current_episode: ${first.id} "Episode 1" (0 panels)`)
    })

    it('lists the last 3 panels of the active episode in order, naming speakers even when archived', async () => {
      const h = await setup([])
      const ctx = await h.s.projects.open(h.projectId)
      const [episode] = await h.s.episodes.list(ctx)
      const mina = await h.s.characters.create(ctx, { name: 'Mina', role: 'protagonist', appearanceLock: 'LOCK' }, 'user')
      await h.s.characters.generateVariationImage(ctx, mina.id, mina.variations[0].id)
      const variationId = mina.variations[0].id
      for (let i = 0; i < 4; i++) await h.s.panels.create(ctx, panelDraft(episode.id, `Beat ${i}`), AI)
      const last = await h.s.panels.create(
        ctx,
        panelDraft(episode.id, 'Beat 4', {
          shot: 'close-up',
          characters: [{ characterId: mina.id, variationId, action: '', expression: '', position: 'center' }],
          dialogue: [{ speakerId: mina.id, kind: 'speech', text: 'Hello?' }, { speakerId: null, kind: 'narration', text: 'Silence.' }]
        }),
        AI
      )
      await h.s.characters.archive(ctx, mina.id)

      const snapshot = await snapshotOf(h, episode.id)
      expect(snapshot).toContain(`current_episode: ${episode.id} "Episode 1" (5 panels)`)
      const ids = (await h.s.episodes.get(ctx, episode.id)).panelIds
      expect(snapshot).toContain(
        [
          'recent_panels:',
          `- ${ids[2]} [medium] cast: none | Beat 2 | dialogue: none`,
          `- ${ids[3]} [medium] cast: none | Beat 3 | dialogue: none`,
          `- ${last.panel.id} [close-up] cast: Mina (${variationId}) | Beat 4 | dialogue: Mina: "Hello?" / narration: "Silence."`
        ].join('\n')
      )
      expect(snapshot).not.toContain('Beat 1')
      // Archived characters stay out of the roster even though they still name the speakers above.
      expect(snapshot).not.toContain(`- ${mina.id}`)
    })
  })

  it('lets a scripted agent draw into the current episode, the next message after it created a character', async () => {
    const { s, runner, projectId, sessionId, events } = await setup([
      { toolCalls: [{ name: 'create_character', input: { name: 'Mina', role: 'protagonist', appearanceLock: 'LOCK' } }] },
      { text: 'Mina is ready.' },
      {
        toolCalls: [
          {
            name: 'create_panel',
            input: {
              episodeId: { $episode: 'current' },
              description: 'Mina opens the door.',
              setting: 'Hallway',
              shot: 'medium',
              characters: [{ characterId: { $character: 'Mina' }, variationId: { $variation: ['Mina', 'Base'] } }],
              dialogue: []
            }
          }
        ]
      },
      { text: 'Drawn.' }
    ])
    await runner.start(input(projectId, sessionId))
    await finished(events)
    events.length = 0
    await new Promise((r) => setTimeout(r, 10))
    await runner.start(input(projectId, sessionId, 'Draw the first panel'))
    await finished(events)

    const ctx = await s.projects.open(projectId)
    const [episode] = await s.episodes.list(ctx)
    const panels = await s.panels.list(ctx, episode.id)
    expect(panels).toMatchObject([{ description: 'Mina opens the door.', createdBy: 'ai', versions: [{ status: 'ready' }] }])
    const results = (await s.sessions.load(ctx, sessionId)).flatMap((m) => (m.role === 'tool' ? m.results : []))
    expect(results.map((r) => [r.name, r.ok])).toEqual([
      ['create_character', true],
      ['create_panel', true]
    ])
    expect(JSON.parse(results[1].content)).toMatchObject({ panelId: panels[0].id, status: 'ready' })
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

  it('keeps a session usable after an attached image is deleted (C1, with a provider that loads images)', async () => {
    const { s, projectId, sessionId, events } = await setup([])
    const ctx = await s.projects.open(projectId)
    await fs.promises.writeFile(ctx.paths.resolveAsset('uploads/pic.png'), encodeSolidPng(2, 2, [1, 2, 3]))
    const requests: AnthropicRequestParams[] = []
    const stream = (): AnthropicStreamLike => {
      const st: AnthropicStreamLike = { on: () => st, finalMessage: async () => ({ content: [{ type: 'text', text: 'seen' }], stop_reason: 'end_turn' }) }
      return st
    }
    const client: AnthropicClientLike = {
      messages: { stream: (params) => (requests.push(structuredClone(params)), stream()) },
      beta: { messages: { stream: (params) => (requests.push(structuredClone(params)), stream()) } }
    }
    const real = new AgentRunner({ services: s, createTextProvider: (r) => new AnthropicTextProvider(r, client) })

    await real.start({ ...input(projectId, sessionId, 'look at this'), imagePaths: ['uploads/pic.png'] })
    await finished(events)
    expect(JSON.stringify(requests[0].messages)).toContain('"type":"image"')

    await fs.promises.rm(ctx.paths.resolveAsset('uploads/pic.png'))
    events.length = 0
    await real.start(input(projectId, sessionId, 'and again'))
    await finished(events)
    expect(events.at(-1)).toMatchObject({ kind: 'run-finished', outcome: 'end', error: null })
    expect(requests).toHaveLength(2)
    expect(requests[1].messages[0].content).toContainEqual({ type: 'text', text: '[image no longer available: uploads/pic.png]' })
  })

  it('rejects an unknown session without leaving the slot busy', async () => {
    const { runner, projectId } = await setup([])
    await expect(runner.start(input(projectId, 'ses_doesnotexist'))).rejects.toThrow(/Unknown session/)
    expect(runner.isRunning('ses_doesnotexist')).toBe(false)
  })
})
