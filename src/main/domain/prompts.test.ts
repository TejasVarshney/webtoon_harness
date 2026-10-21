import { describe, expect, it } from 'vitest'
import type { Character, Panel, PanelCharacter } from '@shared/types'
import { makeCharacter, makePanel, makeVariation } from '../test/factories'
import { baseReferencePrompt, composePanelPrompt, editPanelPrompt, variationPrompt } from './prompts'

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

const PREVIOUS = { panelId: 'pnl_prev', imagePath: 'panels/pnl_prev/ver_1.png' }

describe('composePanelPrompt', () => {
  it('composes the panel prompt with references in order', () => {
    const { prompt, references } = composePanelPrompt({
      stylePreset: 'STYLE',
      panel: panel({ characters: [cast(mina, 'var_m1', 'waves', 'smiling')] }),
      roster,
      previous: PREVIOUS,
      maxReferences: 4
    })
    expect(prompt.split('\n')[0]).toBe(
      '[STYLE] STYLE. Vertical-scroll webtoon panel, 2:3 aspect ratio, medium shot. No text, no speech bubbles, no captions, no watermark.'
    )
    expect(prompt).toContain('- Mina (reference image 1): MINA_LOCK Look: Outfit: School uniform — navy blazer. Action: waves. Expression: smiling. Position: center.')
    expect(prompt).toContain('[CONTINUITY] Continues directly from the previous panel (reference image 2).')
    expect(references).toEqual([
      { relPath: mina.variations[1].imagePath, label: 'Mina' },
      { relPath: 'panels/pnl_prev/ver_1.png', label: 'previous panel' }
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
      composePanelPrompt({ stylePreset: 'S', panel: panel({ shot }), roster, previous: null, maxReferences: 4 }).prompt.split('\n')[0]
    expect(line('close-up')).toContain('aspect ratio, close-up shot. No text')
    expect(line('extreme-close-up')).toContain('aspect ratio, extreme-close-up shot. No text')
    expect(line('over-the-shoulder')).toContain('aspect ratio, over-the-shoulder shot. No text')
    expect(line('birds-eye')).toContain('aspect ratio, birds-eye shot. No text')
    expect(line('establishing')).toContain('aspect ratio, establishing shot. No text')
  })

  it('uses the panel aspect in the first line', () => {
    const { prompt } = composePanelPrompt({ stylePreset: 'S', panel: panel({ aspect: '16:9' }), roster, previous: null, maxReferences: 4 })
    expect(prompt.split('\n')[0]).toContain('16:9 aspect ratio')
  })

  it('has no continuity line when there is no previous panel', () => {
    const { prompt, references } = composePanelPrompt({
      stylePreset: 'STYLE',
      panel: panel({ characters: [cast(mina, 'var_m0')], continuityNotes: 'ignored without a previous panel' }),
      roster,
      previous: null,
      maxReferences: 4
    })
    expect(prompt).not.toContain('[CONTINUITY]')
    expect(references).toEqual([{ relPath: 'characters/chr_mina/base.png', label: 'Mina' }])
  })

  it('drops previous panel first, then trailing cast, when over the cap', () => {
    const input = { stylePreset: 'STYLE', panel: panel({ characters: [cast(mina, 'var_m0'), cast(jin, 'var_j0')] }), roster, previous: PREVIOUS }

    const one = composePanelPrompt({ ...input, maxReferences: 1 })
    expect(one.references).toEqual([{ relPath: 'characters/chr_mina/base.png', label: 'Mina' }])
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
      previous: PREVIOUS,
      maxReferences: 4
    })
    expect(prompt).toContain('- Jin (no reference image): JIN_LOCK')
    expect(prompt).toContain('- Mina (reference image 1): MINA_LOCK')
    expect(prompt).toContain('previous panel (reference image 2)')
    expect(references.map((r) => r.label)).toEqual(['Mina', 'previous panel'])
  })

  it('leaves out the empty parts of a cast line instead of printing blanks', () => {
    const { prompt } = composePanelPrompt({ stylePreset: 'S', panel: panel({ characters: [cast(mina, 'var_m0')] }), roster, previous: null, maxReferences: 4 })
    expect(prompt).toContain('- Mina (reference image 1): MINA_LOCK Look: Base. Position: center.')
  })

  it('does not leave a trailing space on the continuity line when there are no notes', () => {
    const { prompt } = composePanelPrompt({ stylePreset: 'S', panel: panel(), roster, previous: PREVIOUS, maxReferences: 4 })
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
      previous: null,
      maxReferences: 4
    })
    expect(prompt).toContain('- Old Man (reference image 1): OLD_LOCK')
    expect(references).toEqual([{ relPath: 'characters/chr_old/base.png', label: 'Old Man' }])
  })

  it('throws a clear error for a character or variation that is gone', () => {
    const compose = (characters: PanelCharacter[]) =>
      composePanelPrompt({ stylePreset: 'S', panel: panel({ characters }), roster, previous: null, maxReferences: 4 })
    expect(() => compose([{ characterId: 'chr_missing', variationId: 'var_x', action: '', expression: '', position: 'center' }])).toThrow('Unknown character: chr_missing')
    expect(() => compose([cast(mina, 'var_j0')])).toThrow('Variation var_j0 does not belong to Mina')
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
})
