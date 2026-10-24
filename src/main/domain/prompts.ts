import type { Character, Panel, Variation } from '@shared/types'
import { hasReadyReference } from './panel-validation'

// Prompt builders for generated images. Wording is pinned by tests: the image models are sensitive
// to it, and every sheet must say "no text" because dialogue is rendered as HTML (never in the image).

export function baseReferencePrompt(c: Character, stylePreset: string): string {
  return `Character reference sheet. ${stylePreset}. Full body, front view, neutral expression, standing straight, plain light-gray background, even studio lighting, no text. ${c.appearanceLock}`
}

export function variationPrompt(c: Character, v: Variation, stylePreset: string): string {
  return `Character reference sheet. ${stylePreset}. Full body, front view, plain light-gray background, no text. ${c.appearanceLock} Variation: ${v.name} — ${v.delta}. Keep face, hair, body and colors identical to the reference image except for the variation.`
}

// ---------------------------------------------------------------------------------------------
// Panel prompts (spec §9). Dialogue never enters an image prompt: it is rendered as HTML over the
// panel, so `composePanelPrompt` does not even accept it.
// ---------------------------------------------------------------------------------------------

export interface PanelPromptReference {
  relPath: string
  label: string
}

export interface PanelPromptInput {
  stylePreset: string
  panel: Pick<Panel, 'description' | 'setting' | 'shot' | 'aspect' | 'characters' | 'continuityNotes'>
  roster: Map<string, Character>
  previous: { panelId: string; imagePath: string } | null
  /** The image model's reference-image cap. */
  maxReferences: number
}

export interface PanelPromptResult {
  prompt: string
  /** In prompt order: ready cast variations (cast order), then the previous panel. */
  references: PanelPromptReference[]
}

const NO_REFERENCE = '(no reference image)'

/**
 * Builds the §9 panel prompt and its ordered reference list. References are the cast members'
 * variation images in cast order, then the previous panel's image; over `maxReferences` the previous
 * panel is dropped first, then cast members from the end, and a dropped entry reads
 * "(no reference image)". A cast member whose variation has no ready image reads the same way
 * (validation reports that separately). Throws if a cast entry names a character or variation that is
 * not in `roster`: callers validate first. Archived characters still compose, so existing panels can
 * be regenerated.
 */
export function composePanelPrompt(input: PanelPromptInput): PanelPromptResult {
  const { stylePreset, panel, roster, previous, maxReferences } = input
  const references: PanelPromptReference[] = []

  /** The "(reference image N)" marker if `file` fits under the cap (and is recorded as a reference), else "(no reference image)". */
  const refer = (file: string | null, label: string): string => {
    if (file === null || references.length >= maxReferences) return NO_REFERENCE
    references.push({ relPath: file, label })
    return `(reference image ${references.length})`
  }

  const castLines = panel.characters.map((entry) => {
    const character = roster.get(entry.characterId)
    if (!character) throw new Error(`Unknown character: ${entry.characterId}`)
    const variation = character.variations.find((v) => v.id === entry.variationId)
    if (!variation) throw new Error(`Variation ${entry.variationId} does not belong to ${character.name}`)

    const marker = refer(hasReadyReference(variation) ? variation.imagePath : null, character.name)
    const look = variation.delta ? `${variation.name} — ${variation.delta}` : variation.name
    const details = [
      character.appearanceLock,
      `Look: ${look}.`,
      entry.action && `Action: ${entry.action}.`,
      entry.expression && `Expression: ${entry.expression}.`,
      `Position: ${entry.position}.`
    ]
    return `- ${character.name} ${marker}: ${details.filter(Boolean).join(' ')}`
  })

  const lines = [
    `[STYLE] ${stylePreset}. Vertical-scroll webtoon panel, ${panel.aspect} aspect ratio, ${panel.shot} shot. No text, no speech bubbles, no captions, no watermark.`,
    `[SETTING] ${panel.setting}`,
    `[ACTION] ${panel.description}`,
    '[CHARACTERS]',
    ...castLines
  ]

  if (previous) {
    const marker = refer(previous.imagePath, 'previous panel')
    const continuity = `[CONTINUITY] Continues directly from the previous panel ${marker}. Keep setting layout, lighting, time of day and outfits consistent.`
    lines.push([continuity, panel.continuityNotes.trim()].filter(Boolean).join(' '))
  }

  return { prompt: lines.join('\n'), references }
}

/** The instruction for editing an existing panel image in place (the first reference image). */
export function editPanelPrompt(instruction: string, cast: { name: string; appearanceLock: string }[]): string {
  return `Edit the first image: ${instruction}. Keep everything else unchanged — composition, framing, lighting, art style — and keep these characters on-model: ${cast.map((c) => `${c.name}: ${c.appearanceLock}`).join(' ')} No text, no speech bubbles.`
}
