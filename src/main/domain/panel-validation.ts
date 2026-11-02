import type { Character, Item, ItemUsage, PanelDraft, Variation } from '@shared/types'

// Pure panel-draft validation (spec §9, step 2). No I/O: the caller passes the whole roster
// (archived characters included, so an archived cast member is named as such rather than reported
// as unknown). PanelService runs this before anything is written or generated.

export type PanelDraftFields = Pick<PanelDraft, 'description' | 'characters' | 'dialogue' | 'offPanelMentions' | 'items'>

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

/** The same rule as `hasReadyReference`, for an item usage. */
export function hasReadyUsage(usage: ItemUsage): usage is ItemUsage & { imagePath: string } {
  return usage.status === 'ready' && typeof usage.imagePath === 'string' && usage.imagePath.length > 0
}

/**
 * Messages come back in a stable order: cast errors in cast order, then dialogue speakers, then item
 * errors in item order, then the mention guard (characters, then items). An archived or unknown
 * character is reported once and its variation is not checked further (the entry has to go anyway);
 * an item works the same way. Identical messages are reported once.
 * `strictMentions` turns the mention guard into an error (the agent); otherwise it is a warning
 * (the manual editor).
 */
export function validatePanelDraft(draft: PanelDraftFields, roster: Character[], itemRoster: Item[], opts: { strictMentions: boolean }): PanelDraftCheck {
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

  const itemsById = new Map(itemRoster.map((i) => [i.id, i]))
  const draftCharacterIds = new Set(draft.characters.map((c) => c.characterId))
  const attachedItemIds = new Set<string>()

  for (const entry of draft.items ?? []) {
    const item = itemsById.get(entry.itemId)
    if (!item) {
      report(errors, `Unknown item: ${entry.itemId}`)
      continue
    }
    if (item.archived) {
      report(errors, `Item ${item.name} is archived`)
      continue
    }
    if (attachedItemIds.has(item.id)) report(errors, `${item.name} is attached twice`)
    attachedItemIds.add(item.id)

    const usage = item.usages.find((u) => u.id === entry.usageId)
    if (!usage) report(errors, `Usage ${entry.usageId} does not belong to ${item.name}`)
    else if (!hasReadyUsage(usage)) report(errors, `Usage "${usage.name}" of ${item.name} has no ready reference image`)

    if (entry.heldBy !== null && !draftCharacterIds.has(entry.heldBy)) {
      const holderName = byId.get(entry.heldBy)?.name
      report(errors, `${item.name} is held by ${holderName ?? entry.heldBy}, who is not in the cast`)
    }
  }

  const unattached = findUnattachedMentions(draft.description, roster, new Set(draft.characters.map((c) => c.characterId)), draft.offPanelMentions ?? [])
  if (unattached.length > 0) {
    const message = `Mentioned but not attached: ${unattached.join(', ')}. Attach them to characters or list them in offPanelMentions.`
    report(opts.strictMentions ? errors : warnings, message)
  }

  const unattachedItems = findUnattachedMentions(draft.description, itemRoster, attachedItemIds, draft.offPanelMentions ?? [])
  if (unattachedItems.length > 0) {
    const message = `Item mentioned but not attached: ${unattachedItems.join(', ')}. Attach it to items, or list it in offPanelMentions if it is only talked about.`
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

/** What the mention guard needs to know about a roster entry; `Character` and `Item` both fit. */
type Mentionable = { id: string; name: string; aliases: string[]; archived: boolean }

/**
 * Names (in roster order, one per entry) of non-archived roster entries (characters or items) whose name or an
 * alias appears as a whole word in `text` although they are neither attached nor declared.
 * `declared` (offPanelMentions) is matched case-insensitively against the name and the aliases.
 */
export function findUnattachedMentions(text: string, roster: Mentionable[], attachedIds: Set<string>, declared: string[]): string[] {
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
