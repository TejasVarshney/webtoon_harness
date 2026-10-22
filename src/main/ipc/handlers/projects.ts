import { z } from 'zod'
import type { IpcChannel, IpcContract } from '@shared/ipc'
import type { Services } from '../../services'
import { parseInput } from '../validate'

/** `event` is the Electron `IpcMainInvokeEvent` for handlers that need the calling window; most ignore it. */
export type HandlerMap = { [C in IpcChannel]?: (req: IpcContract[C]['req'], event?: unknown) => Promise<IpcContract[C]['res']> }

const CreateSchema = z.object({ title: z.string().trim().min(1), logline: z.string().optional(), stylePreset: z.string().optional() })

export function projectsHandlers(s: Services): HandlerMap {
  return {
    'projects:list': () => s.projects.list(),
    'projects:create': async (req) => s.projects.getMeta(await s.projects.create(parseInput(CreateSchema, req))),
    'projects:open': async ({ projectId }) => {
      const ctx = await s.projects.open(projectId)
      return { meta: await s.projects.getMeta(ctx), problems: ctx.problems }
    },
    'projects:update': async ({ projectId, patch }) => s.projects.updateMeta(await s.projects.open(projectId), patch)
  }
}
