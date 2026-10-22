import fs from 'node:fs'
import { newId } from '@shared/ids'
import { ChatMessageSchema } from '@shared/schemas'
import type { ChatMessage, UserMessage } from '@shared/types'
import { EntityNotFoundError } from '../domain/errors'
import type { ResolvedModel } from '../models/registry'
import type { TextProvider } from '../models/providers/types'
import type { Services } from '../services'
import { appendJsonl, readJsonl } from '../storage/jsonl'
import type { ProjectContext } from '../storage/project-store'
import { RunHost } from './run-host'
import { buildPanelChatSystemPrompt, buildPanelContext } from './system-prompt'
import { buildPanelChatTools, loadPanelBundle } from './tools/panel-chat-tools'
import { isNotFound } from '../storage/fs-errors'

/** Shown as the run's error when the panel goes away under a running chat. */
const PANEL_DELETED = 'Panel was deleted'
const PANEL_EDITING_DOC = 'workflows/panel-editing'

export interface PanelChatRunnerOptions {
  services: Services
  createTextProvider?: (r: ResolvedModel) => TextProvider
}

export interface StartPanelChatInput {
  projectId: string
  panelId: string
  text: string
}

/**
 * The side chat of one panel: its own thread (`panels/<pnlId>.chat.jsonl`), its own run slot, and tools
 * that can only touch that panel. It shares the run machinery with `AgentRunner` through `RunHost`.
 */
export class PanelChatRunner {
  private readonly services: Services
  private readonly host: RunHost

  constructor(opts: PanelChatRunnerOptions) {
    this.services = opts.services
    this.host = new RunHost(opts)
  }

  /** `threadKey` is `panel:<panelId>`. */
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

  /** The panel's thread, oldest first. A panel nobody has talked to yet has none. */
  async load(ctx: ProjectContext, panelId: string): Promise<ChatMessage[]> {
    try {
      return (await readJsonl(ctx.paths.panelChatFile(panelId), ChatMessageSchema)).records
    } catch (error) {
      if (isNotFound(error)) return []
      throw error
    }
  }

  start(input: StartPanelChatInput): Promise<{ runId: string }> {
    return this.host.start({
      threadKey: `panel:${input.panelId}`,
      subject: `panel ${input.panelId}`,
      role: 'panelChat',
      prepare: async () => {
        const ctx = await this.services.projects.open(input.projectId)
        // An unknown panel rejects here, before anything is written.
        const { panel, roster, previous, next } = await loadPanelBundle(this.services, ctx, input.panelId)
        const history = await this.load(ctx, panel.id)
        const userMessage: UserMessage = {
          id: newId('msg'),
          role: 'user',
          text: input.text,
          imagePaths: [],
          stateSnapshot: buildPanelContext(panel, roster, previous, next),
          createdAt: new Date().toISOString()
        }
        const persist = (msgs: ChatMessage[]): Promise<void> => this.append(ctx, panel.id, msgs)
        await persist([userMessage])
        return {
          ctx,
          history: [...history, userMessage],
          persist,
          configure: async (resolved) => ({
            system: buildPanelChatSystemPrompt(await this.services.docs.agentsMd(ctx), await this.editingDoc(ctx)),
            tools: buildPanelChatTools(panel.id, { vision: resolved.model.capabilities.includes('vision') })
          })
        }
      }
    })
  }

  /**
   * Ruling T21a. Appends under the chat file's lock, but only while the panel still exists: once it is gone the
   * write is refused (the loop then ends the run with this error) instead of recreating a chat file for a deleted panel.
   * `PanelService.delete` trashes the chat file while holding the PANEL file's lock, so the check and the append also
   * hold that lock: they cannot interleave with a delete. Lock order is always chat file, then panel file, and
   * nothing takes them the other way round.
   */
  private append(ctx: ProjectContext, panelId: string, msgs: ChatMessage[]): Promise<void> {
    const chat = ctx.paths.panelChatFile(panelId)
    const panelFile = ctx.paths.panelFile(panelId)
    return ctx.mutex.run(chat, () =>
      ctx.mutex.run(panelFile, async () => {
        try {
          await fs.promises.access(panelFile)
        } catch (error) {
          throw isNotFound(error) ? new Error(PANEL_DELETED) : error
        }
        await appendJsonl(chat, msgs)
      })
    )
  }

  /** The project's panel-editing workflow doc, or '' while it does not have one. */
  private async editingDoc(ctx: ProjectContext): Promise<string> {
    try {
      return await this.services.docs.read(ctx, PANEL_EDITING_DOC)
    } catch (error) {
      if (error instanceof EntityNotFoundError) return ''
      throw error
    }
  }
}
