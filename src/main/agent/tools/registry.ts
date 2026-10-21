import { z } from 'zod'
import type { ToolCall, ToolResult } from '@shared/types'
import type { ToolSpec } from '../../models/providers/types'
import type { ProjectContext } from '../../storage/project-store'
import type { Services } from '../../services'

export interface ToolContext {
  project: ProjectContext
  services: Services
  signal: AbortSignal
  threadKey: string
}

export interface ToolOutput {
  content: string | Record<string, unknown>
  images?: string[]
}

export interface ToolDefinition {
  name: string
  description: string
  input: z.ZodType
  handler(input: never, ctx: ToolContext): Promise<ToolOutput>
}

/** A user-facing handler failure: its message goes back to the model verbatim. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolError'
  }
}

export function defineTool<S extends z.ZodType>(def: {
  name: string
  description: string
  input: S
  handler(input: z.infer<S>, ctx: ToolContext): Promise<ToolOutput>
}): ToolDefinition {
  return def
}

function formatIssues(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`).join('; ')
}

export class ToolRegistry {
  private readonly byName = new Map<string, ToolDefinition>()

  constructor(defs: ToolDefinition[]) {
    for (const d of defs) this.byName.set(d.name, d)
  }

  names(): string[] {
    return [...this.byName.keys()]
  }

  specs(): ToolSpec[] {
    return [...this.byName.values()].map((d) => ({
      name: d.name,
      description: d.description,
      inputSchema: z.toJSONSchema(d.input) as Record<string, unknown>
    }))
  }

  /** Never throws: every failure becomes an `ok: false` result the model can read. */
  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    const fail = (content: string): ToolResult => ({ toolCallId: call.id, name: call.name, ok: false, content, images: [] })
    const def = this.byName.get(call.name)
    if (!def) return fail(`Unknown tool: ${call.name}`)
    const parsed = def.input.safeParse(call.input)
    if (!parsed.success) return fail(`Invalid input for ${call.name}: ${formatIssues(parsed.error)}`)
    try {
      const out = await def.handler(parsed.data as never, ctx)
      const content = typeof out.content === 'string' ? out.content : JSON.stringify(out.content)
      return { toolCallId: call.id, name: call.name, ok: true, content, images: out.images ?? [] }
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err))
    }
  }
}
