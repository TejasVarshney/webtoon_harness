import { describe, expect, it } from 'vitest'
import type { Character, Item, PanelCharacter, PanelDraft, PanelItem } from '@shared/types'
import { makeCharacter, makeItem, makeItemUsage, makeVariation } from '../test/factories'
import { findUnattachedMentions, hasReadyUsage, validatePanelDraft } from './panel-validation'

function readyVariation(characterId: string, id: string, name = 'Base') {
  return makeVariation({ id, characterId, name, kind: name === 'Base' ? 'base' : 'outfit', imagePath: `characters/${characterId}/${id}.png`, status: 'ready' })
}

const mina = makeCharacter({
  id: 'chr_mina',
  name: 'Mina',
  aliases: ['Min-ah'],
  variations: [readyVariation('chr_mina', 'var_m0'), readyVariation('chr_mina', 'var_m1', 'Outfit: School uniform')]
})
const jin = makeCharacter({ id: 'chr_jin', name: 'Jin', variations: [readyVariation('chr_jin', 'var_j0')] })
const oldMan = makeCharacter({ id: 'chr_old', name: 'Old Man', archived: true, variations: [readyVariation('chr_old', 'var_o0')] })
const roster: Character[] = [mina, jin, oldMan]

function cast(character: Character, variationId: string): PanelCharacter {
  return { characterId: character.id, variationId, action: '', expression: '', position: 'center' }
}

type Draft = Pick<PanelDraft, 'description' | 'characters' | 'dialogue' | 'offPanelMentions' | 'items'>
function d(o: Partial<Draft> = {}): Draft {
  return { description: 'A quiet street.', characters: [], dialogue: [], offPanelMentions: [], ...o }
}
const strict = { strictMentions: true }
const lenient = { strictMentions: false }

describe('validatePanelDraft', () => {
  it('accepts a clean draft', () => {
    expect(validatePanelDraft(d({ description: 'Mina walks.', characters: [cast(mina, 'var_m0')] }), roster, [], strict)).toEqual({ errors: [], warnings: [] })
  })

  it('validates cast and speakers', () => {
    const errorsFor = (o: Partial<Draft>) => validatePanelDraft(d(o), roster, [], lenient).errors

    expect(errorsFor({ characters: [{ ...cast(mina, 'var_m0'), characterId: 'chr_ghost' }] })).toEqual(['Unknown character: chr_ghost'])
    expect(errorsFor({ characters: [cast(mina, 'var_j0')] })).toEqual(['Variation var_j0 does not belong to Mina'])
    expect(errorsFor({ characters: [cast(mina, 'var_nope')] })).toEqual(['Variation var_nope does not belong to Mina'])
    expect(errorsFor({ characters: [cast(mina, 'var_m0'), cast(mina, 'var_m1')] })).toEqual(['Mina is cast twice'])
    expect(errorsFor({ dialogue: [{ speakerId: 'chr_ghost', kind: 'speech', text: 'hi' }] })).toEqual(['Unknown speaker: chr_ghost'])
  })

  it('flags a variation that has no ready reference image', () => {
    const pending = makeCharacter({
      id: 'chr_pen',
      name: 'Pen',
      variations: [makeVariation({ id: 'var_p0', characterId: 'chr_pen', name: 'Base', status: 'pending' })]
    })
    const failed = makeCharacter({
      id: 'chr_fai',
      name: 'Fai',
      variations: [makeVariation({ id: 'var_f0', characterId: 'chr_fai', name: 'Outfit: Coat', kind: 'outfit', status: 'failed', error: 'boom' })]
    })
    const readyButNoPath = makeCharacter({
      id: 'chr_nop',
      name: 'Nop',
      variations: [makeVariation({ id: 'var_n0', characterId: 'chr_nop', name: 'Base', status: 'ready', imagePath: null })]
    })
    const all = [...roster, pending, failed, readyButNoPath]
    const draft = d({ characters: [cast(pending, 'var_p0'), cast(failed, 'var_f0'), cast(readyButNoPath, 'var_n0')] })
    expect(validatePanelDraft(draft, all, [], lenient).errors).toEqual([
      'Variation "Base" of Pen has no ready reference image',
      'Variation "Outfit: Coat" of Fai has no ready reference image',
      'Variation "Base" of Nop has no ready reference image'
    ])
  })

  it('rejects archived characters (Review Focus 4)', () => {
    expect(validatePanelDraft(d({ characters: [cast(oldMan, 'var_o0')] }), roster, [], strict).errors).toEqual(['Character Old Man is archived'])
  })

  it('does not pile variation errors on top of an archived character', () => {
    const archivedPending = makeCharacter({ id: 'chr_arc', name: 'Arc', archived: true })
    expect(validatePanelDraft(d({ characters: [cast(archivedPending, 'var_0000000001')] }), [archivedPending], [], strict).errors).toEqual(['Character Arc is archived'])
  })

  it('allows an archived character to speak (existing panels keep rendering)', () => {
    expect(validatePanelDraft(d({ dialogue: [{ speakerId: 'chr_old', kind: 'speech', text: 'hmph' }] }), roster, [], strict).errors).toEqual([])
  })

  it('allows narration and sfx with no speaker, and speakers who are not in the cast', () => {
    const dialogue: Draft['dialogue'] = [
      { speakerId: null, kind: 'narration', text: 'Night fell.' },
      { speakerId: 'chr_jin', kind: 'speech', text: 'From off panel.' }
    ]
    expect(validatePanelDraft(d({ characters: [cast(mina, 'var_m0')], description: 'Mina listens.', dialogue }), roster, [], strict).errors).toEqual([])
  })

  it('reports cast errors in cast order, then speakers, then the mention guard', () => {
    const draft = d({
      description: 'Jin appears.',
      characters: [cast(oldMan, 'var_o0'), { ...cast(mina, 'var_m0'), characterId: 'chr_ghost' }, cast(mina, 'var_j0')],
      dialogue: [{ speakerId: 'chr_nobody', kind: 'speech', text: 'x' }]
    })
    expect(validatePanelDraft(draft, roster, [], strict).errors).toEqual([
      'Character Old Man is archived',
      'Unknown character: chr_ghost',
      'Variation var_j0 does not belong to Mina',
      'Unknown speaker: chr_nobody',
      'Mentioned but not attached: Jin. Attach them to characters or list them in offPanelMentions.'
    ])
  })

  it('reports one unknown speaker message per speaker id', () => {
    const line = { speakerId: 'chr_ghost', kind: 'speech' as const, text: 'x' }
    expect(validatePanelDraft(d({ dialogue: [line, line] }), roster, [], lenient).errors).toEqual(['Unknown speaker: chr_ghost'])
  })

  it('mention guard is whole-word and strict only for the agent', () => {
    const draft = d({ description: 'Mina looks at the poster of Jinx.' })
    expect(validatePanelDraft(draft, roster, [], { strictMentions: true }).errors).toEqual([
      'Mentioned but not attached: Mina. Attach them to characters or list them in offPanelMentions.'
    ])
    expect(validatePanelDraft(draft, roster, [], { strictMentions: true }).warnings).toEqual([])
    expect(validatePanelDraft(draft, roster, [], { strictMentions: false }).errors).toEqual([])
    expect(validatePanelDraft(draft, roster, [], { strictMentions: false }).warnings).toHaveLength(1)
    expect(validatePanelDraft({ ...draft, offPanelMentions: ['mina'] }, roster, [], { strictMentions: true }).errors).toEqual([])
  })

  it('lists every unattached name in one message', () => {
    const errors = validatePanelDraft(d({ description: 'Mina and Jin argue.' }), roster, [], strict).errors
    expect(errors).toEqual(['Mentioned but not attached: Mina, Jin. Attach them to characters or list them in offPanelMentions.'])
  })

  it('reports a character cast three times once', () => {
    const entries = [cast(mina, 'var_m0'), cast(mina, 'var_m0'), cast(mina, 'var_m1')]
    expect(validatePanelDraft(d({ description: 'Mina.', characters: entries }), roster, [], strict).errors).toEqual(['Mina is cast twice'])
  })

  it('treats a missing offPanelMentions as empty', () => {
    const { offPanelMentions: _omit, ...rest } = d({ description: 'Mina waits.' })
    expect(validatePanelDraft(rest, roster, [], strict).errors).toHaveLength(1)
  })

  it('does not flag a mentioned character who is attached', () => {
    expect(validatePanelDraft(d({ description: 'Mina meets Jin.', characters: [cast(mina, 'var_m0'), cast(jin, 'var_j0')] }), roster, [], strict)).toEqual({
      errors: [],
      warnings: []
    })
  })
})

describe('validatePanelDraft items', () => {
  const readyUsage = (itemId: string, id: string, name = 'At rest') =>
    makeItemUsage({ id, itemId, name, imagePath: `items/${itemId}/${id}.png`, status: 'ready' })
  const blaster = makeItem({ id: 'itm_blaster', name: 'Kestrel blaster', aliases: ['the Kestrel'], usages: [readyUsage('itm_blaster', 'use_b0')] })
  const oldKey = makeItem({ id: 'itm_key', name: 'Brass key', archived: true, usages: [readyUsage('itm_key', 'use_k0')] })
  const pendingItem = makeItem({
    id: 'itm_pen',
    name: 'Lantern',
    usages: [makeItemUsage({ id: 'use_p0', itemId: 'itm_pen', name: 'Lit', status: 'pending' })]
  })
  const itemRoster: Item[] = [blaster, oldKey, pendingItem]
  const attach = (item: Item, usageId: string, o: Partial<PanelItem> = {}): PanelItem => ({ itemId: item.id, usageId, heldBy: null, action: '', ...o })
  const run = (o: Partial<Draft>, opts = lenient) => validatePanelDraft(d(o), roster, itemRoster, opts)

  it('accepts a ready usage held by a cast member', () => {
    const draft = d({ description: 'Mina aims.', characters: [cast(mina, 'var_m0')], items: [attach(blaster, 'use_b0', { heldBy: 'chr_mina' })] })
    expect(validatePanelDraft(draft, roster, itemRoster, strict)).toEqual({ errors: [], warnings: [] })
  })

  it('accepts an item nobody holds', () => {
    expect(run({ items: [attach(blaster, 'use_b0', { heldBy: null })] }).errors).toEqual([])
  })

  it('reports an unknown item, an archived item, a foreign usage and a usage with no ready image', () => {
    const check = run({
      items: [attach(blaster, 'use_b0', { itemId: 'itm_x' }), attach(oldKey, 'use_k0'), attach(blaster, 'use_k0'), attach(pendingItem, 'use_p0')]
    })
    expect(check.errors).toEqual([
      'Unknown item: itm_x',
      'Item Brass key is archived',
      'Usage use_k0 does not belong to Kestrel blaster',
      'Usage "Lit" of Lantern has no ready reference image'
    ])
  })

  it('does not pile usage or holder errors on top of an archived item', () => {
    expect(run({ items: [attach(oldKey, 'use_nope', { heldBy: 'chr_mina' })] }).errors).toEqual(['Item Brass key is archived'])
  })

  it('rejects an item held by someone outside the cast', () => {
    const errors = run({ description: 'Jin waits.', characters: [cast(jin, 'var_j0')], items: [attach(blaster, 'use_b0', { heldBy: 'chr_mina' })] }).errors
    expect(errors).toContain('Kestrel blaster is held by Mina, who is not in the cast')
  })

  it('names an unknown holder by id', () => {
    expect(run({ items: [attach(blaster, 'use_b0', { heldBy: 'chr_ghost' })] }).errors).toEqual([
      'Kestrel blaster is held by chr_ghost, who is not in the cast'
    ])
  })

  it('rejects the same item attached twice', () => {
    expect(run({ items: [attach(blaster, 'use_b0'), attach(blaster, 'use_b0')] }).errors).toEqual(['Kestrel blaster is attached twice'])
  })

  it('reports item errors after dialogue speakers and before the mention guard', () => {
    const errors = run(
      {
        description: 'Jin appears with the Kestrel blaster.',
        dialogue: [{ speakerId: 'chr_nobody', kind: 'speech', text: 'x' }],
        items: [attach(oldKey, 'use_k0')]
      },
      strict
    ).errors
    expect(errors).toEqual([
      'Unknown speaker: chr_nobody',
      'Item Brass key is archived',
      'Mentioned but not attached: Jin. Attach them to characters or list them in offPanelMentions.',
      'Item mentioned but not attached: Kestrel blaster. Attach it to items, or list it in offPanelMentions if it is only talked about.'
    ])
  })

  it('guards item names: strict for the agent, a warning for the editor', () => {
    const draft = d({ description: 'Mina raises the Kestrel blaster', items: [] })
    const strictCheck = validatePanelDraft(draft, [], itemRoster, strict)
    expect(strictCheck.errors).toContain(
      'Item mentioned but not attached: Kestrel blaster. Attach it to items, or list it in offPanelMentions if it is only talked about.'
    )
    const lenientCheck = validatePanelDraft(draft, [], itemRoster, lenient)
    expect(lenientCheck.errors).toEqual([])
    expect(lenientCheck.warnings).toHaveLength(1)
  })

  it('does not flag a mentioned item that is attached, or an archived one', () => {
    const draft = d({ description: 'The Kestrel blaster and the Brass key.', items: [attach(blaster, 'use_b0')] })
    expect(validatePanelDraft(draft, roster, itemRoster, strict)).toEqual({ errors: [], warnings: [] })
  })

  it('accepts an item listed in offPanelMentions by alias', () => {
    const draft = d({ description: 'Everyone talks about the Kestrel blaster.', offPanelMentions: ['The Kestrel'] })
    expect(validatePanelDraft(draft, roster, itemRoster, strict)).toEqual({ errors: [], warnings: [] })
  })

  it('keeps the old messages for a panel without items', () => {
    const draft = d({ description: 'Jin appears.', characters: [cast(oldMan, 'var_o0')] })
    const withRoster = validatePanelDraft(draft, roster, itemRoster, strict)
    expect(withRoster).toEqual(validatePanelDraft(draft, roster, [], strict))
    expect(withRoster.errors).toEqual([
      'Character Old Man is archived',
      'Mentioned but not attached: Jin. Attach them to characters or list them in offPanelMentions.'
    ])
  })
})

describe('hasReadyUsage', () => {
  it('needs a ready status and a file', () => {
    expect(hasReadyUsage(makeItemUsage({ status: 'ready', imagePath: 'items/a.png' }))).toBe(true)
    expect(hasReadyUsage(makeItemUsage({ status: 'ready', imagePath: null }))).toBe(false)
    expect(hasReadyUsage(makeItemUsage({ status: 'pending', imagePath: 'items/a.png' }))).toBe(false)
    expect(hasReadyUsage(makeItemUsage({ status: 'failed', imagePath: null, error: 'boom' }))).toBe(false)
  })
})

describe('findUnattachedMentions', () => {
  const none = new Set<string>()

  it('matches whole words case-insensitively', () => {
    expect(findUnattachedMentions('MINA and jin walk', roster, none, [])).toEqual(['Mina', 'Jin'])
    expect(findUnattachedMentions('Jinx is a cat; Minatory is a word', roster, none, [])).toEqual([])
    expect(findUnattachedMentions("Mina's coat", roster, none, [])).toEqual(['Mina'])
  })

  it('matches aliases and reports the character name', () => {
    expect(findUnattachedMentions('Min-ah smiles', roster, none, [])).toEqual(['Mina'])
  })

  it('reports each character once even when the name and an alias both appear', () => {
    expect(findUnattachedMentions('Mina, also called Min-ah', roster, none, [])).toEqual(['Mina'])
  })

  it('skips attached characters', () => {
    expect(findUnattachedMentions('Mina and Jin', roster, new Set(['chr_mina']), [])).toEqual(['Jin'])
  })

  it('treats declared mentions case-insensitively, by name or alias', () => {
    expect(findUnattachedMentions('Mina and Jin', roster, none, ['MINA'])).toEqual(['Jin'])
    expect(findUnattachedMentions('Mina and Jin', roster, none, [' min-ah '])).toEqual(['Jin'])
  })

  it('ignores archived characters', () => {
    expect(findUnattachedMentions('The Old Man leaves', roster, none, [])).toEqual([])
  })

  it('escapes regex metacharacters in names and aliases', () => {
    const odd = makeCharacter({ id: 'chr_odd', name: 'Dr. (K)', aliases: ['C++', 'A.B'] })
    expect(findUnattachedMentions('Dr. (K) arrives', [odd], none, [])).toEqual(['Dr. (K)'])
    expect(findUnattachedMentions('he writes C++ daily', [odd], none, [])).toEqual(['Dr. (K)'])
    expect(findUnattachedMentions('AxB is not A.B', [odd], none, [])).toEqual(['Dr. (K)'])
    expect(findUnattachedMentions('AxB only', [odd], none, [])).toEqual([])
  })

  it('works with non-ASCII names and boundaries', () => {
    const seo = makeCharacter({ id: 'chr_seo', name: 'Seo-yeon', aliases: ['서연', 'Zoë'] })
    expect(findUnattachedMentions('서연이 웃는다', [seo], none, [])).toEqual([])
    expect(findUnattachedMentions('서연 웃는다', [seo], none, [])).toEqual(['Seo-yeon'])
    expect(findUnattachedMentions('Zoë waves', [seo], none, [])).toEqual(['Seo-yeon'])
    expect(findUnattachedMentions('Zoëa waves', [seo], none, [])).toEqual([])
  })

  it('matches multi-word names across any whitespace', () => {
    const duo = makeCharacter({ id: 'chr_duo', name: 'Big  Sister' })
    expect(findUnattachedMentions('the big\nsister sighs', [duo], none, [])).toEqual(['Big  Sister'])
  })

  it('ignores blank names and aliases', () => {
    const blank = makeCharacter({ id: 'chr_blank', name: 'Blank', aliases: ['', '  '] })
    expect(findUnattachedMentions('nothing here', [blank], none, [])).toEqual([])
  })
})
