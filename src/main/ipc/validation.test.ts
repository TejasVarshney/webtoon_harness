import { afterEach, describe, expect, it } from 'vitest'
import { testServices, type TestServices } from '../test/test-services'
import { registerIpc } from './register'

// I6: requests are validated at the main boundary. Every invalid request rejects with a plain Error whose
// message is readable (no ZodError dump), and nothing is written.

let services: TestServices | undefined
afterEach(async () => {
  services?.agent.cancelAll()
  await services?.cleanup()
  services = undefined
})

type Invoke = (channel: string, req: unknown) => Promise<unknown>

async function setup(): Promise<{ s: TestServices; invoke: Invoke; projectId: string; sessionId: string; episodeId: string; panelId: string }> {
  const s = await testServices()
  services = s
  const map = new Map<string, (e: unknown, req: unknown) => unknown>()
  registerIpc({ handle: (c, fn) => void map.set(c, fn) }, s)
  const invoke: Invoke = async (channel, req) => map.get(channel)!(null, req)
  const ctx = await s.projects.create({ title: 'Moon Diary' })
  const session = await s.sessions.create(ctx)
  const [episode] = await s.episodes.list(ctx)
  const { panel } = await s.panels.create(
    ctx,
    { episodeId: episode.id, description: 'A quiet street', setting: 'street', shot: 'wide', aspect: '3:4', characters: [], dialogue: [], continuityNotes: '', offPanelMentions: [] },
    { createdBy: 'user', strictMentions: false }
  )
  return { s, invoke, projectId: ctx.id, sessionId: session.id, episodeId: episode.id, panelId: panel.id }
}

/** The rejection, which must be a plain Error with a readable message. */
async function rejection(p: Promise<unknown>): Promise<Error> {
  const error = await p.then(
    () => null,
    (e: unknown) => e
  )
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).name).toBe('Error')
  return error as Error
}

describe('IPC input validation (I6)', () => {
  it('agent:send checks text, image paths and the active episode id', async () => {
    const { s, invoke, projectId, sessionId } = await setup()
    const ok = { projectId, sessionId, text: 'hi', imagePaths: [], activeEpisodeId: null }
    expect((await rejection(invoke('agent:send', { ...ok, text: 42 }))).message).toMatch(/^Invalid input: text: /)
    expect((await rejection(invoke('agent:send', { ...ok, imagePaths: 'uploads/a.png' }))).message).toMatch(/^Invalid input: imagePaths: /)
    expect((await rejection(invoke('agent:send', { ...ok, activeEpisodeId: 'not an id' }))).message).toMatch(/^Invalid input: activeEpisodeId: /)
    for (const bad of ['../../secret.png', 'C:/Windows/win.ini', 'characters/..']) {
      expect((await rejection(invoke('agent:send', { ...ok, imagePaths: [bad] }))).message, bad).toBe(`Invalid input: imagePaths: not a project file: ${bad}`)
    }
    // Nothing was stored for any of them.
    expect(await s.sessions.load(await s.projects.open(projectId), sessionId)).toEqual([])
  })

  it('panelChat:send checks the text', async () => {
    const { invoke, projectId, panelId } = await setup()
    expect((await rejection(invoke('panelChat:send', { projectId, panelId, text: null }))).message).toMatch(/^Invalid input: text: /)
  })

  it('sessions:rename trims the title and refuses a blank one', async () => {
    const { s, invoke, projectId, sessionId } = await setup()
    expect((await rejection(invoke('sessions:rename', { projectId, sessionId, title: '   ' }))).message).toMatch(/^Invalid input: title: /)
    await invoke('sessions:rename', { projectId, sessionId, title: '  Night walk  ' })
    expect((await s.sessions.list(await s.projects.open(projectId)))[0].title).toBe('Night walk')
  })

  it('projects:create checks its input', async () => {
    const { invoke } = await setup()
    expect((await rejection(invoke('projects:create', { title: '' }))).message).toMatch(/^Invalid input: title: /)
    expect((await rejection(invoke('projects:create', { title: 'X', logline: 7 }))).message).toMatch(/^Invalid input: logline: /)
    expect(await invoke('projects:create', { title: ' Sun Diary ' })).toMatchObject({ title: 'Sun Diary' })
  })

  it('episodes:create and episodes:update need a title of at least one character', async () => {
    const { invoke, projectId, episodeId } = await setup()
    expect((await rejection(invoke('episodes:create', { projectId, title: '' }))).message).toMatch(/^Invalid input: title: /)
    expect((await rejection(invoke('episodes:update', { projectId, episodeId, patch: { title: '' } }))).message).toMatch(/^Invalid input: patch\.title: /)
    expect(await invoke('episodes:update', { projectId, episodeId, patch: { synopsis: 'Night' } })).toMatchObject({ synopsis: 'Night' })
  })

  it('panels:move needs a whole, non-negative index', async () => {
    const { invoke, projectId, panelId } = await setup()
    for (const toIndex of [-1, 1.5, '0', Number.NaN]) {
      expect((await rejection(invoke('panels:move', { projectId, panelId, toIndex }))).message, String(toIndex)).toMatch(/^Invalid input: toIndex: /)
    }
    await invoke('panels:move', { projectId, panelId, toIndex: 0 })
  })

  it('a schema failure inside any handler reaches the renderer as a short readable message', async () => {
    const { invoke, projectId } = await setup()
    const error = await rejection(invoke('characters:create', { projectId, input: { name: 'Mina', role: 'hero', appearanceLock: 'L' }, generateBase: false }))
    expect(error.message).toMatch(/^Invalid input: role: /)
    expect(error.message).not.toContain('\n')
  })
})
