import { newId } from '@shared/ids'
import type { AgentEvent, ChatMessage, ToolCall, ToolResult } from '@shared/types'
import type { EventBus } from '../../events/bus'
import type { SessionStore } from '../../sessions/session-store'
import type { ProjectContext } from '../../storage/project-store'

const SESSION_TITLE = 'Claude Code'
/** The model recorded on logged assistant messages: Claude Code is not one of the configured endpoints. */
const MODEL = { endpointId: 'plugin:claude-code', modelId: 'claude-code' }

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * Logs the tool calls Claude Code makes over MCP into a chat session of the active project (spec §5.4),
 * so the chat pane shows them like the in-app agent's steps. A failed write never fails the call: the
 * first failure is kept for `lastError()`.
 */
export class DriverSessionLog {
  private readonly sessions: SessionStore
  private readonly bus: EventBus
  /** (MCP session, project) → driver session. The promise is stored so concurrent first calls share one create. */
  private readonly driverSessions = new Map<string, Promise<string>>()
  /** Log session → the MCP session that writes to it, and the run id its events share. */
  private readonly runs = new Map<string, { mcpSessionId: string; runId: string }>()
  private readonly runIdByMcpSession = new Map<string, string>()
  private firstError: string | null = null

  constructor(opts: { sessions: SessionStore; bus: EventBus }) {
    this.sessions = opts.sessions
    this.bus = opts.bus
  }

  /**
   * The session for one MCP session id: `requested` when it names a session of ctx's project, else a
   * "Claude Code" driver session created on first use and reused while the project stays the same.
   * If that session cannot be created the failure is recorded and an id with no file behind it is returned,
   * so the call still runs (its log writes then fail quietly) and the next call tries again.
   */
  async resolve(ctx: ProjectContext, mcpSessionId: string, requested: string | null): Promise<string> {
    let sessionId: string | null = null
    if (requested !== null) {
      try {
        if ((await this.sessions.list(ctx)).some((s) => s.id === requested)) sessionId = requested
      } catch (error) {
        this.fail(error)
      }
    }
    sessionId ??= await this.driverSession(ctx, mcpSessionId)
    this.runs.set(sessionId, { mcpSessionId, runId: this.runIdFor(mcpSessionId) })
    return sessionId
  }

  /** Before the tool runs: the assistant message carrying the call, then `tool-started` and `message` events. */
  async recordCall(ctx: ProjectContext, sessionId: string, call: ToolCall): Promise<void> {
    const message: ChatMessage = {
      id: newId('msg'),
      role: 'assistant',
      text: '',
      toolCalls: [call],
      stopReason: 'tool_use',
      model: MODEL,
      raw: null,
      createdAt: new Date().toISOString()
    }
    const runId = this.runIdOf(sessionId)
    if (!(await this.write(ctx, sessionId, message))) return
    this.emit(ctx, sessionId, { kind: 'tool-started', runId, toolCall: call })
    this.emit(ctx, sessionId, { kind: 'message', runId, message })
  }

  /** After the tool ran: the tool message with its result. `SessionStore.append` emits `session.changed`. */
  async recordResult(ctx: ProjectContext, sessionId: string, result: ToolResult): Promise<void> {
    const message: ChatMessage = { id: newId('msg'), role: 'tool', results: [result], createdAt: new Date().toISOString() }
    const runId = this.runIdOf(sessionId)
    if (!(await this.write(ctx, sessionId, message))) return
    this.emit(ctx, sessionId, { kind: 'message', runId, message })
  }

  /** Call when an MCP session ends. */
  forget(mcpSessionId: string): void {
    for (const key of [...this.driverSessions.keys()]) {
      if (key.startsWith(`${mcpSessionId}\0`)) this.driverSessions.delete(key)
    }
    for (const [sessionId, run] of [...this.runs]) {
      if (run.mcpSessionId === mcpSessionId) this.runs.delete(sessionId)
    }
    this.runIdByMcpSession.delete(mcpSessionId)
  }

  /** The first log failure since the app started, for the plugin status. */
  lastError(): string | null {
    return this.firstError
  }

  private driverSession(ctx: ProjectContext, mcpSessionId: string): Promise<string> {
    const key = `${mcpSessionId}\0${ctx.id}`
    let pending = this.driverSessions.get(key)
    if (!pending) {
      pending = this.sessions.create(ctx, { title: SESSION_TITLE, driver: 'claude-code' }).then(
        (summary) => summary.id,
        (error: unknown) => {
          this.driverSessions.delete(key)
          this.fail(error)
          return newId('ses')
        }
      )
      this.driverSessions.set(key, pending)
    }
    return pending
  }

  private runIdFor(mcpSessionId: string): string {
    let runId = this.runIdByMcpSession.get(mcpSessionId)
    if (!runId) {
      runId = newId('run')
      this.runIdByMcpSession.set(mcpSessionId, runId)
    }
    return runId
  }

  private runIdOf(sessionId: string): string {
    return this.runs.get(sessionId)?.runId ?? newId('run')
  }

  private async write(ctx: ProjectContext, sessionId: string, message: ChatMessage): Promise<boolean> {
    try {
      await this.sessions.append(ctx, sessionId, [message])
      return true
    } catch (error) {
      this.fail(error)
      return false
    }
  }

  private emit(ctx: ProjectContext, threadKey: string, event: AgentEvent): void {
    this.bus.emit({ type: 'agent.event', projectId: ctx.id, threadKey, event })
  }

  private fail(error: unknown): void {
    this.firstError ??= errorMessage(error)
  }
}
