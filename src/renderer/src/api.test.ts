import { describe, expect, it } from 'vitest'
import { cleanIpcError } from './api'

describe('cleanIpcError', () => {
  it('cleans electron error prefixes', () =>
    expect(cleanIpcError(new Error("Error invoking remote method 'sessions:load': Error: Session not found")).message).toBe('Session not found'))

  it('strips any error name Electron puts before the message, and only an error name', () => {
    const remote = (rest: string) => new Error(`Error invoking remote method 'characters:delete': ${rest}`)
    expect(cleanIpcError(remote('CharacterInUseError: This character is used by 2 panel(s)')).message).toBe('This character is used by 2 panel(s)')
    expect(cleanIpcError(remote('EntityNotFoundError: Unknown session: ses_1')).message).toBe('Unknown session: ses_1')
    expect(cleanIpcError(remote('Invalid input: title: Too small')).message).toBe('Invalid input: title: Too small')
  })

  it('keeps other messages and wraps non-errors', () => {
    expect(cleanIpcError(new Error('plain')).message).toBe('plain')
    expect(cleanIpcError('boom').message).toBe('boom')
  })
})
