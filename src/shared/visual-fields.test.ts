import { describe, expect, it } from 'vitest'
import { PanelAspectSchema, PanelSchema } from '@shared/schemas'
import type { Panel, PanelAspect, PanelVersion } from '@shared/types'
import { VISUAL_FIELDS, staleVisualFields, visualFields } from '@shared/visual-fields'

const T = '2026-01-01T00:00:00.000Z'

const CAST = { characterId: 'chr_0000000001', variationId: 'var_0000000001', action: '', expression: '', position: 'center' as const }
const ITEM = { itemId: 'itm_0000000001', usageId: 'use_0000000001', heldBy: null, action: '' }

const version: PanelVersion = {
  id: 'ver_0000000001',
  source: 'generate',
  status: 'ready',
  error: null,
  imagePath: 'panels/pnl_0000000001/ver_0000000001.png',
  prompt: '',
  referenceImagePaths: [],
  instruction: null,
  parentVersionId: null,
  drawnFrom: null,
  check: null,
  createdAt: T
}

/** A panel with one ready, current version that does not know what it was drawn from. */
function makePanel(over: Partial<Panel> = {}): Panel {
  return PanelSchema.parse({
    id: 'pnl_0000000001',
    episodeId: 'epi_0000000001',
    description: 'Mina opens the door.',
    setting: 'Apartment hallway',
    shot: 'medium',
    aspect: '2:3',
    dialogue: [],
    versions: [version],
    currentVersionId: version.id,
    createdBy: 'user',
    createdAt: T,
    updatedAt: T,
    ...over
  })
}

/** A panel whose current version was drawn from the panel as it is now. */
function drawn(over: Partial<Panel> = {}): Panel {
  const base = makePanel(over)
  return { ...base, versions: [{ ...version, drawnFrom: visualFields(base) }] }
}

describe('visualFields', () => {
  it('lists the six fields the picture shows, in order', () => {
    expect(VISUAL_FIELDS).toEqual(['description', 'setting', 'shot', 'aspect', 'characters', 'items'])
  })

  it('copies exactly those fields from a panel', () => {
    const p = makePanel({ characters: [CAST], items: [ITEM] })
    expect(visualFields(p)).toEqual({ description: p.description, setting: p.setting, shot: p.shot, aspect: p.aspect, characters: [CAST], items: [ITEM] })
  })
})

describe('staleVisualFields', () => {
  it('is empty when there is no current version', () => {
    expect(staleVisualFields(makePanel({ versions: [], currentVersionId: null }))).toEqual([])
  })

  it('is empty when the current version does not know what it was drawn from', () => {
    const p = makePanel({ description: 'something else entirely' })
    expect(p.versions[0].drawnFrom).toBeNull()
    expect(staleVisualFields(p)).toEqual([])
  })

  it('is empty when nothing changed', () => {
    expect(staleVisualFields(drawn({ characters: [CAST], items: [ITEM] }))).toEqual([])
  })

  it('names the changed fields in VISUAL_FIELDS order', () => {
    const p = drawn()
    expect(staleVisualFields({ ...p, items: [ITEM], characters: [CAST] })).toEqual(['characters', 'items'])
    expect(staleVisualFields({ ...p, description: 'new', setting: 'new', shot: 'wide' })).toEqual(['description', 'setting', 'shot'])
  })

  it('compares the cast by value, not by identity', () => {
    const p = drawn({ characters: [CAST] })
    expect(staleVisualFields({ ...p, characters: [{ ...CAST }] })).toEqual([])
    expect(staleVisualFields({ ...p, characters: [{ ...CAST, expression: 'smiling' }] })).toEqual(['characters'])
  })

  it('compares aspect through the aspect that is drawn', () => {
    expect(staleVisualFields({ ...drawn({ aspect: '1:2' }), aspect: '1:3' })).toEqual([])
    expect(staleVisualFields({ ...drawn({ aspect: '2:3' }), aspect: '1:1' })).toEqual(['aspect'])
  })

  it('tells every pair of aspects the same way drawAspect does', () => {
    // 1:2 and 1:3 are drawn at 9:16, so the three are one picture.
    const drawnAs916: PanelAspect[] = ['9:16', '1:2', '1:3']
    for (const from of PanelAspectSchema.options) {
      for (const to of PanelAspectSchema.options) {
        const sameDraw = from === to || (drawnAs916.includes(from) && drawnAs916.includes(to))
        expect(staleVisualFields({ ...drawn({ aspect: from }), aspect: to }), `${from} to ${to}`).toEqual(sameDraw ? [] : ['aspect'])
      }
    }
  })

  it('ignores layout and dialogue', () => {
    const p = drawn()
    expect(staleVisualFields({ ...p, frame: 'borderless' })).toEqual([])
    expect(staleVisualFields({ ...p, gutter: 'black' })).toEqual([])
    expect(staleVisualFields({ ...p, beside: true, gapAfter: 'long' })).toEqual([])
    expect(staleVisualFields({ ...p, dialogue: [{ id: 'dlg_0000000001', speakerId: null, kind: 'narration', text: 'Night.', placement: { x: 0.5, y: 0.5 }, style: null, tail: null }] })).toEqual([])
  })
})
