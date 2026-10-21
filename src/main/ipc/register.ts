import type { Services } from '../services'
import { modelsHandlers } from './handlers/models'
import { projectsHandlers } from './handlers/projects'
import { sessionsHandlers } from './handlers/sessions'

export interface IpcRegistrar {
  handle(channel: string, fn: (e: unknown, req: unknown) => unknown): void
}

/** Registers every handler map on `ipc`. The register test fails when a contract channel has no handler. */
export function registerIpc(ipc: IpcRegistrar, services: Services): void {
  const handlers: Record<string, ((req: never) => Promise<unknown>) | undefined> = {
    ...projectsHandlers(services),
    ...sessionsHandlers(services),
    ...modelsHandlers(services)
  }
  for (const [channel, fn] of Object.entries(handlers)) {
    if (fn) ipc.handle(channel, (_e, req) => fn(req as never))
  }
}
