import type { Services } from '../../services'
import type { HandlerMap } from './projects'

export function sessionsHandlers(s: Services): HandlerMap {
  return {
    'sessions:list': async ({ projectId }) => s.sessions.list(await s.projects.open(projectId)),
    'sessions:create': async ({ projectId }) => s.sessions.create(await s.projects.open(projectId)),
    'sessions:rename': async ({ projectId, sessionId, title }) => s.sessions.rename(await s.projects.open(projectId), sessionId, title),
    'sessions:delete': async ({ projectId, sessionId }) => s.sessions.delete(await s.projects.open(projectId), sessionId),
    'sessions:load': async ({ projectId, sessionId }) => s.sessions.load(await s.projects.open(projectId), sessionId)
  }
}
