import type { CSSProperties } from 'react'
import type { BubbleFont, BubbleShape, BubbleStyle } from '@shared/types'

// A bubble's look. The stylesheet holds each shape's default; a line's `style` stores only what differs from it, and
// `bubbleStyleProps` turns that into inline variables and text properties that override the stylesheet.

/** Every key but the shape, which has none here, and the width: without one, the bubble fits its text. */
type Defaults = Required<Omit<BubbleStyle, 'shape' | 'width'>>

const FALLBACK = "'Comic Neue', var(--font)"

export const FONTS: { id: BubbleFont; label: string; family: string }[] = [
  { id: 'comic', label: 'Comic Neue', family: `'Comic Neue', var(--font)` },
  { id: 'bangers', label: 'Bangers', family: `'Bangers', ${FALLBACK}` },
  { id: 'hand', label: 'Patrick Hand', family: `'Patrick Hand', ${FALLBACK}` },
  { id: 'impact', label: 'Anton', family: `'Anton', ${FALLBACK}` },
  { id: 'serif', label: 'Lora', family: `'Lora', ${FALLBACK}` },
  { id: 'typewriter', label: 'Special Elite', family: `'Special Elite', ${FALLBACK}` }
]

/** What the stylesheet draws for a shape when the line sets nothing. Keep in step with the `.bubble-*` rules. */
export function bubbleDefaults(shape: BubbleShape): Defaults {
  const base: Defaults = { font: 'comic', size: 1, bold: true, italic: false, caps: true, align: 'center', color: '#111111', fill: '#ffffff', stroke: '#111111', strokeWidth: 2, padding: 1 }
  switch (shape) {
    case 'whisper':
    case 'thought':
      return { ...base, bold: false }
    case 'caption':
      return { ...base, align: 'left' }
    case 'sfx':
      return { ...base, font: 'bangers', bold: false, color: '#ffffff' }
    default:
      return base
  }
}

/** Only the keys the style sets, so a line with no style, or a key left out, keeps the stylesheet's look. */
export function bubbleStyleProps(style: BubbleStyle | null): CSSProperties {
  if (!style) return {}
  const props: Record<string, string | number> = {}
  if (style.size !== undefined) props['--bubble-size'] = String(style.size)
  if (style.padding !== undefined) props['--bubble-padding'] = String(style.padding)
  if (style.fill !== undefined) props['--bubble-fill'] = style.fill
  if (style.stroke !== undefined) props['--bubble-stroke'] = style.stroke
  if (style.strokeWidth !== undefined) props['--bubble-stroke-width'] = `${style.strokeWidth}px`
  if (style.color !== undefined) props['--bubble-color'] = style.color
  if (style.bold !== undefined) props.fontWeight = style.bold ? 700 : 400
  if (style.italic !== undefined) props.fontStyle = style.italic ? 'italic' : 'normal'
  if (style.caps !== undefined) props.textTransform = style.caps ? 'uppercase' : 'none'
  if (style.align !== undefined) props.textAlign = style.align
  if (style.font !== undefined) props.fontFamily = FONTS.find((f) => f.id === style.font)!.family
  // Drawn by `.bubble-sized`, which the overlay adds when there is a width.
  if (style.width !== undefined) props['--bubble-width'] = `${Math.round(style.width * 10000) / 100}%`
  return props as CSSProperties
}

/**
 * The style after one change. A key set to its default, or to undefined, is dropped, and a style left with no keys is
 * null, so a line is only ever styled by what the user actually changed. `shape` and `width` have no default here:
 * they are kept whenever they are given.
 */
export function withStyleChange(style: BubbleStyle | null, change: Partial<BubbleStyle>, defaults: Defaults): BubbleStyle | null {
  const next: Record<string, unknown> = { ...style, ...change }
  for (const key of Object.keys(next)) {
    if (next[key] === undefined || (key !== 'shape' && next[key] === defaults[key as keyof Defaults])) delete next[key]
  }
  return Object.keys(next).length === 0 ? null : (next as BubbleStyle)
}
