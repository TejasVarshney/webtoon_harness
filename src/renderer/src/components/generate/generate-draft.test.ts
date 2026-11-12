import { describe, expect, it } from 'vitest'
import { character, variation, withVariation } from '../../test/character-fixtures'
import { item, usage, withUsage } from '../../test/item-fixtures'
import { location, locationState } from '../../test/location-fixtures'
import { canDraw, defaultLocation, defaultUsageId, defaultVariationId, emptyDraft, isDraftDirty, toPanelDraft } from './generate-draft'

describe('generate-draft', () => {
  it('starts on a medium shot in the project aspect, with nothing chosen', () => {
    expect(emptyDraft('9:16')).toEqual({
      description: '',
      setting: '',
      shot: 'medium',
      aspect: '9:16',
      location: null,
      characters: [],
      items: [],
      styleOverride: null,
      promptOverride: null,
      sketchPng: null
    })
  })

  it('casts a character in the first variation with a ready image, else the first', () => {
    const pending = variation({ id: 'var_0000000001', status: 'pending', imagePath: null })
    const c = withVariation(character({ variations: [pending] }), 'Blazer')
    expect(defaultVariationId(c)).toBe('var_0000000002')
    expect(defaultVariationId(character({ variations: [pending] }))).toBe('var_0000000001')
  })

  it('uses the first ready usage of an item, else the first', () => {
    const idle = usage({ status: 'failed', imagePath: null })
    expect(defaultUsageId(withUsage(item({ usages: [idle] }), 'Aimed'))).toBe('use_0000000002')
    expect(defaultUsageId(item({ usages: [idle] }))).toBe('use_0000000001')
  })

  it('uses the base state of a location from its main camera', () => {
    const extra = locationState({ id: 'lst_0000000002', kind: 'state' })
    expect(defaultLocation(location({ states: [extra, locationState()] }))).toEqual({ locationId: 'loc_0000000001', stateId: 'lst_0000000001', camera: 'main' })
  })

  it('needs a description or a custom prompt to draw', () => {
    const d = emptyDraft('2:3')
    expect(canDraw(d)).toBe(false)
    expect(canDraw({ ...d, description: '  ' })).toBe(false)
    expect(canDraw({ ...d, description: 'Mina waves' })).toBe(true)
    expect(canDraw({ ...d, promptOverride: 'draw a cat' })).toBe(true)
  })

  it('is dirty once anything is entered or chosen', () => {
    const d = emptyDraft('2:3')
    expect(isDraftDirty(d)).toBe(false)
    expect(isDraftDirty({ ...d, setting: 'roof' })).toBe(true)
    expect(isDraftDirty({ ...d, sketchPng: 'data:image/png;base64,AA' })).toBe(true)
    expect(isDraftDirty({ ...d, location: { locationId: 'loc_0000000001', stateId: 'lst_0000000001', camera: 'main' } })).toBe(true)
  })

  it('goes after the last chosen panel and carries the chosen panels', () => {
    const request = { episodeId: 'epi_0000000001', referencePanelIds: ['pnl_00000000aa', 'pnl_00000000bb'] }
    expect(toPanelDraft(request, emptyDraft('2:3'))).toMatchObject({
      episodeId: 'epi_0000000001',
      afterPanelId: 'pnl_00000000bb',
      referencePanelIds: ['pnl_00000000aa', 'pnl_00000000bb'],
      dialogue: [],
      shot: 'medium',
      aspect: '2:3'
    })
    expect(toPanelDraft({ episodeId: 'epi_0000000001', referencePanelIds: [] }, emptyDraft('2:3')).afterPanelId).toBeUndefined()
  })
})
