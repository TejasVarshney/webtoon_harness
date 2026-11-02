import child_process, { type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { newId } from '@shared/ids'
import type { AgentEvent, AssistantMessage, LoopOutcome, UserMessage } from '@shared/types'
import type { StartRunInput } from '../../agent/agent-runner'
import { projectStateText } from '../../agent/project-state'
import { SessionBusyError } from '../../agent/run-host'
import type { Services } from '../../services'
import type { ProjectContext } from '../../storage/project-store'
import type { AgentBackend } from '../types'
import { locateClaude } from './locate-claude'
import { StreamJsonParser, type ClaudeStreamEvent } from './stream-json'

export const LINK_OFF = "Turn on the Claude Code plugin's link first."
export const CLAUDE_NOT_FOUND = 'Claude Code was not found. Set its path in Settings → Plugins.'

/** What assistant messages written by this backend name as their model. */
const MODEL = { endpointId: 'plugin:claude-code', modelId: 'claude-code' }
/** How many stderr lines a run that ends without a result reports. */
const STDERR_LINES = 5
/** Enough stderr to hold those lines; older output is dropped. */
const STDERR_KEEP = 16_384

/** What the backend needs from the plugin (spec §6.2). */
export interface ClaudeCodeLink {
  /** The MCP endpoint while the link is listening, else null. */
  linkUrl(): string | null
  token(): string
  config(): Record<string, unknown>
}

export interface ClaudeCodeBackendOptions {
  services: Services
  plugin: ClaudeCodeLink
  /** Swapped in tests for a fake `claude`. */
  spawn?: typeof child_process.spawn
  /** The executable; null when it cannot be found. Defaults to `locateClaude` on this machine. */
  locate?: () => string | null
}

interface ActiveRun {
  runId: string
  child: ChildProcess | null
  cancelled: boolean
  /** Settles once `run-finished` has been emitted. */
  done: Promise<void>
}

/** One `claude` process: what to run and what it is fed. */
interface Launch {
  exe: string
  args: string[]
  /** Written to stdin, which is then closed. */
  prompt: string
  /** Whether `args` include `--resume`. */
  resumed: boolean
}

interface RunEnd {
  outcome: LoopOutcome
  error: string | null
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export interface PathLookupOptions {
  platform: NodeJS.Platform
  /** The PATH variable. */
  pathEnv: string
  exists: (p: string) => boolean
}

/**
 * `cmd` in the PATH folders, in order: `claude.exe` on Windows, `claude` elsewhere. A Windows `.cmd` launcher (npm's)
 * is skipped on purpose: it cannot be spawned without a shell, and finding it would hide the desktop app's install.
 */
export function findOnPath(
  cmd: string,
  opts: PathLookupOptions = { platform: process.platform, pathEnv: process.env.PATH ?? '', exists: fs.existsSync }
): string | null {
  const p = opts.platform === 'win32' ? path.win32 : path.posix
  const name = opts.platform === 'win32' ? `${cmd}.exe` : cmd
  for (const dir of opts.pathEnv.split(p.delimiter).filter(Boolean)) {
    const candidate = p.join(dir, name)
    if (opts.exists(candidate)) return candidate
  }
  return null
}

function listDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

/** Where `claude` is on this machine, given the path saved in Settings → Plugins ('' when unset). A run and the Settings hint both use it. */
export function locateClaudeOnThisMachine(configured: string): string | null {
  return locateClaude({ configured, pathLookup: findOnPath, appData: process.env.APPDATA ?? '', exists: fs.existsSync, listDir })
}

/** Ends the process and everything it started (MCP clients, sub-agents). */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    // If taskkill itself fails, still end the direct child so `stop()` does not wait forever.
    child_process.execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, (error) => {
      if (error) child.kill()
    })
  } else {
    child.kill('SIGTERM')
  }
}

function endOf(result: Extract<ClaudeStreamEvent, { kind: 'result' }>): RunEnd {
  if (result.ok) return { outcome: 'end', error: null }
  if (result.subtype === 'error_max_turns') return { outcome: 'max_steps', error: null }
  return { outcome: 'error', error: result.text || result.subtype || 'Claude Code reported an error' }
}

/**
 * Runs the main chat on Claude Code (spec §6.2): one `claude -p` process per message, talking to the app only
 * through the MCP link (no built-in tools). Its tool calls are logged into the session by the link (§5.4), so
 * this side only appends the user message, Claude's text replies and the outcome.
 */
export class ClaudeCodeBackend implements AgentBackend {
  private readonly services: Services
  private readonly plugin: ClaudeCodeLink
  private readonly spawn: typeof child_process.spawn
  private readonly locate: () => string | null
  /** Running runs by session id. */
  private readonly running = new Map<string, ActiveRun>()

  constructor(opts: ClaudeCodeBackendOptions) {
    this.services = opts.services
    this.plugin = opts.plugin
    this.spawn = opts.spawn ?? child_process.spawn
    this.locate =
      opts.locate ??
      (() => locateClaudeOnThisMachine(String(this.plugin.config().claudePath ?? '')))
  }

  isRunning(threadKey: string): boolean {
    return this.running.has(threadKey)
  }

  cancel(runId: string): void {
    for (const [sessionId, run] of this.running) if (run.runId === runId) void this.stop(sessionId)
  }

  /** Kills the session's run, if any, and resolves once it has ended `cancelled`. */
  async stop(sessionId: string): Promise<void> {
    const run = this.running.get(sessionId)
    if (!run) return
    run.cancelled = true
    if (run.child) killTree(run.child)
    await run.done
  }

  /** Stops every run (plugin stop and app quit). */
  async stopAll(): Promise<void> {
    await Promise.all([...this.running.keys()].map((sessionId) => this.stop(sessionId)))
  }

  async start(input: StartRunInput): Promise<{ runId: string }> {
    const { sessionId } = input
    // Check and register with no await in between, so two quick calls cannot both pass.
    if (this.running.has(sessionId)) throw new SessionBusyError(`session ${sessionId}`)
    const runId = newId('run')
    const run: ActiveRun = { runId, child: null, cancelled: false, done: Promise.resolve() }
    this.running.set(sessionId, run)

    let ctx: ProjectContext
    let snapshot: string
    try {
      const { projects, sessions } = this.services
      ctx = await projects.open(input.projectId)
      snapshot = await projectStateText(this.services, ctx, input.activeEpisodeId)
      const userMessage: UserMessage = {
        id: newId('msg'),
        role: 'user',
        text: input.text,
        imagePaths: input.imagePaths,
        stateSnapshot: snapshot,
        createdAt: new Date().toISOString()
      }
      await sessions.append(ctx, sessionId, [userMessage])
    } catch (error) {
      this.release(sessionId, runId)
      throw error
    }

    const projectId = ctx.id
    const emit = (event: AgentEvent): void => this.services.bus.emit({ type: 'agent.event', projectId, threadKey: sessionId, event })
    emit({ kind: 'run-started', runId })
    run.done = this.execute(run, ctx, input, snapshot, emit)
      .catch((error: unknown): RunEnd => {
        console.error('Claude Code run failed unexpectedly:', error)
        return { outcome: 'error', error: messageOf(error) }
      })
      .then((end) => {
        // Free the session first, so a listener that starts the next run on `run-finished` is not refused.
        this.release(sessionId, runId)
        emit({ kind: 'run-finished', runId, outcome: end.outcome, error: end.error })
      })
    return { runId }
  }

  private async execute(run: ActiveRun, ctx: ProjectContext, input: StartRunInput, snapshot: string, emit: (event: AgentEvent) => void): Promise<RunEnd> {
    const url = this.plugin.linkUrl()
    if (url === null) return { outcome: 'error', error: LINK_OFF }
    const exe = this.locate()
    if (exe === null) return { outcome: 'error', error: CLAUDE_NOT_FOUND }
    const resume = (await this.services.sessions.list(ctx)).find((x) => x.id === input.sessionId)?.claudeSessionId ?? null

    // The token only ever sits in this owner-only file, never on the command line.
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'webtoon-claude-'))
    try {
      const configFile = path.join(dir, 'mcp.json')
      const config = {
        mcpServers: {
          webtoon: { type: 'http', url, headers: { Authorization: `Bearer ${this.plugin.token()}`, 'X-Webtoon-Session': input.sessionId } }
        }
      }
      await fs.promises.writeFile(configFile, JSON.stringify(config), { mode: 0o600 })
      const stateFile = path.join(dir, 'state.md')
      await fs.promises.writeFile(stateFile, snapshot, { mode: 0o600 })
      if (run.cancelled) return { outcome: 'cancelled', error: null }
      // The prompt goes on stdin (ruling R12): as an argument, a message starting with `-` or naming a subcommand
      // ("update") would be read by the CLI, and Windows caps the command line at about 32K characters.
      const args = [
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--include-partial-messages',
        '--mcp-config',
        configFile,
        '--strict-mcp-config',
        // The project folder is the cwd: its `.claude/settings*.json` (hooks run shell commands) must not apply (R13).
        '--setting-sources',
        'user',
        '--tools',
        '',
        '--allowedTools',
        'mcp__webtoon__*',
        '--append-system-prompt-file',
        stateFile,
        ...(resume ? ['--resume', resume] : [])
      ]
      return await this.runProcess(run, { exe, args, prompt: input.text, resumed: resume !== null }, ctx, input.sessionId, emit)
    } finally {
      // A leftover temp dir is not worth replacing the run's real outcome.
      await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5 }).catch((error: unknown) => {
        console.warn(`Could not delete the Claude Code run folder ${dir}:`, error)
      })
    }
  }

  /** Spawns `claude`, relays its stream, and resolves with the outcome once the process has closed and every write is done. */
  private runProcess(run: ActiveRun, launch: Launch, ctx: ProjectContext, sessionId: string, emit: (event: AgentEvent) => void): Promise<RunEnd> {
    const { sessions } = this.services
    const { exe, args } = launch
    return new Promise<RunEnd>((resolve) => {
      let child: ChildProcess
      try {
        child = this.spawn(exe, args, { cwd: ctx.paths.root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      } catch (error) {
        resolve({ outcome: 'error', error: `Could not start Claude Code (${exe}): ${messageOf(error)}` })
        return
      }
      run.child = child
      // A process that dies before reading its prompt makes this write fail (EPIPE); 'close' still reports the run.
      child.stdin?.on('error', () => undefined)
      child.stdin?.end(launch.prompt, 'utf8')

      const parser = new StreamJsonParser()
      const stderrDecoder = new StringDecoder('utf8')
      let stderr = ''
      let sawInit = false
      let result: Extract<ClaudeStreamEvent, { kind: 'result' }> | null = null
      let writeError: string | null = null
      let settled = false
      // Writes and events go out in stream order, each after the one before it.
      let queue: Promise<void> = Promise.resolve()
      const later = (step: () => void | Promise<void>): void => {
        queue = queue.then(step).catch((error: unknown) => {
          writeError ??= messageOf(error)
        })
      }

      const handle = (events: ClaudeStreamEvent[]): void => {
        for (const event of events) {
          switch (event.kind) {
            case 'init':
              sawInit = true
              if (event.sessionId !== '') later(() => sessions.setClaudeSessionId(ctx, sessionId, event.sessionId))
              break
            case 'text-delta':
              later(() => emit({ kind: 'text-delta', runId: run.runId, text: event.text }))
              break
            case 'assistant-text': {
              if (event.text === '') break
              const message: AssistantMessage = {
                id: newId('msg'),
                role: 'assistant',
                text: event.text,
                toolCalls: [],
                stopReason: 'end',
                model: MODEL,
                raw: null,
                createdAt: new Date().toISOString()
              }
              later(async () => {
                await sessions.append(ctx, sessionId, [message])
                emit({ kind: 'message', runId: run.runId, message })
              })
              break
            }
            case 'result':
              result = event
              break
          }
        }
      }

      const finish = async (code: number | null, spawnError: Error | null): Promise<void> => {
        if (settled) return
        settled = true
        handle(parser.end())
        // A --resume run that ended before Claude Code started the session could not resume it (moved project,
        // cleared history, another install). Forget the id, or every later run in this chat fails the same way.
        if (launch.resumed && !sawInit && !result && !run.cancelled && !spawnError) {
          later(() => sessions.setClaudeSessionId(ctx, sessionId, ''))
        }
        await queue
        if (run.cancelled) return resolve({ outcome: 'cancelled', error: null })
        if (spawnError) return resolve({ outcome: 'error', error: `Could not start Claude Code (${exe}): ${spawnError.message}` })
        if (result) {
          const end = endOf(result)
          return resolve(end.outcome === 'end' && writeError ? { outcome: 'error', error: `The chat could not be saved: ${writeError}` } : end)
        }
        stderr += stderrDecoder.end()
        const tail = stderr.split(/\r?\n/).filter((line) => line.trim() !== '').slice(-STDERR_LINES).join('\n')
        resolve({ outcome: 'error', error: tail || `Claude Code exited with code ${code ?? 'unknown'} before finishing` })
      }

      child.stdout?.on('data', (chunk: Buffer) => handle(parser.push(chunk)))
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr = (stderr + stderrDecoder.write(chunk)).slice(-STDERR_KEEP)
      })
      child.on('error', (error) => {
        // Only a process that never started ends the run here; anything else is followed by 'close'.
        if (child.pid === undefined) void finish(null, error)
      })
      child.on('close', (code) => void finish(code, null))
    })
  }

  private release(sessionId: string, runId: string): void {
    if (this.running.get(sessionId)?.runId === runId) this.running.delete(sessionId)
  }
}
