import type { Character, Variation } from '@shared/types'

// Prompt builders for generated images. Wording is pinned by tests: the image models are sensitive
// to it, and every sheet must say "no text" because dialogue is rendered as HTML (never in the image).

export function baseReferencePrompt(c: Character, stylePreset: string): string {
  return `Character reference sheet. ${stylePreset}. Full body, front view, neutral expression, standing straight, plain light-gray background, even studio lighting, no text. ${c.appearanceLock}`
}

export function variationPrompt(c: Character, v: Variation, stylePreset: string): string {
  return `Character reference sheet. ${stylePreset}. Full body, front view, plain light-gray background, no text. ${c.appearanceLock} Variation: ${v.name} — ${v.delta}. Keep face, hair, body and colors identical to the reference image except for the variation.`
}
