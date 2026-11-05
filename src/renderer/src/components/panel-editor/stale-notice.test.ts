import { describe, expect, it } from 'vitest'
import { staleNotice } from './stale-notice'

describe('staleNotice', () => {
  it('names one field by its label', () => {
    expect(staleNotice(['characters'])).toBe('Cast changed since this image was drawn.')
  })

  it('joins several with commas and a final "and", upper-casing only the first', () => {
    expect(staleNotice(['description', 'characters', 'items'])).toBe('Description, cast and items changed since this image was drawn.')
    expect(staleNotice(['shot', 'aspect'])).toBe('Shot and aspect changed since this image was drawn.')
  })

  it('says nothing when nothing changed', () => {
    expect(staleNotice([])).toBeNull()
  })
})
