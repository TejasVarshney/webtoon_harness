import { describe, expect, it } from 'vitest'
import { failureMessage } from './records'

describe('failureMessage', () => {
  it('names a cancelled call', () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    expect(failureMessage(abort)).toBe('Cancelled')
  })

  it('uses the message of an error', () => {
    expect(failureMessage(new Error('boom'))).toBe('boom')
  })

  it('falls back to the string form', () => {
    expect(failureMessage(new Error(''))).toBe('Error')
    expect(failureMessage('plain')).toBe('plain')
  })
})
