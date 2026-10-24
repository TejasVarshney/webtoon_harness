import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AppEvent, Panel, PanelDraft, ToolMessage, UserMessage } from '@shared/types'
import { MockTextProvider, resetMockScripts } from '../models/providers/mock'
import { encodeSolidPng } from '../models/providers/png'
import type { TextProvider, TextTurnRequest } from '../models/providers/types'
import { testServices, type TestServices } from '../test/test-services'
import { SessionBusyError } from './agent-runner'
import { PanelChatRunner } from './panel-chat'

const PNG = encodeSolidPng(2, 3, [9, 9, 9])
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-chat-script-'))
let n = 0
let s: TestServices | undefined
const runners: PanelChatRunner[] = []
const keys: string[] = []

beforeEach(() => resetMockScripts())
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
afterEach(async () => {
  vi.restoreAllMocks()
  for (const runner of runners) runner.cancelAll()
  // Loops persist results for their pending tool calls after an abort; let them finish before the folder goes.
  const t0 = Date.now()
  while (runners.some((r) => keys.some((k) => r.isRunning(k))) && Date.now() - t0 < 3000) await new Promise((r) => setTimeout(r, 10))
  runners.length = 0
  keys.length = 0
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

/** Answers "ok" to everything and remembers what it was asked. */
function recorder(): TextProvider & { requests: TextTurnRequest[] } {
  const requests: TextTurnRequest[] = []
  return {
    requests,
    runTurn: async (req) => {
      requests.push(req)
      return { text: 'ok', toolCalls: [], stopReason: 'end', raw: null }
    }
  }
}

type Provider = () => TextProvider

async function setup(turns: unknown[] = [], provider?: Provider) {
  s = await testServices({ trash: (p) => fs.promises.rm(p, { recursive: true, force: true }) })
  const services = s
  const ctx = await services.projects.create({ title: 'Moon Diary' })
  const [episode] = await services.episodes.list(ctx)
  const made = await services.characters.create(ctx, { name: 'Mina', role: 'protagonist', appearanceLock: 'Mina LOCK' }, 'user')
  await services.characters.generateVariationImage(ctx, made.id, made.variations[0].id)
  const mina = await services.characters.get(ctx, made.id)
  const cast = [{ characterId: mina.id, variationId: mina.variations[0].id, action: '', expression: '', position: 'center' as const }]
  async function drawn(description: string, o: Partial<PanelDraft> = {}): Promise<Panel> {
    const { panel } = await services.panels.create(ctx, { episodeId: episode.id, description, setting: 'Hall', shot: 'medium', characters: cast, dialogue: [], ...o }, { createdBy: 'ai', strictMentions: true })
    await services.panels.generate(ctx, panel.id)
    return services.panels.get(ctx, panel.id)
  }
  const p1 = await drawn('Mina waits.')
  const p2 = await drawn('Mina opens the door.')
  const p3 = await drawn('Mina steps outside.')

  const events: { threadKey: string; event: AgentEvent }[] = []
  services.bus.subscribe((e: AppEvent) => {
    if (e.type === 'agent.event') events.push({ threadKey: e.threadKey, event: e.event })
  })
  const scripted = script(turns)
  const runner = new PanelChatRunner({ services, createTextProvider: provider ? () => provider() : () => new MockTextProvider(scripted) })
  runners.push(runner)
  const start = (panelId: string, text = 'Make her smile') => {
    keys.push(`panel:${panelId}`)
    return runner.start({ projectId: ctx.id, panelId, text })
  }
  const eventsOf = (panelId: string): AgentEvent[] => events.filter((e) => e.threadKey === `panel:${panelId}`).map((e) => e.event)
  return { s: services, ctx, projectId: ctx.id, runner, start, events, eventsOf, mina, p1, p2, p3 }
}

function finished(eventsOf: () => AgentEvent[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const tick = (): void => {
      if (eventsOf().some((e) => e.kind === 'run-finished')) return resolve()
      if (Date.now() - t0 > 5000) return reject(new Error('timeout waiting for run-finished'))
      setTimeout(tick, 5)
    }
    tick()
  })
}

describe('PanelChatRunner', () => {
  it('stores the thread per panel with a panel_context snapshot', async () => {
    const { runner, ctx, s, start, eventsOf, projectId, p1, p2, p3 } = await setup([{ text: 'Looks good.' }])
    const { runId } = await start(p2.id)
    expect(runId).toMatch(/^run_/)
    await finished(() => eventsOf(p2.id))

    const file = ctx.paths.panelChatFile(p2.id)
    expect(file.replace(/\\/g, '/')).toMatch(/\/panels\/pnl_[0-9a-f]{10}\.chat\.jsonl$/)
    expect(fs.existsSync(file)).toBe(true)
    const msgs = await runner.load(ctx, p2.id)
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toMatchObject({ role: 'user', text: 'Make her smile', imagePaths: [] })
    const snapshot = (msgs[0] as UserMessage).stateSnapshot!
    expect(snapshot.startsWith('<panel_context>')).toBe(true)
    expect(snapshot.trimEnd().endsWith('</panel_context>')).toBe(true)
    expect(snapshot).toContain(`panel: ${p2.id}`)
    expect(snapshot).toContain('version: v1 of 1')
    expect(snapshot).toContain('cast: Mina (Base)')
    expect(snapshot).toContain(`previous: ${p1.id}`)
    expect(snapshot).toContain(`next: ${p3.id}`)
    expect(msgs[1]).toMatchObject({ role: 'assistant', text: 'Looks good.' })

    // The thread belongs to this panel alone, and the main chat's sessions are untouched.
    expect(await runner.load(ctx, p1.id)).toEqual([])
    expect(await s.sessions.list(ctx)).toEqual([])
    expect(runner.isRunning(`panel:${p2.id}`)).toBe(false)

    // The renderer routes on the thread key, so every event for this run carries `panel:<id>`.
    expect(eventsOf(p2.id).map((e) => e.kind)).toEqual(['run-started', 'text-delta', 'message', 'run-finished'])
    expect(eventsOf(p2.id).at(-1)).toMatchObject({ kind: 'run-finished', runId, outcome: 'end', error: null })
    expect(eventsOf(p1.id)).toEqual([])
    expect(projectId).toBe(ctx.id)
  })

  it('load returns an empty thread for a panel that has no chat yet, without creating the file', async () => {
    const { runner, ctx, p1 } = await setup()
    expect(await runner.load(ctx, p1.id)).toEqual([])
    expect(fs.existsSync(ctx.paths.panelChatFile(p1.id))).toBe(false)
  })

  it('continues the thread after a restart: a fresh runner sends the stored history with the new message', async () => {
    const provider = recorder()
    const { runner, s, ctx, projectId, start, eventsOf, p2 } = await setup([], () => provider)
    await start(p2.id, 'First')
    await finished(() => eventsOf(p2.id))
    await vi.waitFor(() => expect(runner.isRunning(`panel:${p2.id}`)).toBe(false))

    const reopened = new PanelChatRunner({ services: s, createTextProvider: () => provider })
    runners.push(reopened)
    await reopened.start({ projectId, panelId: p2.id, text: 'Second' })
    await vi.waitFor(() => expect(provider.requests).toHaveLength(2))
    expect(provider.requests[0].messages.map((m) => m.role)).toEqual(['user'])
    expect(provider.requests[1].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    // Each user message keeps the snapshot it was sent with, so replays are byte-identical.
    const second = provider.requests[1].messages
    expect((second[0] as UserMessage).stateSnapshot).toContain('<panel_context>')
    expect(second.map((m) => (m.role === 'user' ? m.text : null)).filter(Boolean)).toEqual(['First', 'Second'])
    await vi.waitFor(async () => expect(await reopened.load(ctx, p2.id)).toHaveLength(4))
  })

  describe('neighbors that cannot be shown', () => {
    it('writes (unreadable) into the snapshot for a corrupt neighbor, and reports the file', async () => {
      const { runner, ctx, start, eventsOf, p1, p2, p3 } = await setup([{ text: 'ok' }])
      await fs.promises.writeFile(ctx.paths.panelFile(p1.id), '{ not json', 'utf8')
      await start(p2.id)
      await finished(() => eventsOf(p2.id))
      const snapshot = ((await runner.load(ctx, p2.id))[0] as UserMessage).stateSnapshot!
      expect(snapshot).toContain('\nprevious: (unreadable)\n')
      expect(snapshot).toContain(`\nnext: ${p3.id}`)
      expect(ctx.problems).toEqual([{ path: `panels/${p1.id}.json`, message: expect.stringContaining('invalid JSON') }])
    })

    it('writes none for a neighbor whose file is gone, and reports nothing', async () => {
      const { runner, ctx, start, eventsOf, p2, p3 } = await setup([{ text: 'ok' }])
      await fs.promises.rm(ctx.paths.panelFile(p3.id))
      await start(p2.id)
      await finished(() => eventsOf(p2.id))
      expect(((await runner.load(ctx, p2.id))[0] as UserMessage).stateSnapshot).toContain('\nnext: none\n')
      expect(ctx.problems).toEqual([])
    })

    it('does not hide any other failure: the message is refused and nothing is stored', async () => {
      const { runner, s, ctx, start, p1, p2 } = await setup([{ text: 'ok' }])
      const real = s.panels.get.bind(s.panels)
      vi.spyOn(s.panels, 'get').mockImplementation((c, id) => (id === p1.id ? Promise.reject(new Error('disk on fire')) : real(c, id)))
      await expect(start(p2.id)).rejects.toThrow('disk on fire')
      expect(runner.isRunning(`panel:${p2.id}`)).toBe(false)
      expect(fs.existsSync(ctx.paths.panelChatFile(p2.id))).toBe(false)
    })
  })

  it('locks per panel, not globally', async () => {
    const { runner, start, p1, p2, eventsOf } = await setup([], () => hangingProvider)
    const first = start(p1.id)
    const second = start(p2.id)
    const again = start(p1.id)
    await expect(again).rejects.toBeInstanceOf(SessionBusyError)
    await expect(again).rejects.toThrow(`A run is already in progress for panel ${p1.id}`)
    const [a, b] = await Promise.all([first, second])
    expect(a.runId).not.toBe(b.runId)
    expect(runner.isRunning(`panel:${p1.id}`)).toBe(true)
    expect(runner.isRunning(`panel:${p2.id}`)).toBe(true)

    // Cancelling one run frees only that panel.
    runner.cancel(a.runId)
    await finished(() => eventsOf(p1.id))
    expect(eventsOf(p1.id).at(-1)).toMatchObject({ outcome: 'cancelled' })
    await vi.waitFor(() => expect(runner.isRunning(`panel:${p1.id}`)).toBe(false))
    expect(runner.isRunning(`panel:${p2.id}`)).toBe(true)
    expect(eventsOf(p2.id).some((e) => e.kind === 'run-finished')).toBe(false)
    await start(p1.id)
  })

  it('cancel of an unknown run is a no-op, and cancelAll aborts every panel run (app quit)', async () => {
    const { runner, start, p1, p2, eventsOf } = await setup([], () => hangingProvider)
    runner.cancel('run_unknown')
    await start(p1.id)
    await start(p2.id)
    runner.cancelAll()
    await finished(() => eventsOf(p1.id))
    await finished(() => eventsOf(p2.id))
    expect(eventsOf(p1.id).at(-1)).toMatchObject({ outcome: 'cancelled' })
    expect(eventsOf(p2.id).at(-1)).toMatchObject({ outcome: 'cancelled' })
  })

  it('runs under the panelChat role: its own model when assigned, otherwise the agent model', async () => {
    const resolved: string[] = []
    const provider = recorder()
    const h = await setup([], () => provider)
    const runner = new PanelChatRunner({
      services: h.s,
      createTextProvider: (r) => {
        resolved.push(r.model.id)
        return provider
      }
    })
    runners.push(runner)
    const run = async (text: string): Promise<void> => {
      keys.push(`panel:${h.p2.id}`)
      await runner.start({ projectId: h.projectId, panelId: h.p2.id, text })
      await vi.waitFor(() => expect(runner.isRunning(`panel:${h.p2.id}`)).toBe(false))
    }
    await run('one')
    const other = await h.s.registry.addModel({ endpointId: 'end_0000000000', modelId: 'mock-text-2', label: 'Mock text 2', capabilities: ['text'] })
    await h.s.registry.assignRole('panelChat', other.id)
    await run('two')
    expect(resolved).toEqual(['mdl_000000000a', other.id])
  })

  it('reports a missing model instead of crashing (Review Focus 3)', async () => {
    const { s, runner, ctx, start, events, p2 } = await setup([{ text: 'x' }])
    await s.registry.removeModel('mdl_000000000a')
    const { runId } = await start(p2.id)
    expect(runId).toMatch(/^run_/)
    expect(events).toEqual([
      { threadKey: `panel:${p2.id}`, event: { kind: 'run-finished', runId, outcome: 'error', error: "No model assigned to role 'panelChat'. Open Settings → Models." } }
    ])
    // The user's message is kept, so nothing they typed is lost.
    const msgs = await runner.load(ctx, p2.id)
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe('user')
    expect(runner.isRunning(`panel:${p2.id}`)).toBe(false)
  })

  it('rejects an unknown panel without leaving the slot busy or a chat file behind', async () => {
    const { runner, ctx, start } = await setup()
    await expect(start('pnl_ffffffffff')).rejects.toThrow('Unknown panel: pnl_ffffffffff')
    expect(runner.isRunning('panel:pnl_ffffffffff')).toBe(false)
    expect(fs.existsSync(ctx.paths.panelChatFile('pnl_ffffffffff'))).toBe(false)
  })

  describe('prompt and tools', () => {
    it('sends the intro, the Hard Rules and the panel-editing doc as the system prompt', async () => {
      const provider = recorder()
      const { runner, ctx, start, eventsOf, p2 } = await setup([], () => provider)
      await start(p2.id)
      await finished(() => eventsOf(p2.id))
      const withoutDoc = provider.requests[0].system
      expect(withoutDoc.startsWith('You are editing a single webtoon panel. Every tool acts on this panel only.')).toBe(true)
      expect(withoutDoc).toContain('R1 Roster first')
      expect(withoutDoc).not.toContain('## Mission')
      expect(withoutDoc).not.toContain('Available workflow docs')

      // Once the project has the doc, it follows the rules.
      const docFile = path.join(ctx.paths.agentDocsDir(), 'workflows', 'panel-editing.md')
      await fs.promises.mkdir(path.dirname(docFile), { recursive: true })
      await fs.promises.writeFile(docFile, '# Panel Editing\nUse edit_image for local changes.', 'utf8')
      await vi.waitFor(() => expect(runner.isRunning(`panel:${p2.id}`)).toBe(false))
      await start(p2.id, 'again')
      await vi.waitFor(() => expect(provider.requests).toHaveLength(2))
      expect(provider.requests[1].system).toContain('# Panel Editing\nUse edit_image for local changes.')
    })

    it('offers the panel tools, with view_current_image only when the model can see', async () => {
      const provider = recorder()
      const { s, runner, start, p2 } = await setup([], () => provider)
      const names = () => provider.requests.at(-1)!.tools.map((t) => t.name)
      await start(p2.id)
      await vi.waitFor(() => expect(provider.requests).toHaveLength(1))
      expect(names()).toEqual(['get_panel_context', 'view_current_image', 'update_panel_fields', 'regenerate_image', 'edit_image', 'revert_to_version'])
      await vi.waitFor(() => expect(runner.isRunning(`panel:${p2.id}`)).toBe(false))

      await s.registry.updateModel('mdl_000000000a', { capabilities: ['text'] })
      await start(p2.id)
      await vi.waitFor(() => expect(provider.requests).toHaveLength(2))
      expect(names()).toEqual(['get_panel_context', 'update_panel_fields', 'regenerate_image', 'edit_image', 'revert_to_version'])
    })
  })

  describe('a run that calls tools', () => {
    it('edits only its own panel, and the thread records the call and its result', async () => {
      const { s, runner, ctx, start, eventsOf, p1, p2 } = await setup([
        { toolCalls: [{ name: 'edit_image', input: { instruction: 'make her smile' } }] },
        { text: 'She is smiling now.' }
      ])
      await start(p2.id)
      await finished(() => eventsOf(p2.id))
      expect(eventsOf(p2.id).at(-1)).toMatchObject({ outcome: 'end' })

      expect((await s.panels.get(ctx, p2.id)).versions).toHaveLength(2)
      expect((await s.panels.get(ctx, p1.id)).versions).toHaveLength(1)
      const msgs = await runner.load(ctx, p2.id)
      expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant'])
      const tool = msgs[2] as ToolMessage
      expect(tool.results).toMatchObject([{ name: 'edit_image', ok: true }])
      expect(JSON.parse(tool.results[0].content)).toMatchObject({ label: 'v2', status: 'ready' })
      expect(tool.results[0].images).toHaveLength(1)
    })

    it('answers every tool call of a run that is stopped, and leaves no version pending (Review Focus 1 and 2)', async () => {
      const { s, runner, ctx, start, eventsOf, p2 } = await setup([
        {
          toolCalls: [
            { name: 'edit_image', input: { instruction: 'make her smile' } },
            { name: 'regenerate_image', input: {} }
          ]
        }
      ])
      const edit = vi.spyOn(s.images, 'edit').mockImplementation((_ctx, req) => new Promise((_resolve, reject) => req.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))))
      const generate = vi.spyOn(s.images, 'generate')
      await start(p2.id)
      await vi.waitFor(() => expect(edit).toHaveBeenCalledTimes(1))
      runner.cancelAll() // what quitting the app does
      await finished(() => eventsOf(p2.id))
      expect(eventsOf(p2.id).at(-1)).toMatchObject({ outcome: 'cancelled' })

      const msgs = await runner.load(ctx, p2.id)
      expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'tool'])
      const calls = (msgs[1] as { toolCalls: { id: string }[] }).toolCalls
      const results = (msgs[2] as ToolMessage).results
      expect(results.map((r) => r.toolCallId)).toEqual(calls.map((c) => c.id))
      expect(JSON.parse(results[0].content)).toMatchObject({ status: 'failed', error: 'Cancelled', label: null })
      expect(results[1]).toMatchObject({ ok: false, content: 'Cancelled by user' })
      expect(generate).not.toHaveBeenCalled()

      const stored = await s.panels.get(ctx, p2.id)
      expect(stored.currentVersionId).toBe(p2.currentVersionId)
      expect(stored.versions.map((v) => v.status)).toEqual(['ready', 'failed'])
    })
  })

  describe('a panel deleted while its chat is running (Ruling T21a)', () => {
    it('ends the run with the error "Panel was deleted" and does not recreate the chat file', async () => {
      const deleter: Provider = () => {
        let ctx: Awaited<ReturnType<TestServices['projects']['open']>> | undefined
        return {
          runTurn: async () => {
            ctx = await s!.projects.open(h.projectId)
            await s!.panels.delete(ctx, h.p2.id)
            return { text: 'Too late.', toolCalls: [], stopReason: 'end', raw: null }
          }
        }
      }
      const h = await setup([], deleter)
      await h.start(h.p2.id)
      await finished(() => h.eventsOf(h.p2.id))
      expect(h.eventsOf(h.p2.id).at(-1)).toMatchObject({ kind: 'run-finished', outcome: 'error', error: 'Panel was deleted' })
      expect(fs.existsSync(h.ctx.paths.panelChatFile(h.p2.id))).toBe(false)
      expect(await h.runner.load(h.ctx, h.p2.id)).toEqual([])
    })

    it('stops persisting when the panel goes while a tool runs, so the tool message does not recreate the file either', async () => {
      const h = await setup([{ toolCalls: [{ name: 'edit_image', input: { instruction: 'make her smile' } }] }, { text: 'never reached' }])
      vi.spyOn(h.s.images, 'edit').mockImplementation(async () => {
        await h.s.panels.delete(h.ctx, h.p2.id)
        return { data: PNG, ext: 'png' }
      })
      await h.start(h.p2.id)
      await finished(() => h.eventsOf(h.p2.id))
      expect(h.eventsOf(h.p2.id).at(-1)).toMatchObject({ outcome: 'error', error: 'Panel was deleted' })
      expect(fs.existsSync(h.ctx.paths.panelChatFile(h.p2.id))).toBe(false)
      expect(fs.existsSync(h.ctx.paths.panelFile(h.p2.id))).toBe(false)
    })

    it('does not slip a write between the delete and the chat file being trashed: the append waits for the panel lock', async () => {
      const h = await setup()
      const panelFile = h.ctx.paths.panelFile(h.p2.id)
      const lock = vi.spyOn(h.ctx.mutex, 'run')
      let release!: () => void
      // PanelService.delete trashes the panel and its chat file while holding exactly this lock.
      const held = h.ctx.mutex.run(panelFile, () => new Promise<void>((resolve) => (release = resolve)))
      const started = h.start(h.p2.id)
      started.catch(() => undefined)
      // Once the user message's append has asked for the panel lock, it is queued behind the "delete".
      await vi.waitFor(() => expect(lock.mock.calls.filter(([key]) => key === panelFile)).toHaveLength(2))
      expect(fs.existsSync(h.ctx.paths.panelChatFile(h.p2.id))).toBe(false)
      await fs.promises.rm(panelFile)
      release()
      await held
      await expect(started).rejects.toThrow('Panel was deleted')
      expect(fs.existsSync(h.ctx.paths.panelChatFile(h.p2.id))).toBe(false)
      expect(h.runner.isRunning(`panel:${h.p2.id}`)).toBe(false)
    })

    it('rejects a message to a panel that is already gone', async () => {
      const h = await setup()
      await h.s.panels.delete(h.ctx, h.p2.id)
      await expect(h.start(h.p2.id)).rejects.toThrow(`Unknown panel: ${h.p2.id}`)
      expect(fs.existsSync(h.ctx.paths.panelChatFile(h.p2.id))).toBe(false)
    })
  })
})
