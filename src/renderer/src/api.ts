import type { IpcChannel, IpcContract } from '@shared/ipc'
import type { AppEvent } from '@shared/types'

// Electron prefixes the error's name, whatever it is (`Error: `, `CharacterInUseError: `, ...). Only an
// identifier ending in `Error` is stripped: a message such as "Invalid input: title: ..." has colons of its own.
const ELECTRON_PREFIX = /^Error invoking remote method '[^']*': (?:(?:[A-Za-z_$][\w$]*)?Error: )?/

/** Strips Electron's `Error invoking remote method '<channel>': <Name>Error: ` prefix so the UI shows the real message. */
export function cleanIpcError(e: unknown): Error {
  const message = e instanceof Error ? e.message : String(e)
  return new Error(message.replace(ELECTRON_PREFIX, ''))
}

// `window.api` is read at call time so tests can install a fake after this module loads.
export const api = {
  async invoke<C extends IpcChannel>(channel: C, req: IpcContract[C]['req']): Promise<IpcContract[C]['res']> {
    try {
      return await window.api.invoke(channel, req)
    } catch (e) {
      throw cleanIpcError(e)
    }
  },
  onEvent(fn: (event: AppEvent) => void): () => void {
    return window.api.onEvent(fn)
  }
}
