import { newId } from '@shared/ids'
import type { AgentEvent, ChatMessage, UserMessage } from '@shared/types'
import { loadImageForTextModel } from '../domain/image-ops'
import { NoModelForRoleError, type ResolvedModel } from '../models/registry'
import { createTextProvider as defaultCreateTextProvider } from '../models/providers/factory'
import type { TextProvider } from '../models/providers/types'
import type { Services } from '../services'
import type { ProjectContext } from '../storage/project-store'
import { runAgentLoop } from './loop'
import { buildAgentSystemPrompt, buildStateSnapshot } from './system-prompt'
import { buildAgentTools } from './tools'

/** How many of the current episode's final panels the state snapshot summarizes. */
const RECENT_PANELS = 3

export class SessionBusyError extends Error {
  constructor(sessionId: string) {
    super(`A run is already in progress for session ${sessionId}`)
    this.name = 'SessionBusyError'
  }
}

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

interface ActiveRun {
  runId: string
  controller: AbortController
}

/** Connects chat sessions to the agent loop: builds the prompt and state snapshot, persists, and relays events. */
export class AgentRunner {
  private readonly services: Services
  private readonly createProvider: (r: ResolvedModel) => TextProvider
  /** Running runs by thread key (the session id). */
  private readonly running = new Map<string, ActiveRun>()

  constructor(opts: AgentRunnerOptions) {
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

  async start(input: StartRunInput): Promise<{ runId: string }> {
    const threadKey = input.sessionId
    // Check and register with no await in between, so two quick calls cannot both pass.
    if (this.running.has(threadKey)) throw new SessionBusyError(threadKey)
    const runId = newId('run')
    const controller = new AbortController()
    this.running.set(threadKey, { runId, controller })

    let background: Promise<void> | null = null
    try {
      const { sessions, projects, bus } = this.services
      const ctx = await projects.open(input.projectId)
      const history = await sessions.load(ctx, input.sessionId)
      const snapshot = buildStateSnapshot(await this.gatherState(ctx, input.activeEpisodeId))
      const userMessage: UserMessage = {
        id: newId('msg'),
        role: 'user',
        text: input.text,
        imagePaths: input.imagePaths,
        stateSnapshot: snapshot,
        createdAt: new Date().toISOString()
      }
      await sessions.append(ctx, input.sessionId, [userMessage])

      const emit = (event: AgentEvent): void => bus.emit({ type: 'agent.event', projectId: ctx.id, threadKey, event })

      let resolved: ResolvedModel
      let provider: TextProvider
      try {
        resolved = this.services.registry.resolve('agent')
        provider = this.createProvider(resolved)
      } catch (err) {
        // A missing role (Review Focus 3) or an unsupported endpoint ends the run cleanly instead of throwing.
        emit({ kind: 'run-finished', runId, outcome: 'error', error: err instanceof Error ? err.message : String(err) })
        if (!(err instanceof NoModelForRoleError)) console.error('agent run could not start:', err)
        this.release(threadKey, runId)
        return { runId }
      }

      const system = buildAgentSystemPrompt(await this.services.docs.agentsMd(ctx), await this.services.docs.list(ctx))
      background = runAgentLoop({
        runId,
        provider,
        system,
        history: [...history, userMessage],
        tools: buildAgentTools({ vision: resolved.model.capabilities.includes('vision') }),
        toolCtx: { project: ctx, services: this.services, threadKey },
        model: { endpointId: resolved.endpoint.id, modelId: resolved.model.modelId },
        loadImage: (rel) => loadImageForTextModel(ctx, this.services.imageOps, rel),
        signal: controller.signal,
        persist: (msgs: ChatMessage[]) => sessions.append(ctx, input.sessionId, msgs),
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

  /**
   * What the state snapshot is built from. The current episode is the one the app has open (`activeEpisodeId`),
   * or the first episode when that id is absent or no longer exists: a stale id from the renderer must not fail a run.
   */
  protected async gatherState(ctx: ProjectContext, activeEpisodeId: string | null): Promise<Parameters<typeof buildStateSnapshot>[0]> {
    // Archived characters are included on purpose: the snapshot drops them from the roster but still uses them to name panel speakers.
    const characters = await this.services.characters.list(ctx, { includeArchived: true })
    const episodes = await this.services.episodes.list(ctx)
    const episode = episodes.find((e) => e.id === activeEpisodeId) ?? episodes[0] ?? null
    const recentPanels = episode ? (await this.services.panels.list(ctx, episode.id)).slice(-RECENT_PANELS) : []
    return { meta: await this.services.projects.getMeta(ctx), characters, episode, recentPanels }
  }

  private release(threadKey: string, runId: string): void {
    if (this.running.get(threadKey)?.runId === runId) this.running.delete(threadKey)
  }
}
