import { newId } from '@shared/ids'
import type { UserMessage } from '@shared/types'
import type { ResolvedModel } from '../models/registry'
import type { TextProvider } from '../models/providers/types'
import type { AgentBackend } from '../plugins/types'
import type { Services } from '../services'
import { projectStateText } from './project-state'
import { RunHost, SessionBusyError } from './run-host'
import { buildAgentSystemPrompt } from './system-prompt'
import { buildAgentTools } from './tools'

export { SessionBusyError } from './run-host'

const DRIVEN_READ_ONLY = 'This session is driven by Claude Code and is read-only.'

export interface AgentRunnerOptions {
  services: Services
  createTextProvider?: (r: ResolvedModel) => TextProvider
}

export interface StartRunInput {
  projectId: string
  sessionId: string
  text: string
  imagePaths: string[]
  activeEpisodeId: string | null
}

/**
 * Connects chat sessions to the agent loop: builds the prompt and state snapshot, persists, and relays events.
 * When a plugin is set to be the agent (`PluginManager.agentBackend()`), new runs go to it instead;
 * stopping and status cover both, so a run started before the switch changed can still be stopped.
 */
export class AgentRunner {
  private readonly services: Services
  private readonly host: RunHost
  /** Per session, settles once the latest start has passed the driver check and registered its run. */
  private readonly startGates = new Map<string, Promise<void>>()

  constructor(opts: AgentRunnerOptions) {
    this.services = opts.services
    this.host = new RunHost(opts)
  }

  isRunning(threadKey: string): boolean {
    return this.host.isRunning(threadKey) || this.services.plugins.agentBackends().some((b) => b.isRunning(threadKey))
  }

  cancel(runId: string): void {
    this.host.cancel(runId)
    for (const b of this.services.plugins.agentBackends()) b.cancel(runId)
  }

  /** Aborts the session's run, if any, and resolves once it has ended. */
  async stop(sessionId: string): Promise<void> {
    await Promise.all([this.host.stop(sessionId), ...this.services.plugins.agentBackends().map((b) => b.stop(sessionId))])
  }

  /** Aborts every run (app quit). Each loop still persists a result for its pending tool calls. */
  cancelAll(): void {
    this.host.cancelAll()
  }

  async start(input: StartRunInput): Promise<{ runId: string }> {
    const { sessionId } = input
    // The driver check awaits, so the starts of one session pass it in call order: each registers its run (the
    // synchronous start of `startChecked`) before the next is let through, and an earlier message is never refused
    // as busy in favour of a later one.
    const before = this.startGates.get(sessionId) ?? Promise.resolve()
    let open = (): void => {}
    const mine = new Promise<void>((resolve) => (open = resolve))
    const gate = before.then(() => mine)
    this.startGates.set(sessionId, gate)
    try {
      await before
      await this.refuseDriven(input)
      return this.startChecked(input)
    } finally {
      open()
      if (this.startGates.get(sessionId) === gate) this.startGates.delete(sessionId)
    }
  }

  /** Registers the run before its first await (the backend's and RunHost's busy check work that way too). */
  private startChecked(input: StartRunInput): Promise<{ runId: string }> {
    const backend = this.backend()
    if (backend) {
      // A model-loop run from before the switch still holds the session.
      if (this.host.isRunning(input.sessionId)) throw new SessionBusyError(`session ${input.sessionId}`)
      return backend.start(input)
    }
    // A plugin run from before the switch was turned off still holds the session.
    if (this.services.plugins.agentBackends().some((b) => b.isRunning(input.sessionId))) throw new SessionBusyError(`session ${input.sessionId}`)
    return this.host.start({
      threadKey: input.sessionId,
      subject: `session ${input.sessionId}`,
      role: 'agent',
      prepare: async () => {
        const { sessions, projects } = this.services
        const ctx = await projects.open(input.projectId)
        const history = await sessions.load(ctx, input.sessionId)
        const snapshot = await projectStateText(this.services, ctx, input.activeEpisodeId)
        const userMessage: UserMessage = {
          id: newId('msg'),
          role: 'user',
          text: input.text,
          imagePaths: input.imagePaths,
          stateSnapshot: snapshot,
          createdAt: new Date().toISOString()
        }
        await sessions.append(ctx, input.sessionId, [userMessage])
        return {
          ctx,
          history: [...history, userMessage],
          persist: (msgs) => sessions.append(ctx, input.sessionId, msgs),
          configure: async (resolved) => ({
            system: buildAgentSystemPrompt(await this.services.docs.agentsMd(ctx), await this.services.docs.list(ctx)),
            tools: buildAgentTools({ vision: resolved.model.capabilities.includes('vision') })
          })
        }
      }
    })
  }

  /** A session Claude Code drives over MCP is its log; nothing else may write to it (the renderer hides the controls too). */
  private async refuseDriven(input: StartRunInput): Promise<void> {
    const ctx = await this.services.projects.open(input.projectId)
    const session = (await this.services.sessions.list(ctx)).find((x) => x.id === input.sessionId)
    if (session !== undefined && session.driver !== null) throw new Error(DRIVEN_READ_ONLY)
  }

  /** Read at call time: plugins are created after the runner, and the switch can change at any moment. */
  private backend(): AgentBackend | null {
    return this.services.plugins.agentBackend()
  }
}
