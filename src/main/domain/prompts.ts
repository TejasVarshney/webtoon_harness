import type { Character, Item, ItemUsage, Panel, Variation } from '@shared/types'
import { drawAspect, isTallAspect } from '@shared/draw-aspect'
import { hasReadyReference, hasReadyUsage } from './panel-validation'

// Prompt builders for generated images. Wording is pinned by tests: the image models are sensitive
// to it, and every sheet must say "no text" because dialogue is rendered as HTML (never in the image).

/** The redraw instruction after a failed sheet check: `Important details: a; b.`, plain description added to the drawing prompt, or undefined when there are no issues. */
export function sheetFixInstruction(issues: string[]): string | undefined {
  return issues.length > 0 ? `Important details: ${issues.join('; ')}.` : undefined
}

/** Appends the optional fix instruction to a sheet prompt, after one space. */
function withFix(prompt: string, fix?: string): string {
  return fix ? `${prompt} ${fix}` : prompt
}

export function baseReferencePrompt(c: Character, stylePreset: string, fix?: string): string {
  return withFix(`Character reference sheet. ${stylePreset}. Full body, front view, neutral expression, standing straight, plain light-gray background, even studio lighting, no text. ${c.appearanceLock}`, fix)
}

export function variationPrompt(c: Character, v: Variation, stylePreset: string, fix?: string): string {
  return withFix(`Character reference sheet. ${stylePreset}. Full body, front view, plain light-gray background, no text. ${c.appearanceLock} Variation: ${v.name} — ${v.delta}. Keep face, hair, body and colors identical to the reference image except for the variation.`, fix)
}

export function itemReferencePrompt(item: Item, stylePreset: string, fix?: string): string {
  return withFix(`Item reference sheet. ${stylePreset}. The object alone, three-quarter view, centered, plain light-gray background, even studio lighting, no people, no hands, no text. ${item.appearanceLock}`, fix)
}

/** Action usages show only the gray grip; every other kind (state, and base, which `itemReferencePrompt` makes) uses the state wording. */
export function itemUsagePrompt(item: Item, usage: ItemUsage, stylePreset: string, fix?: string): string {
  if (usage.kind === 'action') {
    return withFix(`Item usage reference sheet. ${stylePreset}. Plain light-gray background, no text. ${item.appearanceLock} Usage: ${usage.name} — ${usage.delta}. Show only plain gray hands and forearms, cropped at the elbow, with no face, body, clothing or jewelry, so the sheet shows only the grip, the motion and the effect. Keep shape, size, materials, colors and markings identical to the reference image.`, fix)
  }
  return withFix(`Item reference sheet. ${stylePreset}. The object alone, three-quarter view, plain light-gray background, no people, no hands, no text. ${item.appearanceLock} State: ${usage.name} — ${usage.delta}. Keep shape, size, materials, colors and markings identical to the reference image except for the state.`, fix)
}

// ---------------------------------------------------------------------------------------------
// Panel prompts (spec §9). Dialogue never enters an image prompt: it is rendered as HTML over the
// panel, so `composePanelPrompt` does not even accept it.
// ---------------------------------------------------------------------------------------------

/** Whose image a reference is. The checker matches references to cast and items by this, never by label. */
type ReferenceSubject = { kind: 'character'; id: string } | { kind: 'item'; id: string } | { kind: 'sketch' } | { kind: 'previous' }

export interface PanelPromptReference {
  relPath: string
  label: string
  subject: ReferenceSubject
}

export interface PanelPromptInput {
  stylePreset: string
  panel: Pick<Panel, 'description' | 'setting' | 'shot' | 'aspect' | 'frame' | 'characters' | 'items' | 'continuityNotes'>
  /** Characters; resolves cast entries and the holders of items. */
  roster: Map<string, Character>
  itemRoster: Map<string, Item>
  previous: { panelId: string; imagePath: string } | null
  /** The user's layout sketch, for a generation only (an edit keeps the image's own composition). */
  sketch?: string | null
  /** The image model's reference-image cap. */
  maxReferences: number
}

export interface PanelPromptResult {
  prompt: string
  /** In prompt order: ready cast variations (cast order), then ready item usages (panel order), then the sketch, then the previous panel. */
  references: PanelPromptReference[]
}

const TALL_NOTE = 'Tall panel: keep the top fifth and bottom fifth plain background (sky, floor, darkness), so they can fade out.'
const BORDERLESS_NOTE = 'Art runs to the edges, no frame.'

const NO_REFERENCE = '(no reference image)'

const LAYOUT_PREFIX = '[LAYOUT] Follow the rough composition of the sketch'
const LAYOUT_NOTE =
  ': where the figures and objects sit, their poses, the camera angle and the framing. It is a rough guide only: never copy its scribbled lines, flat colours or blank background, and draw everything in the style above.'

/** Tall panels always fade out, so they never get the borderless line. */
function shapeNote(panel: Pick<Panel, 'aspect' | 'frame'>): string {
  if (isTallAspect(panel.aspect)) return ` ${TALL_NOTE}`
  return panel.frame === 'borderless' ? ` ${BORDERLESS_NOTE}` : ''
}

const ITEMS_HEADER =
  "[ITEMS] Draw each item exactly as its reference image shows it, and use it exactly as its reference shows. Gray hands in an item reference only show the grip: draw the holder's own hands, never gray hands."

/**
 * Builds the §9 panel prompt and its ordered reference list. References are the cast members'
 * variation images in cast order, then the panel items' usage images in panel order, then the user's
 * layout sketch (a [LAYOUT] line, left out with its image), then the previous panel's image; over
 * `maxReferences` the previous panel is dropped first, then the sketch, then items from the end,
 * then cast members from the end, and a dropped entry reads "(no reference image)" (an item's lock
 * still applies). A cast member or item whose image is not ready reads the same way (validation
 * reports that separately). Throws if a cast entry names a character or variation that is not in
 * `roster`, or an item entry names an item or usage that is not in `itemRoster`: callers validate
 * first. Archived characters and items still compose, so existing panels can be regenerated.
 */
export function composePanelPrompt(input: PanelPromptInput): PanelPromptResult {
  const { stylePreset, panel, roster, itemRoster, previous, sketch, maxReferences } = input
  const references: PanelPromptReference[] = []

  /** The "(reference image N)" marker if `file` fits under the cap (and is recorded as a reference), else "(no reference image)". */
  const refer = (file: string | null, label: string, subject: ReferenceSubject): string => {
    if (file === null || references.length >= maxReferences) return NO_REFERENCE
    references.push({ relPath: file, label, subject })
    return `(reference image ${references.length})`
  }

  const castLines = panel.characters.map((entry) => {
    const character = roster.get(entry.characterId)
    if (!character) throw new Error(`Unknown character: ${entry.characterId}`)
    const variation = character.variations.find((v) => v.id === entry.variationId)
    if (!variation) throw new Error(`Variation ${entry.variationId} does not belong to ${character.name}`)

    const marker = refer(hasReadyReference(variation) ? variation.imagePath : null, character.name, { kind: 'character', id: character.id })
    const look = variation.delta ? `${variation.name} — ${variation.delta}` : variation.name
    const details = [
      character.appearanceLock,
      `Look: ${look}.`,
      entry.action && `Action: ${entry.action}.`,
      entry.expression && `Expression: ${entry.expression}.`,
      entry.position.trim() && `Position: ${entry.position.trim()}.`
    ]
    return `- ${character.name} ${marker}: ${details.filter(Boolean).join(' ')}`
  })

  const itemLines = panel.items.map((entry) => {
    const item = itemRoster.get(entry.itemId)
    if (!item) throw new Error(`Unknown item: ${entry.itemId}`)
    const usage = item.usages.find((u) => u.id === entry.usageId)
    if (!usage) throw new Error(`Usage ${entry.usageId} does not belong to ${item.name}`)

    const marker = refer(hasReadyUsage(usage) ? usage.imagePath : null, item.name, { kind: 'item', id: item.id })
    const look = usage.delta ? `${usage.name} — ${usage.delta}` : usage.name
    const holder = entry.heldBy === null ? 'nobody' : (roster.get(entry.heldBy)?.name ?? entry.heldBy)
    const action = entry.action.trim()
    return `- ${item.name} ${marker}: ${item.appearanceLock} Use: ${look}. Held by: ${holder}.${action ? ` Action: ${action}.` : ''}`
  })

  const lines = [
    `[STYLE] ${stylePreset}. Vertical-scroll webtoon panel, ${drawAspect(panel.aspect)} aspect ratio, ${panel.shot} shot. No text, no speech bubbles, no captions, no watermark.${shapeNote(panel)}`,
    `[SETTING] ${panel.setting}`,
    `[ACTION] ${panel.description}`,
    '[CHARACTERS]',
    ...castLines
  ]

  if (itemLines.length > 0) lines.push(ITEMS_HEADER, ...itemLines)

  if (sketch) {
    const marker = refer(sketch, 'layout sketch', { kind: 'sketch' })
    if (marker !== NO_REFERENCE) lines.push(`${LAYOUT_PREFIX} ${marker}${LAYOUT_NOTE}`)
  }

  if (previous) {
    const marker = refer(previous.imagePath, 'previous panel', { kind: 'previous' })
    const continuity = `[CONTINUITY] Continues directly from the previous panel ${marker}. Keep setting layout, lighting, time of day and outfits consistent.`
    lines.push([continuity, panel.continuityNotes.trim()].filter(Boolean).join(' '))
  }

  return { prompt: lines.join('\n'), references }
}

/** The instruction for editing an existing panel image in place (the first reference image). */
export function editPanelPrompt(
  instruction: string,
  cast: { name: string; appearanceLock: string }[],
  items: { name: string; appearanceLock: string }[] = []
): string {
  const onModelItems = items.length > 0 ? ` and keep these items on-model: ${items.map((i) => `${i.name}: ${i.appearanceLock}`).join(' ')}` : ''
  return `Edit the first image: ${instruction}. Keep everything else unchanged — composition, framing, lighting, art style — and keep these characters on-model: ${cast.map((c) => `${c.name}: ${c.appearanceLock}`).join(' ')}${onModelItems} No text, no speech bubbles.`
}
