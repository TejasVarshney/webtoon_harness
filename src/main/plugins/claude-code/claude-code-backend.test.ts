import child_process from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AppEvent, AssistantMessage, UserMessage } from '@shared/types'
import { SessionBusyError } from '../../agent/run-host'
import { testServices, type TestServices } from '../../test/test-services'
import type { PluginStatus } from '../types'
import { ClaudeCodeBackend, findOnPath, type ClaudeCodeLink } from './claude-code-backend'
import { locateClaude } from './locate-claude'
import { McpLinkServer } from './mcp-server'
import { McpToolAdapter } from './mcp-tools'
import { DriverSessionLog } from './session-log'

const FAKE = path.resolve(__dirname, 'fixtures', 'fake-claude.mjs')
const fixture = (name: string): string => path.resolve(__dirname, 'fixtures', name)
const SESSION_ID = '4548b1af-b0a3-40af-a149-9f9459fabaab'
const LINK = 'http://127.0.0.1:7880/mcp'
const TOKEN = 'test-token-abc'
const LINK_OFF = "Turn on the Claude Code plugin's link first."
const NOT_FOUND = 'Claude Code was not found. Set its path in Settings → Plugins.'
const NO_IMAGES = "Claude Code can't see attached images yet. Remove them, or switch the agent off Claude Code in Settings → Plugins."
const RUNNING: PluginStatus = { state: 'running', message: 'Listening on 127.0.0.1:7880' }

let s: TestServices | undefined
let backend: ClaudeCodeBackend | undefined
let linkServer: McpLinkServer | undefined
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-backend-test-'))
let n = 0

afterEach(async () => {
  await backend?.stopAll()
  backend = undefined
  await linkServer?.close()
  linkServer = undefined
  await s?.cleanup()
  s = undefined
})

interface FakeRecord {
  argv: string[]
  pid: number
  cwd: string
  config: { mcpServers: { webtoon: { type: string; url: string; headers: Record<string, string> } } }
  /** What the backend wrote to the fake's stdin: the snapshot, a blank line, the prompt. */
  stdin: string
  env: { MCP_TOOL_TIMEOUT: string | null }
  /** With FAKE_CLAUDE_MCP_CALLS: the initialize instructions and each tools/call result. */
  mcp: { instructions: string | null; results: { content: { type: string; text?: string }[]; isError?: boolean }[]; error?: string } | null
}

interface Setup {
  env?: Record<string, string>
  linkUrl?: string | null
  status?: PluginStatus
  locate?: () => string | null
  /** The real link instead of a stub: the fake then talks MCP to it. */
  link?: (s: TestServices) => Promise<ClaudeCodeLink>
}

/** A backend whose `claude` is fake-claude.mjs run by this Node; each spawn gets the env in `fake.env`. */
async function setup(opts: Setup = {}) {
  s = await testServices()
  const ctx = await s.projects.create({ title: 'Moon Diary' })
  const ses = await s.sessions.create(ctx)
  const events: AgentEvent[] = []
  s.bus.subscribe((e: AppEvent) => {
    if (e.type === 'agent.event' && e.threadKey === ses.id) events.push(e.event)
  })
  const argvFile = path.join(scratch, `argv-${n++}.json`)
  const fake = { env: { FAKE_CLAUDE_ARGV: argvFile, ...opts.env } as Record<string, string>, spawned: 0 }
  const spawn = ((cmd: string, args: string[], options: child_process.SpawnOptions) => {
    fake.spawned++
    expect(cmd).toBe('claude')
    return child_process.spawn(process.execPath, [FAKE, ...args], { ...options, env: { ...options.env, ...fake.env } })
  }) as unknown as typeof child_process.spawn
  const linkUrl = opts.linkUrl === undefined ? LINK : opts.linkUrl
  const link: ClaudeCodeLink = opts.link
    ? await opts.link(s)
    : { linkUrl: () => linkUrl, token: () => TOKEN, config: () => ({}), status: () => opts.status ?? RUNNING, abortCalls: vi.fn() }
  backend = new ClaudeCodeBackend({ services: s, plugin: link, spawn, locate: opts.locate ?? (() => 'claude') })
  const record = (): FakeRecord => JSON.parse(fs.readFileSync(fake.env.FAKE_CLAUDE_ARGV, 'utf8'))
  return { s, backend, ctx, projectId: ctx.id, sessionId: ses.id, events, fake, record, link }
}

const input = (projectId: string, sessionId: string, text = 'Say hi') => ({
  projectId,
  sessionId,
  text,
  imagePaths: [] as string[],
  activeEpisodeId: null as string | null
})

/** The prompt written to stdin ends with the user's text, after the snapshot and a blank line. */
function expectPrompt(stdin: string, text: string): void {
  expect(stdin.startsWith('<project_state>')).toBe(true)
  expect(stdin.endsWith(`</project_state>\n\n${text}`)).toBe(true)
}

async function waitFor(check: () => boolean, what: string): Promise<void> {
  const t0 = Date.now()
  while (!check()) {
    if (Date.now() - t0 > 10_000) throw new Error(`timeout waiting for ${what}`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

const finished = (events: AgentEvent[]) => waitFor(() => events.some((e) => e.kind === 'run-finished'), 'run-finished')

const tempDirOf = (rec: FakeRecord): string => path.dirname(rec.argv[rec.argv.indexOf('--mcp-config') + 1])

function processGone(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return false
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH'
  }
}

function writeFixture(lines: unknown[]): string {
  const p = path.join(scratch, `fixture-${n++}.jsonl`)
  fs.writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  return p
}

describe('ClaudeCodeBackend', () => {
  it('runs Claude Code: user message with snapshot, streamed text, one assistant message, ends `end`', async () => {
    const { s, backend, ctx, projectId, sessionId, events, record } = await setup({ env: { FAKE_CLAUDE_FIXTURE: fixture('hello.jsonl') } })
    const { runId } = await backend.start(input(projectId, sessionId))
    expect(runId).toMatch(/^run_/)
    await finished(events)

    const msgs = await s.sessions.load(ctx, sessionId)
    expect(msgs).toHaveLength(2)
    const user = msgs[0] as UserMessage
    expect(user).toMatchObject({ role: 'user', text: 'Say hi' })
    expect(user.stateSnapshot?.startsWith('<project_state>')).toBe(true)
    expect(msgs[1]).toMatchObject({
      role: 'assistant',
      text: 'Hi there → friend!',
      toolCalls: [],
      stopReason: 'end',
      model: { endpointId: 'plugin:claude-code', modelId: 'claude-code' },
      raw: null
    } satisfies Partial<AssistantMessage>)

    expect(events.map((e) => e.kind)).toEqual(['run-started', 'text-delta', 'text-delta', 'text-delta', 'message', 'run-finished'])
    expect(events.every((e) => e.runId === runId)).toBe(true)
    expect(events.filter((e) => e.kind === 'text-delta').map((e) => (e as { text: string }).text).join('')).toBe('Hi there → friend!')
    expect(events.at(-1)).toEqual({ kind: 'run-finished', runId, outcome: 'end', error: null })

    const rec = record()
    // The snapshot goes with the user turn, not into a system prompt that --resume would replay frozen (R17).
    expect(rec.stdin).toBe(`${user.stateSnapshot}\n\nSay hi`)
    expect(rec.argv).not.toContain('Say hi')
    expect(rec.argv.slice(0, 2)).toEqual(['-p', '--output-format'])
    expect(rec.argv).toEqual(expect.arrayContaining(['--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--strict-mcp-config']))
    expect(rec.argv[rec.argv.indexOf('--tools') + 1]).toBe('')
    expect(rec.argv[rec.argv.indexOf('--allowedTools') + 1]).toBe('mcp__webtoon__*')
    expect(rec.argv[rec.argv.indexOf('--setting-sources') + 1]).toBe('user')
    expect(rec.argv.filter((a) => a.startsWith('--append-system-prompt'))).toEqual([])
    expect(rec.argv).not.toContain('--resume')
    expect(rec.env.MCP_TOOL_TIMEOUT).toBe('900000')
    expect(rec.argv.join(' ')).not.toContain(TOKEN)
    expect(rec.config).toEqual({
      mcpServers: {
        webtoon: {
          type: 'http',
          url: LINK,
          headers: { Authorization: `Bearer ${TOKEN}`, 'X-Webtoon-Session': sessionId, 'X-Webtoon-Project': projectId, 'X-Webtoon-Episode': '' }
        }
      }
    })
    expect(fs.realpathSync(rec.cwd)).toBe(fs.realpathSync(ctx.paths.root))
    expect(fs.existsSync(tempDirOf(rec))).toBe(false)
    expect(backend.isRunning(sessionId)).toBe(false)
  })

  it('saves the Claude Code session id and resumes it on the next run', async () => {
    const { s, backend, ctx, projectId, sessionId, events, record } = await setup({ env: { FAKE_CLAUDE_FIXTURE: fixture('hello.jsonl') } })
    await backend.start(input(projectId, sessionId))
    await finished(events)
    expect((await s.sessions.list(ctx)).find((x) => x.id === sessionId)?.claudeSessionId).toBe(SESSION_ID)

    events.length = 0
    await backend.start(input(projectId, sessionId, 'Again'))
    await finished(events)
    const rec = record()
    expectPrompt(rec.stdin, 'Again')
    expect(rec.argv.slice(-2)).toEqual(['--resume', SESSION_ID])
    expect(fs.existsSync(tempDirOf(rec))).toBe(false)
  })

  it('sends a fresh snapshot with every message of a resumed chat', async () => {
    const { s, backend, ctx, projectId, sessionId, events, record } = await setup({ env: { FAKE_CLAUDE_FIXTURE: fixture('hello.jsonl') } })
    await backend.start(input(projectId, sessionId))
    await finished(events)
    expect(record().stdin).not.toContain('Mina')
    await s.characters.create(ctx, { name: 'Mina', role: 'protagonist', appearanceLock: 'LOCK' }, 'user')

    events.length = 0
    await backend.start(input(projectId, sessionId, 'Again'))
    await finished(events)
    const rec = record()
    expect(rec.argv).toContain('--resume')
    expectPrompt(rec.stdin, 'Again')
    expect(rec.stdin).toContain('Mina')
  })

  it('passes a prompt that looks like an option or a subcommand on stdin, untouched', async () => {
    const { backend, projectId, sessionId, events, record } = await setup({ env: { FAKE_CLAUDE_FIXTURE: fixture('hello.jsonl') } })
    const text = '- make it darker\n- and "moodier" → ok'
    await backend.start(input(projectId, sessionId, text))
    await finished(events)
    expectPrompt(record().stdin, text)
    expect(record().argv).not.toContain(text)
    expect(record().argv.some((a) => a.includes('make it darker'))).toBe(false)

    events.length = 0
    await backend.start(input(projectId, sessionId, 'update'))
    await finished(events)
    expectPrompt(record().stdin, 'update')
    expect(record().argv).not.toContain('update')
    expect(events.at(-1)).toMatchObject({ kind: 'run-finished', outcome: 'end' })
  })

  it('forgets a --resume id that Claude Code could not resume, so the next run starts fresh', async () => {
    const { s, backend, ctx, projectId, sessionId, events, fake, record } = await setup({
      env: { FAKE_CLAUDE_EXIT: '1', FAKE_CLAUDE_STDERR: 'No conversation found with session ID: stale-id\n' }
    })
    await s.sessions.setClaudeSessionId(ctx, sessionId, 'stale-id')
    await backend.start(input(projectId, sessionId))
    await finished(events)
    expect(record().argv.slice(-2)).toEqual(['--resume', 'stale-id'])
    expect(events.at(-1)).toMatchObject({ kind: 'run-finished', outcome: 'error', error: 'No conversation found with session ID: stale-id' })
    expect((await s.sessions.list(ctx)).find((x) => x.id === sessionId)?.claudeSessionId).toBeNull()

    events.length = 0
    fake.env.FAKE_CLAUDE_FIXTURE = fixture('hello.jsonl')
    delete fake.env.FAKE_CLAUDE_EXIT
    delete fake.env.FAKE_CLAUDE_STDERR
    await backend.start(input(projectId, sessionId, 'Again'))
    await finished(events)
    expect(record().argv).not.toContain('--resume')
    expect(events.at(-1)).toMatchObject({ kind: 'run-finished', outcome: 'end' })
    expect((await s.sessions.list(ctx)).find((x) => x.id === sessionId)?.claudeSessionId).toBe(SESSION_ID)
  })

  it('keeps a --resume id when the run got as far as init', async () => {
    const f = writeFixture([{ type: 'system', subtype: 'init', session_id: SESSION_ID }])
    const { s, backend, ctx, projectId, sessionId, events } = await setup({ env: { FAKE_CLAUDE_FIXTURE: f, FAKE_CLAUDE_EXIT: '1' } })
    await s.sessions.setClaudeSessionId(ctx, sessionId, SESSION_ID)
    await backend.start(input(projectId, sessionId))
    await finished(events)
    expect(events.at(-1)).toMatchObject({ kind: 'run-finished', outcome: 'error' })
    expect((await s.sessions.list(ctx)).find((x) => x.id === sessionId)?.claudeSessionId).toBe(SESSION_ID)
  })

  it('does not save an empty session id', async () => {
    const f = writeFixture([
      { type: 'system', subtype: 'init', session_id: '' },
      { type: 'result', subtype: 'success', is_error: false, result: '', session_id: '' }
    ])
    const { s, backend, ctx, projectId, sessionId, events } = await setup({ env: { FAKE_CLAUDE_FIXTURE: f } })
    await backend.start(input(projectId, sessionId))
    await finished(events)
    expect((await s.sessions.list(ctx)).find((x) => x.id === sessionId)?.claudeSessionId).toBeNull()
    expect(events.at(-1)).toMatchObject({ kind: 'run-finished', outcome: 'end' })
  })

  it('appends only the text of a tool-using run; the tool call itself is logged by the MCP link', async () => {
    const { s, backend, ctx, projectId, sessionId, events } = await setup({ env: { FAKE_CLAUDE_FIXTURE: fixture('tool.jsonl') } })
    await backend.start(input(projectId, sessionId))
    await finished(events)
    const msgs = await s.sessions.load(ctx, sessionId)
    expect(msgs.map((m) => [m.role, m.role === 'tool' ? '' : m.text])).toEqual([
      ['user', 'Say hi'],
      ['assistant', 'done.']
    ])
    expect(events.at(-1)).toMatchObject({ kind: 'run-finished', outcome: 'end', error: null })
  })

  it('ends `error` with the result text when the result is an error, even with subtype success', async () => {
    const { s, backend, ctx, projectId, sessionId, events } = await setup({ env: { FAKE_CLAUDE_FIXTURE: fixture('auth-failed.jsonl') } })
    await backend.start(input(projectId, sessionId))
    await finished(events)
    const last = events.at(-1) as Extract<AgentEvent, { kind: 'run-finished' }>
    expect(last.outcome).toBe('error')
    expect(last.error).toBe('Failed to authenticate: OAuth session expired and could not be refreshed')
    const msgs = await s.sessions.load(ctx, sessionId)
    expect(msgs[0].role).toBe('user')
  })

  it('maps error_max_turns to max_steps', async () => {
    const f = writeFixture([
      { type: 'system', subtype: 'init', session_id: SESSION_ID },
      { type: 'result', subtype: 'error_max_turns', is_error: true, session_id: SESSION_ID }
    ])
    const { backend, projectId, sessionId, events } = await setup({ env: { FAKE_CLAUDE_FIXTURE: f } })
    await backend.start(input(projectId, sessionId))
    await finished(events)
    expect(events.at(-1)).toMatchObject({ kind: 'run-finished', outcome: 'max_steps' })
  })

  it('ends `error` with the last 5 stderr lines when the process exits without a result', async () => {
    const stderr = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'].join('\n') + '\n'
    const { backend, projectId, sessionId, events, record } = await setup({ env: { FAKE_CLAUDE_EXIT: '1', FAKE_CLAUDE_STDERR: stderr } })
    await backend.start(input(projectId, sessionId))
    await finished(events)
    expect(events.at(-1)).toMatchObject({ kind: 'run-finished', outcome: 'error', error: 'three\nfour\nfive\nsix\nseven' })
    expect(fs.existsSync(tempDirOf(record()))).toBe(false)
  })

  it('stop() kills a hanging run, which ends `cancelled`', async () => {
    const { backend, projectId, sessionId, events, fake, record } = await setup({ env: { FAKE_CLAUDE_HANG: '1' } })
    await backend.start(input(projectId, sessionId))
    await waitFor(() => fs.existsSync(fake.env.FAKE_CLAUDE_ARGV), 'the fake to start')
    const rec = record()
    expect(backend.isRunning(sessionId)).toBe(true)
    await expect(backend.start(input(projectId, sessionId))).rejects.toBeInstanceOf(SessionBusyError)

    await backend.stop(sessionId)
    expect(events.at(-1)).toMatchObject({ kind: 'run-finished', outcome: 'cancelled', error: null })
    expect(backend.isRunning(sessionId)).toBe(false)
    await waitFor(() => processGone(rec.pid), 'the fake to exit')
    expect(fs.existsSync(tempDirOf(rec))).toBe(false)
  })

  it('stop() also aborts the tool calls the run still has in flight on the link', async () => {
    const { backend, projectId, sessionId, events, fake, link } = await setup({ env: { FAKE_CLAUDE_HANG: '1' } })
    await backend.start(input(projectId, sessionId))
    await waitFor(() => fs.existsSync(fake.env.FAKE_CLAUDE_ARGV), 'the fake to start')
    await backend.stop(sessionId)
    expect(link.abortCalls).toHaveBeenCalledExactlyOnceWith(sessionId)
    expect(events.at(-1)).toMatchObject({ kind: 'run-finished', outcome: 'cancelled' })
  })

  it('refuses a message with attached images, persisting nothing', async () => {
    const { s, backend, ctx, projectId, sessionId, events, fake } = await setup({ env: { FAKE_CLAUDE_FIXTURE: fixture('hello.jsonl') } })
    await expect(backend.start({ ...input(projectId, sessionId), imagePaths: ['uploads/a.png'] })).rejects.toThrow(NO_IMAGES)
    expect(await s.sessions.load(ctx, sessionId)).toEqual([])
    expect(events).toEqual([])
    expect(fake.spawned).toBe(0)
    expect(backend.isRunning(sessionId)).toBe(false)
  })

  it('cancel(runId) stops the run with that id', async () => {
    const { backend, projectId, sessionId, events, fake } = await setup({ env: { FAKE_CLAUDE_HANG: '1' } })
    const { runId } = await backend.start(input(projectId, sessionId))
    await waitFor(() => fs.existsSync(fake.env.FAKE_CLAUDE_ARGV), 'the fake to start')
    backend.cancel('run_other00000')
    backend.cancel(runId)
    await finished(events)
    expect(events.at(-1)).toMatchObject({ kind: 'run-finished', runId, outcome: 'cancelled' })
  })

  it('ends `error` without spawning when the link is off', async () => {
    const { s, backend, ctx, projectId, sessionId, events, fake } = await setup({ linkUrl: null, status: { state: 'off', message: 'Off' } })
    await backend.start(input(projectId, sessionId))
    await finished(events)
    expect(events.map((e) => e.kind)).toEqual(['run-started', 'run-finished'])
    expect(events.at(-1)).toMatchObject({ kind: 'run-finished', outcome: 'error', error: LINK_OFF })
    expect(fake.spawned).toBe(0)
    expect(await s.sessions.load(ctx, sessionId)).toHaveLength(1)
    expect(backend.isRunning(sessionId)).toBe(false)
  })

  it('says why when the plugin is on but its link is not listening', async () => {
    const { backend, projectId, sessionId, events, fake } = await setup({ linkUrl: null, status: { state: 'error', message: 'Port 7880 is in use' } })
    await backend.start(input(projectId, sessionId))
    await finished(events)
    expect(events.at(-1)).toMatchObject({ kind: 'run-finished', outcome: 'error', error: 'The Claude Code link is not running: Port 7880 is in use' })
    expect(fake.spawned).toBe(0)
  })

  it('ends `error` without spawning when Claude Code is not found', async () => {
    const { backend, projectId, sessionId, events, fake } = await setup({ locate: () => null })
    await backend.start(input(projectId, sessionId))
    await finished(events)
    expect(events.at(-1)).toMatchObject({ kind: 'run-finished', outcome: 'error', error: NOT_FOUND })
    expect(fake.spawned).toBe(0)
  })

  it('ends `error` when the executable cannot be started', async () => {
    s = await testServices()
    const ctx = await s.projects.create({ title: 'Moon Diary' })
    const ses = await s.sessions.create(ctx)
    const events: AgentEvent[] = []
    s.bus.subscribe((e: AppEvent) => {
      if (e.type === 'agent.event') events.push(e.event)
    })
    backend = new ClaudeCodeBackend({
      services: s,
      plugin: { linkUrl: () => LINK, token: () => TOKEN, config: () => ({}), status: () => RUNNING, abortCalls: () => {} },
      locate: () => path.join(scratch, 'no such claude.exe')
    })
    await backend.start(input(ctx.id, ses.id))
    await finished(events)
    expect(events.at(-1)).toMatchObject({ kind: 'run-finished', outcome: 'error' })
    expect((events.at(-1) as { error: string }).error).toContain('ENOENT')
    expect(backend.isRunning(ses.id)).toBe(false)
  })
})

describe('ClaudeCodeBackend with the real MCP link', () => {
  /** A link server on a free port, serving `s` for whatever project the request names or the window shows. */
  async function realLink(services: TestServices): Promise<ClaudeCodeLink> {
    const server = new McpLinkServer({
      adapter: new McpToolAdapter({ services, activeContext: services.activeContext }),
      log: new DriverSessionLog({ sessions: services.sessions, bus: services.bus }),
      token: () => TOKEN
    })
    linkServer = server
    await server.listen(0)
    return {
      linkUrl: () => `http://127.0.0.1:${server.port}/mcp`,
      token: () => TOKEN,
      config: () => ({}),
      status: () => RUNNING,
      abortCalls: (id) => server.abortCalls(id)
    }
  }

  it("runs its tool calls in the run's project and session while the window shows another project", async () => {
    const calls = [
      { name: 'create_character', arguments: { name: 'Mina', role: 'protagonist', appearanceLock: 'LOCK', generateBaseImage: false } },
      { name: 'get_project_state', arguments: {} }
    ]
    const { s, backend, ctx, projectId, sessionId, events, record } = await setup({
      env: { FAKE_CLAUDE_FIXTURE: fixture('hello.jsonl'), FAKE_CLAUDE_MCP_CALLS: JSON.stringify(calls) },
      link: realLink
    })
    const other = await s.projects.create({ title: 'Window Project' })
    s.activeContext.set({ projectId: other.id, episodeId: null })

    await backend.start(input(projectId, sessionId, 'Make Mina'))
    await finished(events)
    expect(events.at(-1)).toMatchObject({ kind: 'run-finished', outcome: 'end' })

    const { mcp } = record()
    expect(mcp?.error).toBeUndefined()
    expect(mcp?.results.map((r) => r.isError ?? false)).toEqual([false, false])
    expect(mcp?.results[1].content[0].text).toContain('Moon Diary')
    expect((await s.characters.list(ctx)).map((c) => c.name)).toEqual(['Mina'])
    expect(await s.characters.list(other)).toEqual([])
    // Logged into the run's own session, after its user message; no stray "Claude Code" session anywhere.
    const msgs = await s.sessions.load(ctx, sessionId)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'tool', 'assistant'])
    expect((await s.sessions.list(ctx)).map((x) => x.id)).toEqual([sessionId])
    expect(await s.sessions.list(other)).toEqual([])
  })
})

describe('findOnPath', () => {
  const exists = (files: string[]) => (p: string) => files.includes(p)

  it('on Windows finds only claude.exe, so an npm claude.cmd does not hide the desktop install', () => {
    const npmCmd = String.raw`C:\npm\claude.cmd`
    const toolsExe = String.raw`C:\tools\claude.exe`
    const pathEnv = String.raw`C:\npm;C:\tools`
    expect(findOnPath('claude', { platform: 'win32', pathEnv, exists: exists([npmCmd]) })).toBeNull()
    expect(findOnPath('claude', { platform: 'win32', pathEnv, exists: exists([npmCmd, toolsExe]) })).toBe(toolsExe)

    const appExe = String.raw`C:\AppData\Claude\claude-code\2.1.309\abc\claude.exe`
    const located = locateClaude({
      configured: '',
      pathLookup: (cmd) => findOnPath(cmd, { platform: 'win32', pathEnv, exists: exists([npmCmd, appExe]) }),
      appData: String.raw`C:\AppData`,
      exists: exists([npmCmd, appExe]),
      listDir: (dir) => (dir.endsWith('claude-code') ? ['2.1.309'] : dir.endsWith('2.1.309') ? ['abc'] : [])
    })
    expect(located).toBe(appExe)
  })

  it('elsewhere finds `claude` in PATH order', () => {
    expect(findOnPath('claude', { platform: 'linux', pathEnv: '/usr/bin:/opt/bin', exists: exists(['/opt/bin/claude', '/usr/bin/claude']) })).toBe('/usr/bin/claude')
    expect(findOnPath('claude', { platform: 'linux', pathEnv: '/usr/bin', exists: exists([]) })).toBeNull()
  })
})
