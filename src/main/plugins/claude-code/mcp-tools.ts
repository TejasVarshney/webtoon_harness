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
    'The current <project_state> snapshot: project, story mode, style, characters, items, current episode and its last panels. Call it before planning or drawing.',
  inputSchema: { type: 'object', properties: {} }
}

const CONNECTION_INSTRUCTIONS =
  'You are connected to the Webtoon AI Harness through MCP. Call `get_project_state` before you plan or draw, and again after the user may have changed things. Read workflow docs with `read_workflow_doc`.'

export type McpContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

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

  /** The project the window shows, or null when none is open (or the one it names no longer opens). */
  async activeProject(): Promise<ProjectContext | null> {
    const { projectId } = this.activeContext.get()
    if (!projectId) return null
    try {
      return await this.services.projects.open(projectId)
    } catch {
      return null
    }
  }

  makeCall(name: string, args: unknown): ToolCall {
    return { id: newId('call'), name, input: args }
  }

  /** Runs `toolCall` for `ctx`. Never throws for a tool failure: it comes back as an `isError` result. */
  async call(
    ctx: ProjectContext,
    toolCall: ToolCall,
    opts: { signal: AbortSignal; threadKey: string }
  ): Promise<{ result: McpCallResult; toolResult: ToolResult }> {
    const toolResult =
      toolCall.name === PROJECT_STATE_TOOL
        ? {
            toolCallId: toolCall.id,
            name: toolCall.name,
            ok: true,
            content: await projectStateText(this.services, ctx, this.activeContext.get().episodeId),
            images: []
          }
        : await this.registry.execute(toolCall, { project: ctx, services: this.services, signal: opts.signal, threadKey: opts.threadKey })
    const content: McpContent[] = [{ type: 'text', text: toolResult.content }]
    for (const relPath of toolResult.images) content.push(await this.imageContent(ctx, relPath))
    return { result: { content, ...(toolResult.ok ? {} : { isError: true }) }, toolResult }
  }

  /** `buildAgentSystemPrompt` for the project, then the MCP paragraph; the paragraph alone with no project. */
  async instructions(ctx: ProjectContext | null): Promise<string> {
    if (!ctx) return CONNECTION_INSTRUCTIONS
    const prompt = buildAgentSystemPrompt(await this.services.docs.agentsMd(ctx), await this.services.docs.list(ctx))
    return `${prompt}\n\n${CONNECTION_INSTRUCTIONS}`
  }

  /** A downscaled JPEG of a project image; an image that is gone for good becomes a text note, as in a replayed history. */
  private async imageContent(ctx: ProjectContext, relPath: string): Promise<McpContent> {
    try {
      const { mime, base64 } = await loadImageForTextModel(ctx, this.services.imageOps, relPath)
      return { type: 'image', data: base64, mimeType: mime }
    } catch (error) {
      if (error instanceof ImageUnavailableError) return { type: 'text', text: unavailableNote(relPath) }
      throw error
    }
  }
}
