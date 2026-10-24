import { z } from 'zod'
import { EntityNotFoundError, PathEscapeError } from '../../domain/errors'
import { ToolError, defineTool, type ToolDefinition } from './registry'

/**
 * The listed doc a model meant: the name as given, without a trailing `.md`, or, for a bare file name
 * such as `panel-generation`, the one listed doc in a folder with that file name. Null when none fits.
 */
function resolveName(name: string, listed: string[]): string | null {
  const trimmed = name.trim().replace(/\.md$/i, '')
  if (listed.includes(trimmed) || trimmed === 'AGENTS') return trimmed
  if (trimmed.includes('/')) return null
  const matches = listed.filter((doc) => doc.endsWith(`/${trimmed}`))
  return matches.length === 1 ? matches[0] : null
}

const readWorkflowDoc = defineTool({
  name: 'read_workflow_doc',
  description:
    'Read one of the project\'s workflow docs: the step-by-step rules for a kind of task. Pass the name from the doc index in your instructions, ' +
    'e.g. "workflows/panel-generation" (no ".md"). Read the doc a task needs before you start that task.',
  input: z.object({ name: z.string().min(1).describe('Doc name from the index, e.g. "workflows/panel-generation"') }),
  handler: async ({ name }, ctx) => {
    const listed = (await ctx.services.docs.list(ctx.project)).map((d) => d.name)
    const unknown = (): ToolError => new ToolError(`Unknown doc: ${name}. Available: ${listed.join(', ')}`)
    const resolved = resolveName(name, listed)
    if (resolved === null) throw unknown()
    try {
      return { content: await ctx.services.docs.read(ctx.project, resolved) }
    } catch (error) {
      if (error instanceof EntityNotFoundError || error instanceof PathEscapeError) throw unknown()
      throw error
    }
  }
})

export const docTools: ToolDefinition[] = [readWorkflowDoc]
