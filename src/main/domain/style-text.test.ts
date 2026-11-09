import { describe, expect, it } from 'vitest'
import { normalizeStyleName, normalizeStyleText, StyleRejectedError } from './style-text'

const RULE = 'A style describes how the art looks. Take out the words about lettering, speech bubbles, captions, watermarks or signatures: every image prompt already forbids them.'

describe('normalizeStyleText', () => {
  it('collapses whitespace and strips trailing periods', () => expect(normalizeStyleText('  Ink wash,\n  bold lines.. ')).toBe('Ink wash, bold lines'))

  it('rejects text under 3 or over 400 characters', () => {
    expect(() => normalizeStyleText(' a. ')).toThrow('A style description needs 3 to 400 characters.')
    expect(() => normalizeStyleText('x'.repeat(401))).toThrow('A style description needs 3 to 400 characters.')
    expect(normalizeStyleText('x'.repeat(400))).toHaveLength(400)
  })

  it.each(['speech bubbles', 'hand LETTERING', 'with captions', 'a watermark', 'artist signature'])('rejects %s', (bad) =>
    expect(() => normalizeStyleText(`Clean art, ${bad}`)).toThrow(RULE)
  )

  it('rejects with a StyleRejectedError', () => expect(() => normalizeStyleText('')).toThrow(StyleRejectedError))
})

describe('normalizeStyleName', () => {
  it('trims and collapses whitespace', () => expect(normalizeStyleName('  Rainy \n city ')).toBe('Rainy city'))

  it('rejects names outside 1 to 40 characters', () => {
    expect(() => normalizeStyleName('   ')).toThrow('A style name needs 1 to 40 characters.')
    expect(() => normalizeStyleName('x'.repeat(41))).toThrow('A style name needs 1 to 40 characters.')
    expect(normalizeStyleName('x'.repeat(40))).toHaveLength(40)
  })
})
