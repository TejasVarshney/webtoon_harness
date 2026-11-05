import { describe, expect, it } from 'vitest'
import { outputNames, safeFileName } from './file-names'

describe('safeFileName', () => {
  it('strips <>:"/\|?* and control characters', () => {
    expect(safeFileName('a<b>c:d"e/f\g|h?i*j\u0001k\u001fl')).toBe('abcdefghijkl')
  })

  it('trims trailing dots and spaces', () => {
    expect(safeFileName('Rooftop. . ')).toBe('Rooftop')
  })

  it('prefixes reserved names (CON, nul, COM1, LPT9)', () => {
    expect(safeFileName('CON')).toBe('_CON')
    expect(safeFileName('nul')).toBe('_nul')
    expect(safeFileName('COM1')).toBe('_COM1')
    expect(safeFileName('LPT9')).toBe('_LPT9')
    expect(safeFileName('Console')).toBe('Console')
  })

  it('caps at 120 characters', () => {
    expect(safeFileName('x'.repeat(300))).toHaveLength(120)
  })

  it('falls back to Untitled when nothing is left', () => {
    expect(safeFileName('  ?*<> . ')).toBe('Untitled')
  })
})

describe('outputNames', () => {
  it('names an episode <Project> - 03 - Title', () => {
    expect(outputNames('My Series', [{ number: 3, title: 'The Rooftop' }], false)).toEqual([
      'My Series - 03 - The Rooftop'
    ])
  })

  it('names a combined volume <Project> - Episodes 1-3', () => {
    const episodes = [
      { number: 3, title: 'C' },
      { number: 1, title: 'A' },
      { number: 2, title: 'B' }
    ]
    expect(outputNames('My Series', episodes, true)).toEqual(['My Series - Episodes 1-3'])
  })

  it('outputNames are unique', () => {
    const names = outputNames(
      'S',
      [
        { number: 1, title: 'What?' },
        { number: 1, title: 'What*' }
      ],
      false
    )
    expect(names).toEqual(['S - 01 - What', 'S - 01 - What (2)'])
  })
})
