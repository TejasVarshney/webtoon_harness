import { describe, expect, it } from 'vitest'
import type { Character, Item, Panel, PanelCharacter, PanelItem } from '@shared/types'
import { makeCharacter, makeItem, makeItemUsage, makePanel, makeVariation } from '../test/factories'
import { baseReferencePrompt, composePanelPrompt, editPanelPrompt, itemReferencePrompt, itemUsagePrompt, sheetFixInstruction, variationPrompt } from './prompts'

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

describe('item prompts', () => {
  it('item base prompt', () =>
    expect(itemReferencePrompt(makeItem({ appearanceLock: 'LOCK' }), 'STYLE')).toBe(
      'Item reference sheet. STYLE. The object alone, three-quarter view, centered, plain light-gray background, even studio lighting, no people, no hands, no text. LOCK'
    ))

  it('state usage prompt', () =>
    expect(
      itemUsagePrompt(makeItem({ appearanceLock: 'LOCK' }), makeItemUsage({ kind: 'state', name: 'Folded', delta: 'barrel folded back' }), 'STYLE')
    ).toBe(
      'Item reference sheet. STYLE. The object alone, three-quarter view, plain light-gray background, no people, no hands, no text. LOCK State: Folded — barrel folded back. Keep shape, size, materials, colors and markings identical to the reference image except for the state.'
    ))

  it('action usage prompt shows hands only', () =>
    expect(
      itemUsagePrompt(makeItem({ appearanceLock: 'LOCK' }), makeItemUsage({ kind: 'action', name: 'Firing', delta: 'cyan beam' }), 'STYLE')
    ).toBe(
      'Item usage reference sheet. STYLE. Plain light-gray background, no text. LOCK Usage: Firing — cyan beam. Show only plain gray hands and forearms, cropped at the elbow, with no face, body, clothing or jewelry, so the sheet shows only the grip, the motion and the effect. Keep shape, size, materials, colors and markings identical to the reference image.'
    ))
})

describe('sheet fix instruction', () => {
  const FIX = sheetFixInstruction(['X'])

  it('joins the issues, and gives nothing for none', () => {
    expect(sheetFixInstruction(['A is wrong', 'B is missing'])).toBe('Important details: A is wrong; B is missing.')
    expect(sheetFixInstruction([])).toBeUndefined()
  })

  it('appends the fix after one space on all four sheet prompts, and nothing without it', () => {
    const c = makeCharacter({ appearanceLock: 'LOCK' })
    const item = makeItem({ appearanceLock: 'LOCK' })
    const v = makeVariation({ name: 'Outfit: School uniform', kind: 'outfit', delta: 'navy blazer' })
    const state = makeItemUsage({ kind: 'state', name: 'Folded', delta: 'barrel folded back' })
    const action = makeItemUsage({ kind: 'action', name: 'Firing', delta: 'cyan beam' })
    expect(baseReferencePrompt(c, 'STYLE', FIX)).toBe(`${baseReferencePrompt(c, 'STYLE')} ${FIX}`)
    expect(variationPrompt(c, v, 'STYLE', FIX)).toBe(`${variationPrompt(c, v, 'STYLE')} ${FIX}`)
    expect(itemReferencePrompt(item, 'STYLE', FIX)).toBe(`${itemReferencePrompt(item, 'STYLE')} ${FIX}`)
    expect(itemUsagePrompt(item, state, 'STYLE', FIX)).toBe(`${itemUsagePrompt(item, state, 'STYLE')} ${FIX}`)
    expect(itemUsagePrompt(item, action, 'STYLE', FIX)).toBe(`${itemUsagePrompt(item, action, 'STYLE')} ${FIX}`)
    expect(baseReferencePrompt(c, 'STYLE', undefined)).toBe(baseReferencePrompt(c, 'STYLE'))
  })
})

// ---------------------------------------------------------------------------------------------
// Panel prompts
// ---------------------------------------------------------------------------------------------

function readyVariation(characterId: string, id: string, imagePath: string, name = 'Base', delta = '') {
  return makeVariation({ id, characterId, name, kind: name === 'Base' ? 'base' : 'outfit', delta, imagePath, status: 'ready' })
}

const mina = makeCharacter({
  id: 'chr_mina',
  name: 'Mina',
  appearanceLock: 'MINA_LOCK',
  variations: [
    readyVariation('chr_mina', 'var_m0', 'characters/chr_mina/base.png'),
    readyVariation('chr_mina', 'var_m1', 'characters/chr_mina/var_m1.png', 'Outfit: School uniform', 'navy blazer')
  ]
})
const jin = makeCharacter({
  id: 'chr_jin',
  name: 'Jin',
  appearanceLock: 'JIN_LOCK',
  variations: [readyVariation('chr_jin', 'var_j0', 'characters/chr_jin/base.png')]
})
const roster = new Map<string, Character>([
  [mina.id, mina],
  [jin.id, jin]
])

function cast(character: Character, variationId: string, action = '', expression = '', position: PanelCharacter['position'] = 'center'): PanelCharacter {
  return { characterId: character.id, variationId, action, expression, position }
}

function panel(o: Partial<Panel> = {}): Panel {
  return makePanel({ description: 'Mina meets Jin.', setting: 'Rooftop at dusk', shot: 'medium', aspect: '2:3', ...o })
}

const firing = makeItemUsage({ id: 'use_blaster_fire', itemId: 'itm_blaster', name: 'Firing', kind: 'action', delta: 'cyan beam', status: 'ready', imagePath: 'items/itm_blaster/fire.png' })
const resting = makeItemUsage({ id: 'use_blaster_base', itemId: 'itm_blaster', name: 'At rest', kind: 'base', delta: '', status: 'ready', imagePath: 'items/itm_blaster/base.png' })
const blaster = makeItem({ id: 'itm_blaster', name: 'Kestrel blaster', appearanceLock: 'BLOCK', usages: [resting, firing] })
const itemRoster = new Map<string, Item>([[blaster.id, blaster]])

function held(o: Partial<PanelItem> = {}): PanelItem {
  return { itemId: blaster.id, usageId: firing.id, heldBy: mina.id, action: 'aimed at the door', ...o }
}

const PREVIOUS = { panelId: 'pnl_prev', imagePath: 'panels/pnl_prev/ver_1.png' }

describe('composePanelPrompt', () => {
  it('composes the panel prompt with references in order', () => {
    const { prompt, references } = composePanelPrompt({
      stylePreset: 'STYLE',
      panel: panel({ characters: [cast(mina, 'var_m1', 'waves', 'smiling')] }),
      roster,
      itemRoster,
      previous: PREVIOUS,
      maxReferences: 4
    })
    expect(prompt.split('\n')[0]).toBe(
      '[STYLE] STYLE. Vertical-scroll webtoon panel, 2:3 aspect ratio, medium shot. No text, no speech bubbles, no captions, no watermark.'
    )
    expect(prompt).toContain('- Mina (reference image 1): MINA_LOCK Look: Outfit: School uniform — navy blazer. Action: waves. Expression: smiling. Position: center.')
    expect(prompt).toContain('[CONTINUITY] Continues directly from the previous panel (reference image 2).')
    expect(references).toEqual([
      { relPath: mina.variations[1].imagePath, label: 'Mina', subject: { kind: 'character', id: 'chr_mina' } },
      { relPath: 'panels/pnl_prev/ver_1.png', label: 'previous panel', subject: { kind: 'previous' } }
    ])
  })

  it('matches the spec template line for line', () => {
    const { prompt } = composePanelPrompt({
      stylePreset: 'STYLE',
      panel: panel({
        description: 'Mina greets Jin.',
        continuityNotes: 'Same rain as before.',
        characters: [cast(mina, 'var_m1', 'waves', 'smiling', 'left'), cast(jin, 'var_j0', 'nods', 'calm', 'right')]
      }),
      roster,
      itemRoster,
      previous: PREVIOUS,
      maxReferences: 4
    })
    expect(prompt.split('\n')).toEqual([
      '[STYLE] STYLE. Vertical-scroll webtoon panel, 2:3 aspect ratio, medium shot. No text, no speech bubbles, no captions, no watermark.',
      '[SETTING] Rooftop at dusk',
      '[ACTION] Mina greets Jin.',
      '[CHARACTERS]',
      '- Mina (reference image 1): MINA_LOCK Look: Outfit: School uniform — navy blazer. Action: waves. Expression: smiling. Position: left.',
      '- Jin (reference image 2): JIN_LOCK Look: Base. Action: nods. Expression: calm. Position: right.',
      '[CONTINUITY] Continues directly from the previous panel (reference image 3). Keep setting layout, lighting, time of day and outfits consistent. Same rain as before.'
    ])
  })

  it('renders the shot type verbatim', () => {
    const line = (shot: Panel['shot']) =>
      composePanelPrompt({ stylePreset: 'S', panel: panel({ shot }), roster, itemRoster, previous: null, maxReferences: 4 }).prompt.split('\n')[0]
    expect(line('close-up')).toContain('aspect ratio, close-up shot. No text')
    expect(line('extreme-close-up')).toContain('aspect ratio, extreme-close-up shot. No text')
    expect(line('over-the-shoulder')).toContain('aspect ratio, over-the-shoulder shot. No text')
    expect(line('birds-eye')).toContain('aspect ratio, birds-eye shot. No text')
    expect(line('establishing')).toContain('aspect ratio, establishing shot. No text')
  })

  it('uses the panel aspect in the first line', () => {
    const { prompt } = composePanelPrompt({ stylePreset: 'S', panel: panel({ aspect: '16:9' }), roster, itemRoster, previous: null, maxReferences: 4 })
    expect(prompt.split('\n')[0]).toContain('16:9 aspect ratio')
  })

  it('has no continuity line when there is no previous panel', () => {
    const { prompt, references } = composePanelPrompt({
      stylePreset: 'STYLE',
      panel: panel({ characters: [cast(mina, 'var_m0')], continuityNotes: 'ignored without a previous panel' }),
      roster,
      itemRoster,
      previous: null,
      maxReferences: 4
    })
    expect(prompt).not.toContain('[CONTINUITY]')
    expect(references).toEqual([{ relPath: 'characters/chr_mina/base.png', label: 'Mina', subject: { kind: 'character', id: 'chr_mina' } }])
  })

  it('drops previous panel first, then trailing cast, when over the cap', () => {
    const input = { stylePreset: 'STYLE', panel: panel({ characters: [cast(mina, 'var_m0'), cast(jin, 'var_j0')] }), roster, itemRoster, previous: PREVIOUS }

    const one = composePanelPrompt({ ...input, maxReferences: 1 })
    expect(one.references).toEqual([{ relPath: 'characters/chr_mina/base.png', label: 'Mina', subject: { kind: 'character', id: 'chr_mina' } }])
    expect(one.prompt).toContain('- Mina (reference image 1): MINA_LOCK')
    expect(one.prompt).toContain('- Jin (no reference image): JIN_LOCK')
    expect(one.prompt).toContain('[CONTINUITY] Continues directly from the previous panel (no reference image). Keep setting layout')

    const two = composePanelPrompt({ ...input, maxReferences: 2 })
    expect(two.references.map((r) => r.label)).toEqual(['Mina', 'Jin'])
    expect(two.prompt).toContain('previous panel (no reference image)')

    const three = composePanelPrompt({ ...input, maxReferences: 3 })
    expect(three.references.map((r) => r.label)).toEqual(['Mina', 'Jin', 'previous panel'])
    expect(three.prompt).toContain('previous panel (reference image 3)')

    const none = composePanelPrompt({ ...input, maxReferences: 0 })
    expect(none.references).toEqual([])
    expect(none.prompt).toContain('- Mina (no reference image)')
    expect(none.prompt).toContain('- Jin (no reference image)')
  })

  it('gives a cast member without a ready image the no-reference form even under the cap, and renumbers', () => {
    const jinPending = makeCharacter({
      id: 'chr_jin',
      name: 'Jin',
      appearanceLock: 'JIN_LOCK',
      variations: [makeVariation({ id: 'var_j0', characterId: 'chr_jin', status: 'pending' })]
    })
    const { prompt, references } = composePanelPrompt({
      stylePreset: 'STYLE',
      panel: panel({ characters: [cast(jinPending, 'var_j0'), cast(mina, 'var_m0')] }),
      roster: new Map([...roster, [jinPending.id, jinPending]]),
      itemRoster,
      previous: PREVIOUS,
      maxReferences: 4
    })
    expect(prompt).toContain('- Jin (no reference image): JIN_LOCK')
    expect(prompt).toContain('- Mina (reference image 1): MINA_LOCK')
    expect(prompt).toContain('previous panel (reference image 2)')
    expect(references.map((r) => r.label)).toEqual(['Mina', 'previous panel'])
  })

  it('leaves out the empty parts of a cast line instead of printing blanks', () => {
    const { prompt } = composePanelPrompt({ stylePreset: 'S', panel: panel({ characters: [cast(mina, 'var_m0')] }), roster, itemRoster, previous: null, maxReferences: 4 })
    expect(prompt).toContain('- Mina (reference image 1): MINA_LOCK Look: Base. Position: center.')
  })

  it('does not leave a trailing space on the continuity line when there are no notes', () => {
    const { prompt } = composePanelPrompt({ stylePreset: 'S', panel: panel(), roster, itemRoster, previous: PREVIOUS, maxReferences: 4 })
    expect(prompt.split('\n').at(-1)).toBe(
      '[CONTINUITY] Continues directly from the previous panel (reference image 1). Keep setting layout, lighting, time of day and outfits consistent.'
    )
  })

  it('never puts dialogue in the prompt', () => {
    const { prompt } = composePanelPrompt({
      stylePreset: 'STYLE',
      panel: panel({
        characters: [cast(mina, 'var_m0')],
        dialogue: [{ id: 'dlg_1', speakerId: 'chr_mina', kind: 'speech', text: 'SECRET LINE' }]
      }),
      roster,
      itemRoster,
      previous: PREVIOUS,
      maxReferences: 4
    })
    expect(prompt).not.toContain('SECRET LINE')
  })

  it('keeps archived characters renderable', () => {
    const old = makeCharacter({
      id: 'chr_old',
      name: 'Old Man',
      archived: true,
      appearanceLock: 'OLD_LOCK',
      variations: [readyVariation('chr_old', 'var_o0', 'characters/chr_old/base.png')]
    })
    const { prompt, references } = composePanelPrompt({
      stylePreset: 'S',
      panel: panel({ characters: [cast(old, 'var_o0')] }),
      roster: new Map([[old.id, old]]),
      itemRoster,
      previous: null,
      maxReferences: 4
    })
    expect(prompt).toContain('- Old Man (reference image 1): OLD_LOCK')
    expect(references).toEqual([{ relPath: 'characters/chr_old/base.png', label: 'Old Man', subject: { kind: 'character', id: 'chr_old' } }])
  })

  it('throws a clear error for a character or variation that is gone', () => {
    const compose = (characters: PanelCharacter[]) =>
      composePanelPrompt({ stylePreset: 'S', panel: panel({ characters }), roster, itemRoster, previous: null, maxReferences: 4 })
    expect(() => compose([{ characterId: 'chr_missing', variationId: 'var_x', action: '', expression: '', position: 'center' }])).toThrow('Unknown character: chr_missing')
    expect(() => compose([cast(mina, 'var_j0')])).toThrow('Variation var_j0 does not belong to Mina')
  })
})

describe('composePanelPrompt with items', () => {
  const base = { stylePreset: 'STYLE', roster, itemRoster, previous: PREVIOUS, maxReferences: 4 }

  it('adds an [ITEMS] block after the cast and an item reference before the previous panel', () => {
    const { prompt, references } = composePanelPrompt({ ...base, panel: panel({ characters: [cast(mina, 'var_m0')], items: [held()] }) })
    expect(references.map((r) => r.subject)).toEqual([{ kind: 'character', id: mina.id }, { kind: 'item', id: blaster.id }, { kind: 'previous' }])
    expect(references[1]).toEqual({ relPath: 'items/itm_blaster/fire.png', label: 'Kestrel blaster', subject: { kind: 'item', id: blaster.id } })
    expect(prompt).toContain(
      "[ITEMS] Draw each item exactly as its reference image shows it, and use it exactly as its reference shows. Gray hands in an item reference only show the grip: draw the holder's own hands, never gray hands."
    )
    expect(prompt).toContain('- Kestrel blaster (reference image 2): BLOCK Use: Firing — cyan beam. Held by: Mina. Action: aimed at the door.')
    const lines = prompt.split('\n')
    expect(lines.findIndex((l) => l.startsWith('[ITEMS]'))).toBe(lines.findIndex((l) => l.startsWith('- Mina')) + 1)
    expect(lines.at(-1)).toContain('[CONTINUITY] Continues directly from the previous panel (reference image 3).')
  })

  it('writes nobody and omits Action and the delta dash when they are empty', () => {
    const { prompt } = composePanelPrompt({
      ...base,
      previous: null,
      panel: panel({ items: [held({ usageId: resting.id, heldBy: null, action: '  ' })] })
    })
    expect(prompt.split('\n').at(-1)).toBe('- Kestrel blaster (reference image 1): BLOCK Use: At rest. Held by: nobody.')
  })

  it('uses the raw id for a holder that is not in the roster', () => {
    const { prompt } = composePanelPrompt({ ...base, previous: null, panel: panel({ items: [held({ heldBy: 'chr_gone' })] }) })
    expect(prompt).toContain('Held by: chr_gone. Action: aimed at the door.')
  })

  it('drops the previous panel before an item, and an item before the cast', () => {
    const input = { ...base, panel: panel({ characters: [cast(mina, 'var_m0'), cast(jin, 'var_j0'), cast(mina, 'var_m1')], items: [held()] }) }
    const four = composePanelPrompt(input)
    expect(four.references.map((r) => r.subject.kind)).toEqual(['character', 'character', 'character', 'item'])
    expect(four.prompt).toContain('- Kestrel blaster (reference image 4): BLOCK')
    expect(four.prompt).toContain('previous panel (no reference image)')

    const three = composePanelPrompt({ ...input, maxReferences: 3 })
    expect(three.references.map((r) => r.subject.kind)).toEqual(['character', 'character', 'character'])
    expect(three.prompt).toContain('- Kestrel blaster (no reference image): BLOCK Use: Firing — cyan beam.')
  })

  it('gives an item whose usage has no ready image the no-reference form and keeps its lock', () => {
    const pendingUse = makeItemUsage({ id: 'use_blaster_wip', itemId: 'itm_blaster', name: 'Overheated', kind: 'state', delta: 'glowing', status: 'pending' })
    const item = makeItem({ id: 'itm_blaster', name: 'Kestrel blaster', appearanceLock: 'BLOCK', usages: [resting, pendingUse] })
    const { prompt, references } = composePanelPrompt({
      ...base,
      itemRoster: new Map([[item.id, item]]),
      panel: panel({ items: [held({ usageId: pendingUse.id })] })
    })
    expect(prompt).toContain('- Kestrel blaster (no reference image): BLOCK Use: Overheated — glowing.')
    expect(references.map((r) => r.subject.kind)).toEqual(['previous'])
  })

  it('leaves a panel without items exactly as before', () => {
    const { prompt } = composePanelPrompt({ ...base, panel: panel({ characters: [cast(mina, 'var_m0')] }) })
    expect(prompt).not.toContain('[ITEMS]')
    expect(prompt.split('\n')).toEqual([
      '[STYLE] STYLE. Vertical-scroll webtoon panel, 2:3 aspect ratio, medium shot. No text, no speech bubbles, no captions, no watermark.',
      '[SETTING] Rooftop at dusk',
      '[ACTION] Mina meets Jin.',
      '[CHARACTERS]',
      '- Mina (reference image 1): MINA_LOCK Look: Base. Position: center.',
      '[CONTINUITY] Continues directly from the previous panel (reference image 2). Keep setting layout, lighting, time of day and outfits consistent.'
    ])
  })

  it('throws a clear error for an item or usage that is gone', () => {
    const compose = (entry: PanelItem) => composePanelPrompt({ ...base, panel: panel({ items: [entry] }) })
    expect(() => compose(held({ itemId: 'itm_missing' }))).toThrow('Unknown item: itm_missing')
    expect(() => compose(held({ usageId: 'use_other' }))).toThrow('Usage use_other does not belong to Kestrel blaster')
  })
})

describe('editPanelPrompt', () => {
  it('pins the edit prompt', () =>
    expect(
      editPanelPrompt('make the sky red', [
        { name: 'Mina', appearanceLock: 'MINA_LOCK' },
        { name: 'Jin', appearanceLock: 'JIN_LOCK' }
      ])
    ).toBe(
      'Edit the first image: make the sky red. Keep everything else unchanged — composition, framing, lighting, art style — and keep these characters on-model: Mina: MINA_LOCK Jin: JIN_LOCK No text, no speech bubbles.'
    ))

  it('keeps items on-model in an edit', () =>
    expect(editPanelPrompt('x', [], [{ name: 'Kestrel blaster', appearanceLock: 'BLOCK' }])).toContain('keep these items on-model: Kestrel blaster: BLOCK No text'))

  it('puts the items after the characters and before No text', () =>
    expect(
      editPanelPrompt('make the sky red', [{ name: 'Mina', appearanceLock: 'MINA_LOCK' }], [
        { name: 'Kestrel blaster', appearanceLock: 'BLOCK' },
        { name: 'Comm ring', appearanceLock: 'RING' }
      ])
    ).toBe(
      'Edit the first image: make the sky red. Keep everything else unchanged — composition, framing, lighting, art style — and keep these characters on-model: Mina: MINA_LOCK and keep these items on-model: Kestrel blaster: BLOCK Comm ring: RING No text, no speech bubbles.'
    ))
})
