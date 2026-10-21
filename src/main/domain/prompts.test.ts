import { describe, expect, it } from 'vitest'
import { makeCharacter, makeVariation } from '../test/factories'
import { baseReferencePrompt, variationPrompt } from './prompts'

describe('character prompts', () => {
  it('pins the base reference prompt', () =>
    expect(baseReferencePrompt(makeCharacter({ appearanceLock: 'LOCK' }), 'STYLE')).toBe(
      'Character reference sheet. STYLE. Full body, front view, neutral expression, standing straight, plain light-gray background, even studio lighting, no text. LOCK'
    ))

  it('pins the variation prompt', () =>
    expect(
      variationPrompt(makeCharacter({ appearanceLock: 'LOCK' }), makeVariation({ name: 'Outfit: School uniform', kind: 'outfit', delta: 'navy blazer' }), 'STYLE')
    ).toBe(
      'Character reference sheet. STYLE. Full body, front view, plain light-gray background, no text. LOCK Variation: Outfit: School uniform — navy blazer. Keep face, hair, body and colors identical to the reference image except for the variation.'
    ))
})
