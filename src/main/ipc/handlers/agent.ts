import { z } from 'zod'
import { PathEscapeError } from '../../domain/errors'
import type { Services } from '../../services'
import { IdSchema, parseInput } from '../validate'
import type { HandlerMap } from './projects'

const SendSchema = z.object({
  projectId: z.string(),
  sessionId: z.string(),
  text: z.string(),
  imagePaths: z.array(z.string()),
  activeEpisodeId: IdSchema.nullable()
})

export function agentHandlers(s: Services): HandlerMap {
  return {
    'agent:send': async (req) => {
      const input = parseInput(SendSchema, req)
      // Attachments are project-relative paths; anything resolveAsset refuses would be read from outside the project.
      const ctx = await s.projects.open(input.projectId)
      for (const p of input.imagePaths) {
        try {
          ctx.paths.resolveAsset(p)
        } catch (error) {
          if (error instanceof PathEscapeError) throw new Error(`Invalid input: imagePaths: not a project file: ${p}`)
          throw error
        }
      }
      return s.agent.start(input)
    },
    'agent:cancel': async ({ runId }) => s.agent.cancel(runId)
  }
}
