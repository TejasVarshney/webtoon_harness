import { newId } from '@shared/ids'
import type { AgentEvent, ChatMessage, Role } from '@shared/types'
import { loadImageForTextModel } from '../domain/image-ops'
import { NoModelForRoleError, type ResolvedModel } from '../models/registry'
import { createTextProvider as defaultCreateTextProvider } from '../models/providers/factory'
import type { TextProvider } from '../models/providers/types'
import type { Services } from '../services'
import type { ProjectContext } from '../storage/project-store'
import { runAgentLoop } from './loop'
import type { ToolRegistry } from './tools/registry'

/** A second run was started on a thread (a chat session, or a panel's side chat) that is still running. */
export class SessionBusyError extends Error {
  constructor(threadKey: string) {
    super(threadKey.startsWith('panel:') ? `A run is already in progress for panel ${threadKey.slice('panel:'.length)}` : `A run is already in progress for session ${threadKey}`)
    this.name = 'SessionBusyError'
  }
}

export interface RunHostOptions {
  services: Services
  createTextProvider?: (r: ResolvedModel) => TextProvider
}

/** What a runner hands over once it has validated the request and stored the user's message. */
export interface PreparedRun {
  ctx: ProjectContext
  /** The thread so far, ending with the user message that was just persisted. */
  history: ChatMessage[]
  persist(msgs: ChatMessage[]): Promise<void>
  /** The parts of a run that depend on the model that was resolved: the system prompt and the tool set. */
  configure(resolved: ResolvedModel): Promise<{ system: string; tools: ToolRegistry }>
}

export interface RunRequest {
  /** The session id, or `panel:<panelId>`. One run at a time per key. */
  threadKey: string
  role: Role
  /** Runs once the thread's slot is held. A throw releases the slot and rejects `start`. */
  prepare(): Promise<PreparedRun>
}

interface ActiveRun {
  runId: string
  controller: AbortController
}

/**
 * The run machinery both chat runners share: one run per thread (check and registration are atomic),
 * cancellation, resolving the role's model, relaying loop events on the bus as `agent.event`, and
 * running the loop in the background. What goes into a thread is the runner's business (`prepare`).
 */
export class RunHost {
  private readonly services: Services
  private readonly createProvider: (r: ResolvedModel) => TextProvider
  /** Running runs by thread key. */
  private readonly running = new Map<string, ActiveRun>()

  constructor(opts: RunHostOptions) {
    this.services = opts.services
    this.createProvider = opts.createTextProvider ?? defaultCreateTextProvider
  }

  isRunning(threadKey: string): boolean {
    return this.running.has(threadKey)
  }

  cancel(runId: string): void {
    for (const run of this.running.values()) if (run.runId === runId) run.controller.abort()
  }

  /** Aborts every run (app quit). Each loop still persists a result for its pending tool calls. */
  cancelAll(): void {
    for (const run of this.running.values()) run.controller.abort()
  }

  async start(req: RunRequest): Promise<{ runId: string }> {
    const { threadKey } = req
    // Check and register with no await in between, so two quick calls cannot both pass.
    if (this.running.has(threadKey)) throw new SessionBusyError(threadKey)
    const runId = newId('run')
    const controller = new AbortController()
    this.running.set(threadKey, { runId, controller })

    let background: Promise<void> | null = null
    try {
      const { bus } = this.services
      const prepared = await req.prepare()
      const { ctx } = prepared
      const emit = (event: AgentEvent): void => bus.emit({ type: 'agent.event', projectId: ctx.id, threadKey, event })

      let resolved: ResolvedModel
      let provider: TextProvider
      try {
        resolved = this.services.registry.resolve(req.role)
        provider = this.createProvider(resolved)
      } catch (err) {
        // A missing role (Review Focus 3) or an unsupported endpoint ends the run cleanly instead of throwing.
        emit({ kind: 'run-finished', runId, outcome: 'error', error: err instanceof Error ? err.message : String(err) })
        if (!(err instanceof NoModelForRoleError)) console.error('agent run could not start:', err)
        this.release(threadKey, runId)
        return { runId }
      }

      const { system, tools } = await prepared.configure(resolved)
      background = runAgentLoop({
        runId,
        provider,
        system,
        history: prepared.history,
        tools,
        toolCtx: { project: ctx, services: this.services, threadKey },
        model: { endpointId: resolved.endpoint.id, modelId: resolved.model.modelId },
        loadImage: (rel) => loadImageForTextModel(ctx, this.services.imageOps, rel),
        signal: controller.signal,
        persist: prepared.persist,
        emit
      }).then(
        () => undefined,
        (err) => console.error('agent loop failed unexpectedly:', err)
      )
    } catch (err) {
      this.release(threadKey, runId)
      throw err
    }
    void background.finally(() => this.release(threadKey, runId))
    return { runId }
  }

  private release(threadKey: string, runId: string): void {
    if (this.running.get(threadKey)?.runId === runId) this.running.delete(threadKey)
  }
}
