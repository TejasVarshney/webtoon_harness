import { describe, expect, it } from 'vitest'
import { cleanIpcError } from './api'

describe('cleanIpcError', () => {
  it('cleans electron error prefixes', () =>
    expect(cleanIpcError(new Error("Error invoking remote method 'sessions:load': Error: Session not found")).message).toBe('Session not found'))

  it('keeps other messages and wraps non-errors', () => {
    expect(cleanIpcError(new Error('plain')).message).toBe('plain')
    expect(cleanIpcError('boom').message).toBe('boom')
  })
})
