import { describe, expect, it } from 'vitest'
import { EVENT_CHANNEL, IPC_CHANNELS } from './ipc'

describe('ipc channels', () => {
  it('has unique channels', () => expect(new Set(IPC_CHANNELS).size).toBe(IPC_CHANNELS.length))
  it('does not collide with the event channel', () => expect(IPC_CHANNELS).not.toContain(EVENT_CHANNEL))
})
