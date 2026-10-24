import { describe, expect, it } from 'vitest'
import { CharacterSchema, EpisodeSchema, PanelSchema, ProjectMetaSchema, VariationSchema } from '@shared/schemas'
import { makeCharacter, makeEpisode, makeMeta, makePanel, makeVariation } from './factories'

describe('test factories', () => {
  it('return schema-valid objects with deterministic ids', () => {
    expect(CharacterSchema.parse(makeCharacter())).toEqual(makeCharacter())
    expect(VariationSchema.parse(makeVariation())).toEqual(makeVariation())
    expect(PanelSchema.parse(makePanel())).toEqual(makePanel())
    expect(EpisodeSchema.parse(makeEpisode())).toEqual(makeEpisode())
    expect(ProjectMetaSchema.parse(makeMeta())).toEqual(makeMeta())
    expect(makeCharacter().id).toBe('chr_0000000001')
    expect(makePanel().id).toBe('pnl_0000000001')
  })

  it('apply overrides', () => {
    expect(makeMeta({ title: 'Moon Diary' }).title).toBe('Moon Diary')
    expect(makePanel({ shot: 'wide' }).shot).toBe('wide')
    expect(makeCharacter({ appearanceLock: 'LOCK' }).appearanceLock).toBe('LOCK')
  })

  it('accept overrides in schema-input shape and fill the defaults', () => {
    const c = makeCharacter({ appearance: { hair: 'red' } })
    expect(c.appearance.hair).toBe('red')
    expect(c.appearance.eyes).toBe('')
    const p = makePanel({ characters: [{ characterId: 'chr_0000000002', variationId: 'var_0000000002' }] })
    expect(p.characters[0]).toMatchObject({ action: '', expression: '', position: 'center' })
  })

  it('give every character exactly one base variation that points back at it', () => {
    const c = makeCharacter({ id: 'chr_0000000007' })
    expect(c.variations).toHaveLength(1)
    expect(c.variations[0]).toMatchObject({ kind: 'base', characterId: 'chr_0000000007' })
  })

  it('reject overrides that break the schema', () => {
    // @ts-expect-error deliberately invalid shot
    expect(() => makePanel({ shot: 'dutch' })).toThrow()
  })
})
