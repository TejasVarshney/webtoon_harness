// Everything imported here is bundled into the sandboxed preload, which cannot require() npm packages
// at runtime. Only `electron` and the zod-free `@shared/ipc` may be imported at runtime.
import { contextBridge, ipcRenderer } from 'electron'
import { EVENT_CHANNEL, IPC_CHANNELS, type IpcChannel, type IpcContract } from '@shared/ipc'
import type { AppEvent } from '@shared/types'

const allowed: ReadonlySet<string> = new Set(IPC_CHANNELS)

const api = {
  invoke<C extends IpcChannel>(channel: C, req: IpcContract[C]['req']): Promise<IpcContract[C]['res']> {
    if (!allowed.has(channel)) return Promise.reject(new Error(`Unknown IPC channel: ${String(channel)}`))
    return ipcRenderer.invoke(channel, req) as Promise<IpcContract[C]['res']>
  },
  onEvent(fn: (event: AppEvent) => void): () => void {
    const listener = (_e: unknown, event: AppEvent): void => fn(event)
    ipcRenderer.on(EVENT_CHANNEL, listener)
    return () => {
      ipcRenderer.removeListener(EVENT_CHANNEL, listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
