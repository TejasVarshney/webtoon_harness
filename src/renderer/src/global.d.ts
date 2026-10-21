import type { IpcChannel, IpcContract } from '@shared/ipc'
import type { AppEvent } from '@shared/types'

export interface PreloadApi {
  invoke<C extends IpcChannel>(channel: C, req: IpcContract[C]['req']): Promise<IpcContract[C]['res']>
  onEvent(fn: (event: AppEvent) => void): () => void
}

declare global {
  interface Window {
    api: PreloadApi
  }
}
