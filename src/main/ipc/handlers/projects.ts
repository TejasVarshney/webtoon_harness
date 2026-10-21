import type { IpcChannel, IpcContract } from '@shared/ipc'
import type { Services } from '../../services'

export type HandlerMap = { [C in IpcChannel]?: (req: IpcContract[C]['req']) => Promise<IpcContract[C]['res']> }

export function projectsHandlers(s: Services): HandlerMap {
  return {
    'projects:list': () => s.projects.list(),
    'projects:create': async (req) => s.projects.getMeta(await s.projects.create(req)),
    'projects:open': async ({ projectId }) => {
      const ctx = await s.projects.open(projectId)
      return { meta: await s.projects.getMeta(ctx), problems: ctx.problems }
    },
    'projects:update': async ({ projectId, patch }) => s.projects.updateMeta(await s.projects.open(projectId), patch)
  }
}
