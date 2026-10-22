import { afterEach, describe, expect, it } from 'vitest'
import type { AgentEvent } from '@shared/types'
import { AgentRunner } from '../../agent/agent-runner'
import type { TextProvider } from '../../models/providers/types'
import { testServices, type TestServices } from '../../test/test-services'
import { sessionsHandlers } from './sessions'

let services: TestServices | undefined
afterEach(async () => {
  services?.agent.cancelAll()
  await services?.cleanup()
  services = undefined
})

/** Blocks until aborted, then rejects the way a real provider does. */
const hanging: TextProvider = {
  runTurn: (req) =>
    new Promise((_, reject) => {
      req.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })
}

describe('sessions:delete', () => {
  it('stops the session\'s running run before the session goes to the trash', async () => {
    const s = (services = await testServices())
    s.agent = new AgentRunner({ services: s, createTextProvider: () => hanging })
    const ctx = await s.projects.create({ title: 'Moon Diary' })
    const session = await s.sessions.create(ctx)
    const events: AgentEvent[] = []
    s.bus.subscribe((e) => {
      if (e.type === 'agent.event') events.push(e.event)
    })
    await s.agent.start({ projectId: ctx.id, sessionId: session.id, text: 'Draw ten panels', imagePaths: [], activeEpisodeId: null })
    expect(s.agent.isRunning(session.id)).toBe(true)

    await sessionsHandlers(s)['sessions:delete']!({ projectId: ctx.id, sessionId: session.id })

    expect(s.agent.isRunning(session.id)).toBe(false)
    expect(events.at(-1)).toMatchObject({ kind: 'run-finished', outcome: 'cancelled' })
    expect(s.trashed).toEqual([ctx.paths.sessionFile(session.id)])
  })

  it('deletes an idle session as before', async () => {
    const s = (services = await testServices())
    const ctx = await s.projects.create({ title: 'Moon Diary' })
    const session = await s.sessions.create(ctx)
    await sessionsHandlers(s)['sessions:delete']!({ projectId: ctx.id, sessionId: session.id })
    expect(s.trashed).toEqual([ctx.paths.sessionFile(session.id)])
  })
})
