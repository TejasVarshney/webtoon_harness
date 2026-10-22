import { newId } from '@shared/ids'
import type { UserMessage } from '@shared/types'
import type { ResolvedModel } from '../models/registry'
import type { TextProvider } from '../models/providers/types'
import type { Services } from '../services'
import type { ProjectContext } from '../storage/project-store'
import { RunHost } from './run-host'
import { buildAgentSystemPrompt, buildStateSnapshot } from './system-prompt'
import { buildAgentTools } from './tools'

export { SessionBusyError } from './run-host'

/** How many of the current episode's final panels the state snapshot summarizes. */
const RECENT_PANELS = 3

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

/** Connects chat sessions to the agent loop: builds the prompt and state snapshot, persists, and relays events. */
export class AgentRunner {
  private readonly services: Services
  private readonly host: RunHost

  constructor(opts: AgentRunnerOptions) {
    this.services = opts.services
    this.host = new RunHost(opts)
  }

  isRunning(threadKey: string): boolean {
    return this.host.isRunning(threadKey)
  }

  cancel(runId: string): void {
    this.host.cancel(runId)
  }

  /** Aborts every run (app quit). Each loop still persists a result for its pending tool calls. */
  cancelAll(): void {
    this.host.cancelAll()
  }

  start(input: StartRunInput): Promise<{ runId: string }> {
    return this.host.start({
      threadKey: input.sessionId,
      subject: `session ${input.sessionId}`,
      role: 'agent',
      prepare: async () => {
        const { sessions, projects } = this.services
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
}
