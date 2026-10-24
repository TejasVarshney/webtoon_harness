import { describe, expect, it } from 'vitest'
import { CorruptFileError, EntityNotFoundError, PathEscapeError } from './errors'

describe('domain errors', () => {
  it('EntityNotFoundError words its message "Unknown <kind>: <id>"', () => {
    const e = new EntityNotFoundError('character', 'chr_0000000009')
    expect(e).toBeInstanceOf(Error)
    expect(e.message).toBe('Unknown character: chr_0000000009')
    expect(e.kind).toBe('character')
    expect(e.id).toBe('chr_0000000009')
    expect(e.name).toBe('EntityNotFoundError')
  })

  it('CorruptFileError carries the path', () => {
    const e = new CorruptFileError('/x/project.json', 'bad json')
    expect(e).toBeInstanceOf(Error)
    expect(e.path).toBe('/x/project.json')
    expect(e.message).toContain('/x/project.json')
    expect(e.message).toContain('bad json')
    expect(e.name).toBe('CorruptFileError')
  })

  it('PathEscapeError is an Error naming the offending path', () => {
    const e = new PathEscapeError('../x')
    expect(e).toBeInstanceOf(Error)
    expect(e.attempted).toBe('../x')
    expect(e.message).toContain('../x')
    expect(e.name).toBe('PathEscapeError')
  })
})
