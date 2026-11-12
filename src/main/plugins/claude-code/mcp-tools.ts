import { newId } from '@shared/ids'
import type { ToolCall, ToolResult } from '@shared/types'
import { buildAgentSystemPrompt } from '../../agent/system-prompt'
import { projectStateText } from '../../agent/project-state'
import { buildAgentTools } from '../../agent/tools'
import type { ToolRegistry } from '../../agent/tools/registry'
import { loadImageForTextModel } from '../../domain/image-ops'
import { unavailableNote } from '../../models/providers/image-replay'
import { ImageUnavailableError, type ToolSpec } from '../../models/providers/types'
import type { Services } from '../../services'
import type { ProjectContext } from '../../storage/project-store'
import type { ActiveContext } from '../active-context'

export const NO_PROJECT = 'Open a project in the Webtoon AI Harness window first.'

const PROJECT_STATE_TOOL = 'get_project_state'

const PROJECT_STATE_SPEC: ToolSpec = {
  name: PROJECT_STATE_TOOL,
  description:
    'The current <project_state> snapshot: project, style, characters, items, current episode and its last panels. Call it before planning or drawing.',
  inputSchema: { type: 'object', properties: {} }
}

const CONNECTION_INSTRUCTIONS =
  'You are connected to the Webtoon AI Harness through MCP. Call `get_project_state` before you plan or draw, and again after the user may have changed things. Read workflow docs with `read_workflow_doc`.'

export type McpContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

/** A project to act on and the episode `get_project_state` names (null: the project's first). */
export interface McpTarget {
  ctx: ProjectContext
  episodeId: string | null
}

export interface McpCallResult {
  content: McpContent[]
  isError?: boolean
}

/** The agent's tool set in MCP shape: the same tools, schemas and results the in-app agent gets, plus `get_project_state`. */
export class McpToolAdapter {
  private readonly services: Services
  private readonly activeContext: ActiveContext
  private readonly registry: ToolRegistry

  /** `registry` is a test seam; the real set is `buildAgentTools({ vision: true })`. */
  constructor(opts: { services: Services; activeContext: ActiveContext; registry?: ToolRegistry }) {
    this.services = opts.services
    this.activeContext = opts.activeContext
    this.registry = opts.registry ?? buildAgentTools({ vision: true })
  }

  listTools(): ToolSpec[] {
    return [...this.registry.specs(), PROJECT_STATE_SPEC]
  }

  /**
   * The project and episode a request acts on. A named project (the backend's `X-Webtoon-Project`) is
   * opened and used with the named episode; if it does not open this throws, and never falls back to the window.
   * With none named, the project and episode the window shows: null when none is open (or it no longer opens).
   */
  async target(named: { projectId: string | null; episodeId: string | null }): Promise<McpTarget | null> {
    if (named.projectId !== null) {
      try {
        return { ctx: await this.services.projects.open(named.projectId), episodeId: named.episodeId }
      } catch (error) {
        throw new Error(`The project this run belongs to (${named.projectId}) could not be opened: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const { projectId, episodeId } = this.activeContext.get()
    if (!projectId) return null
    try {
      return { ctx: await this.services.projects.open(projectId), episodeId }
    } catch {
      return null
    }
  }

  makeCall(name: string, args: unknown): ToolCall {
    return { id: newId('call'), name, input: args }
  }

  /** Runs `toolCall` for `ctx`; `episodeId` is the one `get_project_state` names (left out: the window's). Always resolves: a tool failure, or an image that cannot be loaded, comes back inside the result (`isError` for a failed tool). */
  async call(
    ctx: ProjectContext,
    toolCall: ToolCall,
    opts: { signal: AbortSignal; threadKey: string; episodeId?: string | null }
  ): Promise<{ result: McpCallResult; toolResult: ToolResult }> {
    const toolResult =
      toolCall.name === PROJECT_STATE_TOOL
        ? await this.projectState(ctx, toolCall, opts.episodeId === undefined ? this.activeContext.get().episodeId : opts.episodeId)
        : await this.registry.execute(toolCall, { project: ctx, services: this.services, signal: opts.signal, threadKey: opts.threadKey })
    const content: McpContent[] = [{ type: 'text', text: toolResult.content }]
    for (const relPath of toolResult.images) content.push(await this.imageContent(ctx, relPath))
    return { result: { content, ...(toolResult.ok ? {} : { isError: true }) }, toolResult }
  }

  /** The snapshot as a ToolResult; a failure to gather it is an `ok: false` result, as `execute` makes of a handler's. */
  private async projectState(ctx: ProjectContext, toolCall: ToolCall, episodeId: string | null): Promise<ToolResult> {
    try {
      const content = await projectStateText(this.services, ctx, episodeId)
      return { toolCallId: toolCall.id, name: toolCall.name, ok: true, content, images: [] }
    } catch (error) {
      return { toolCallId: toolCall.id, name: toolCall.name, ok: false, content: error instanceof Error ? error.message : String(error), images: [] }
    }
  }

  /** `buildAgentSystemPrompt` for the project, then the MCP paragraph; the paragraph alone with no project. */
  async instructions(ctx: ProjectContext | null): Promise<string> {
    if (!ctx) return CONNECTION_INSTRUCTIONS
    const prompt = buildAgentSystemPrompt(await this.services.docs.agentsMd(ctx), await this.services.docs.list(ctx))
    return `${prompt}\n\n${CONNECTION_INSTRUCTIONS}`
  }

  /** A downscaled JPEG of a project image. The tool has already run, so an image that cannot be loaded becomes a text note rather than failing the call. */
  private async imageContent(ctx: ProjectContext, relPath: string): Promise<McpContent> {
    try {
      const { mime, base64 } = await loadImageForTextModel(ctx, this.services.imageOps, relPath)
      return { type: 'image', data: base64, mimeType: mime }
    } catch (error) {
      // Gone for good: the same note a replayed history carries. Anything else (a locked file, a failed resize) is named as unloadable.
      return { type: 'text', text: error instanceof ImageUnavailableError ? unavailableNote(relPath) : `[image could not be loaded: ${relPath}]` }
    }
  }
}
