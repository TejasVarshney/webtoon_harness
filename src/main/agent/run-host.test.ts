import { afterEach, describe, expect, it } from 'vitest'
import type { TextProvider } from '../models/providers/types'
import { testServices, type TestServices } from '../test/test-services'
import { AgentRunner } from './agent-runner'
import { RunHost, SessionBusyError, type RunRequest } from './run-host'
import { ToolRegistry } from './tools/registry'

let s: TestServices | undefined
let host: RunHost | undefined
afterEach(async () => {
  host?.cancelAll()
  await new Promise((r) => setTimeout(r, 20))
  host = undefined
  await s?.cleanup()
  s = undefined
})

const hangingProvider: TextProvider = {
  runTurn: (req) =>
    new Promise((_, reject) => {
      req.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })
}

describe('RunHost', () => {
  it('names the busy thread with the subject the runner gives, and knows nothing about thread key formats', async () => {
    s = await testServices()
    const ctx = await s.projects.create({ title: 'Moon Diary' })
    host = new RunHost({ services: s, createTextProvider: () => hangingProvider })
    const request = (threadKey: string, subject: string): RunRequest => ({
      threadKey,
      subject,
      role: 'agent',
      prepare: async () => ({ ctx, history: [], persist: async () => {}, configure: async () => ({ system: '', tools: new ToolRegistry([]) }) })
    })
    await host.start(request('panel:looks-like-a-panel', 'the printer'))
    const second = host.start(request('panel:looks-like-a-panel', 'the printer'))
    await expect(second).rejects.toBeInstanceOf(SessionBusyError)
    await expect(second).rejects.toThrow('A run is already in progress for the printer')
    // The same key is only busy for itself.
    await host.start(request('another-key', 'something else'))
  })

  it('AgentRunner keeps its busy message: "... for session <id>"', async () => {
    s = await testServices()
    const ctx = await s.projects.create({ title: 'Moon Diary' })
    const ses = await s.sessions.create(ctx)
    const runner = new AgentRunner({ services: s, createTextProvider: () => hangingProvider })
    const input = { projectId: ctx.id, sessionId: ses.id, text: 'Hi', imagePaths: [], activeEpisodeId: null }
    await runner.start(input)
    await expect(runner.start(input)).rejects.toThrow(`A run is already in progress for session ${ses.id}`)
    runner.cancelAll()
    await new Promise((r) => setTimeout(r, 50))
  })
})
