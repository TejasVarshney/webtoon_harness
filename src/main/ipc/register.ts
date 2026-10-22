import type { Services } from '../services'
import { agentHandlers } from './handlers/agent'
import { charactersHandlers } from './handlers/characters'
import { docsHandlers, type OpenPath } from './handlers/docs'
import { modelsHandlers } from './handlers/models'
import { panelChatHandlers } from './handlers/panel-chat'
import { panelsHandlers } from './handlers/panels'
import { projectsHandlers } from './handlers/projects'
import { sessionsHandlers } from './handlers/sessions'
import { storyHandlers } from './handlers/story'
import { uploadsHandlers, type PickFiles } from './handlers/uploads'

/** Electron-backed pieces, injected so the handlers stay testable without Electron. */
export interface IpcDeps {
  /** Shows the image picker over the window that sent the event; resolves to the chosen absolute paths ([] on cancel). */
  pickImageFiles?: PickFiles
  /** Opens a file in the system's default app (`shell.openPath`); resolves to an error message, '' on success. */
  openPath?: OpenPath
}

export interface IpcRegistrar {
  handle(channel: string, fn: (e: unknown, req: unknown) => unknown): void
}

/** Registers every handler map on `ipc`. The register test fails when a contract channel has no handler. */
export function registerIpc(ipc: IpcRegistrar, services: Services, deps: IpcDeps = {}): void {
  const handlers: Record<string, ((req: never, event?: unknown) => Promise<unknown>) | undefined> = {
    ...projectsHandlers(services),
    ...sessionsHandlers(services),
    ...modelsHandlers(services),
    ...agentHandlers(services),
    ...panelChatHandlers(services),
    ...charactersHandlers(services, { pickFiles: deps.pickImageFiles }),
    ...panelsHandlers(services, { pickFiles: deps.pickImageFiles }),
    ...storyHandlers(services),
    ...docsHandlers(services, { openPath: deps.openPath }),
    ...uploadsHandlers(services, { pickFiles: deps.pickImageFiles })
  }
  for (const [channel, fn] of Object.entries(handlers)) {
    if (fn) ipc.handle(channel, (e, req) => fn(req as never, e))
  }
}
