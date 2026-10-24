import { z } from 'zod'
import type { Services } from '../../services'
import { parseInput } from '../validate'
import type { HandlerMap } from './projects'

const RenameSchema = z.object({ projectId: z.string(), sessionId: z.string(), title: z.string().trim().min(1) })

export function sessionsHandlers(s: Services): HandlerMap {
  return {
    'sessions:list': async ({ projectId }) => s.sessions.list(await s.projects.open(projectId)),
    'sessions:create': async ({ projectId }) => s.sessions.create(await s.projects.open(projectId)),
    'sessions:rename': async (req) => {
      const { projectId, sessionId, title } = parseInput(RenameSchema, req)
      return s.sessions.rename(await s.projects.open(projectId), sessionId, title)
    },
    'sessions:delete': async ({ projectId, sessionId }) => {
      const ctx = await s.projects.open(projectId)
      // A run must not keep calling the model (and spending) for a session that is gone.
      await s.agent.stop(sessionId)
      return s.sessions.delete(ctx, sessionId)
    },
    'sessions:load': async ({ projectId, sessionId }) => s.sessions.load(await s.projects.open(projectId), sessionId)
  }
}
