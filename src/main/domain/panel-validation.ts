import type { Character, PanelDraft, Variation } from '@shared/types'

// Pure panel-draft validation (spec §9, step 2). No I/O: the caller passes the whole roster
// (archived characters included, so an archived cast member is named as such rather than reported
// as unknown). PanelService runs this before anything is written or generated.

export type PanelDraftFields = Pick<PanelDraft, 'description' | 'characters' | 'dialogue' | 'offPanelMentions'>

export interface PanelDraftCheck {
  errors: string[]
  warnings: string[]
}

/**
 * A variation can serve as a reference image only when it is `ready` and has a file. Shared with
 * prompt composition so "no reference image" in a prompt and "no ready reference image" here
 * can never disagree.
 */
export function hasReadyReference(variation: Variation): variation is Variation & { imagePath: string } {
  return variation.status === 'ready' && typeof variation.imagePath === 'string' && variation.imagePath.length > 0
}

/**
 * Messages come back in a stable order: cast errors in cast order, then dialogue speakers, then the
 * mention guard. An archived or unknown character is reported once and its variation is not
 * checked further (the entry has to go anyway). Identical messages are reported once.
 * `strictMentions` turns the mention guard into an error (the agent); otherwise it is a warning
 * (the manual editor).
 */
export function validatePanelDraft(draft: PanelDraftFields, roster: Character[], opts: { strictMentions: boolean }): PanelDraftCheck {
  const errors: string[] = []
  const warnings: string[] = []
  const report = (list: string[], message: string): void => {
    if (!list.includes(message)) list.push(message)
  }

  const byId = new Map(roster.map((c) => [c.id, c]))
  const castIds = new Set<string>()

  for (const entry of draft.characters) {
    const character = byId.get(entry.characterId)
    if (!character) {
      report(errors, `Unknown character: ${entry.characterId}`)
      continue
    }
    if (character.archived) {
      report(errors, `Character ${character.name} is archived`)
      continue
    }
    if (castIds.has(character.id)) report(errors, `${character.name} is cast twice`)
    castIds.add(character.id)

    const variation = character.variations.find((v) => v.id === entry.variationId)
    if (!variation) report(errors, `Variation ${entry.variationId} does not belong to ${character.name}`)
    else if (!hasReadyReference(variation)) report(errors, `Variation "${variation.name}" of ${character.name} has no ready reference image`)
  }

  for (const line of draft.dialogue) {
    if (line.speakerId !== null && !byId.has(line.speakerId)) report(errors, `Unknown speaker: ${line.speakerId}`)
  }

  const unattached = findUnattachedMentions(draft.description, roster, new Set(draft.characters.map((c) => c.characterId)), draft.offPanelMentions ?? [])
  if (unattached.length > 0) {
    const message = `Mentioned but not attached: ${unattached.join(', ')}. Attach them to characters or list them in offPanelMentions.`
    report(opts.strictMentions ? errors : warnings, message)
  }

  return { errors, warnings }
}

// Letters, digits and underscore (any script) count as word characters, so "Jin" does not match
// inside "Jinx" and a Korean name is not found inside a longer word. Hyphens and apostrophes do not,
// which keeps "Mina's" and "Min-ah" matching.
const WORD_CHAR = '[\\p{L}\\p{N}_]'

// Only the characters that may be escaped in a unicode-mode regex (`-` may not: `\-` throws under /u).
const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

const normalize = (s: string): string => s.trim().replace(/\s+/g, ' ').toLowerCase()

/** A whole-word, case-insensitive matcher for one name or alias. Whitespace inside it matches any whitespace. Null for a blank term. */
function wholeWord(term: string): RegExp | null {
  const words = term.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return null
  return new RegExp(`(?<!${WORD_CHAR})${words.map(escapeRegExp).join('\\s+')}(?!${WORD_CHAR})`, 'iu')
}

/**
 * Names (in roster order, one per character) of non-archived roster characters whose name or an
 * alias appears as a whole word in `text` although they are neither attached nor declared.
 * `declared` (offPanelMentions) is matched case-insensitively against the name and the aliases.
 */
export function findUnattachedMentions(text: string, roster: Character[], attachedIds: Set<string>, declared: string[]): string[] {
  const declaredTerms = new Set(declared.map(normalize).filter(Boolean))
  const found: string[] = []
  for (const character of roster) {
    if (character.archived || attachedIds.has(character.id)) continue
    const terms = [character.name, ...character.aliases]
    if (terms.some((t) => declaredTerms.has(normalize(t)))) continue
    if (terms.some((t) => wholeWord(t)?.test(text))) found.push(character.name)
  }
  return found
}
