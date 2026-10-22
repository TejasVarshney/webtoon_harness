import fs from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AppEvent, ChatMessage } from '@shared/types'
import { PanelChatRunner } from '../../agent/panel-chat'
import type { TextProvider } from '../../models/providers/types'
import { testServices, type TestServices } from '../../test/test-services'
import { panelChatHandlers } from './panel-chat'
import type { HandlerMap } from './projects'

let s: TestServices | undefined
let key = ''
afterEach(async () => {
  s?.panelChat.cancelAll()
  // A cancelled loop still persists its last messages; let it finish before the folder goes.
  await vi.waitFor(() => expect(s?.panelChat.isRunning(key) ?? false).toBe(false))
  await s?.cleanup()
  s = undefined
})

/** Blocks until aborted, then rejects the way a real provider does. */
const hangingProvider: TextProvider = {
  runTurn: (req) =>
    new Promise((_, reject) => {
      req.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })
}

async function setup(provider?: TextProvider) {
  s = await testServices()
  const services = s
  if (provider) services.panelChat = new PanelChatRunner({ services, createTextProvider: () => provider })
  const ctx = await services.projects.create({ title: 'Moon Diary' })
  await services.projects.open(ctx.id)
  const [episode] = await services.episodes.list(ctx)
  const { panel } = await services.panels.create(
    ctx,
    { episodeId: episode.id, description: 'An empty hallway.', setting: 'Hall', shot: 'wide', characters: [], dialogue: [] },
    { createdBy: 'user', strictMentions: false }
  )
  await services.panels.generate(ctx, panel.id)
  key = `panel:${panel.id}`
  const h = panelChatHandlers(services) as Required<Pick<HandlerMap, 'panelChat:load' | 'panelChat:send' | 'panelChat:cancel'>>
  const events: { threadKey: string; event: AgentEvent }[] = []
  services.bus.subscribe((e: AppEvent) => {
    if (e.type === 'agent.event') events.push({ threadKey: e.threadKey, event: e.event })
  })
  return { ctx, h, projectId: ctx.id, panelId: panel.id, events }
}

describe('panel chat IPC handlers', () => {
  it('panelChat:load returns an empty thread for a panel nobody has talked to', async () => {
    const { h, projectId, panelId, ctx } = await setup()
    expect(await h['panelChat:load']({ projectId, panelId })).toEqual([])
    expect(fs.existsSync(ctx.paths.panelChatFile(panelId))).toBe(false)
  })

  it('panelChat:send starts a run at once, and the reply is stored in the panel thread', async () => {
    const { h, projectId, panelId, events } = await setup()
    const { runId } = await h['panelChat:send']({ projectId, panelId, text: 'Add a lamp' })
    expect(runId).toMatch(/^run_/)
    await vi.waitFor(() => expect(events.some((e) => e.event.kind === 'run-finished')).toBe(true))
    expect(events.every((e) => e.threadKey === `panel:${panelId}`)).toBe(true)
    const thread: ChatMessage[] = await h['panelChat:load']({ projectId, panelId })
    expect(thread.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(thread[0]).toMatchObject({ role: 'user', text: 'Add a lamp' })
    expect(thread[1]).toMatchObject({ role: 'assistant', text: '(mock) Add a lamp' })
  })

  it('panelChat:send rejects an unknown panel', async () => {
    const { h, projectId } = await setup()
    await expect(h['panelChat:send']({ projectId, panelId: 'pnl_ffffffffff', text: 'hi' })).rejects.toThrow('Unknown panel: pnl_ffffffffff')
  })

  it('panelChat:cancel ends a running run, and ignores an unknown run id', async () => {
    const { h, projectId, panelId, events } = await setup(hangingProvider)
    await h['panelChat:cancel']({ runId: 'run_unknown' })
    const { runId } = await h['panelChat:send']({ projectId, panelId, text: 'hi' })
    expect(s!.panelChat.isRunning(`panel:${panelId}`)).toBe(true)
    await h['panelChat:cancel']({ runId })
    await vi.waitFor(() => expect(events.some((e) => e.event.kind === 'run-finished')).toBe(true))
    expect(events.at(-1)!.event).toMatchObject({ kind: 'run-finished', outcome: 'cancelled' })
  })
})
