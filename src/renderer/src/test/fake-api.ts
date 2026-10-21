import type { IpcChannel } from '@shared/ipc'
import type { AppEvent } from '@shared/types'

type Handler = (req: never) => unknown

/**
 * Installs a fake `window.api`. A channel with no handler rejects, so a test notices an unexpected call.
 * `calls` records every invoke; `emit` pushes an event to whoever subscribed through `onEvent`.
 */
export function installFakeApi(handlers: Partial<Record<IpcChannel, Handler>>): {
  calls: { channel: string; req: unknown }[]
  emit(e: AppEvent): void
} {
  const calls: { channel: string; req: unknown }[] = []
  const listeners = new Set<(e: AppEvent) => void>()
  window.api = {
    invoke: (async (channel: IpcChannel, req: unknown) => {
      calls.push({ channel, req })
      const handler = handlers[channel]
      if (!handler) throw new Error(`fake api: no handler for ${channel}`)
      return handler(req as never)
    }) as typeof window.api.invoke,
    onEvent: (fn) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    }
  }
  return { calls, emit: (e) => [...listeners].forEach((fn) => fn(e)) }
}
