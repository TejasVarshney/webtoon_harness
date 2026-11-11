// What an episode's strip is painted on: a colour, a gradient or an image. Pure, so the screen and the export can share
// it. The CSS comes from `stripBackgroundStyle`; an episode with none stored reads its old gutter bands (`legacyBackground`).

import { z } from 'zod'
import { HexColor } from './schema-primitives'
import { contentBottom, type PlacedPanel } from './strip-canvas'

const GradientStopSchema = z.object({ color: HexColor, at: z.number().min(0).max(1) })
const StopsSchema = z.array(GradientStopSchema).min(2).max(12)
/** How often a gradient starts over down the strip, in strip px; `null` stretches it over the whole content. */
const RepeatEverySchema = z.number().min(20).max(20000).nullable().default(null)

export const StripBackgroundSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('solid'), color: HexColor }),
  z.object({ kind: z.literal('linear'), stops: StopsSchema, angle: z.number().min(0).max(360).default(180), repeatEvery: RepeatEverySchema }),
  z.object({ kind: z.literal('radial'), stops: StopsSchema, repeatEvery: RepeatEverySchema }),
  z.object({ kind: z.literal('conic'), stops: StopsSchema, angle: z.number().min(0).max(360).default(0), repeatEvery: RepeatEverySchema }),
  z.object({
    kind: z.literal('image'),
    /** A project-relative path the episode stored itself (`episode-backgrounds/<episodeId>/...`). */
    path: z.string().min(1),
    fit: z.enum(['width', 'tile', 'stretch']).default('width'),
    /** 1 shows the image as it is; less lets the colour behind it through. */
    opacity: z.number().min(0).max(1).default(1),
    color: HexColor.default('#ffffff')
  })
])

export type StripBackground = z.infer<typeof StripBackgroundSchema>
type Gradient = Extract<StripBackground, { stops: unknown }>

const WHITE = '#ffffff'
const BLACK = '#000000'

function stopList(stops: Gradient['stops']): string {
  return stops.map((s) => `${s.color} ${Number((s.at * 100).toFixed(3))}%`).join(', ')
}

/** The two hex digits of an alpha, so `#rrggbb` + this is a colour with that opacity. */
function alphaHex(alpha: number): string {
  return Math.round(alpha * 255).toString(16).padStart(2, '0')
}

/**
 * The CSS properties that paint `bg` on a canvas whose content is `bottom` px tall. A gradient that does not repeat
 * covers the content and leaves white below it; an image is veiled by its colour, so less opacity shows more colour.
 * `imageUrl` is the image's URL once the caller has made one; without it an image background shows its colour only.
 */
export function stripBackgroundStyle(bg: StripBackground, at: { imageUrl: string | null; bottom: number }): Record<string, string> {
  if (bg.kind === 'solid') return { backgroundColor: bg.color }
  if (bg.kind === 'image') {
    if (at.imageUrl === null) return { backgroundColor: bg.color }
    const veil = `${bg.color}${alphaHex(1 - bg.opacity)}`
    const size = { width: '100% auto', tile: 'auto', stretch: `100% ${at.bottom}px` }[bg.fit]
    return {
      backgroundColor: bg.color,
      backgroundImage: `linear-gradient(${veil}, ${veil}), url("${at.imageUrl}")`,
      backgroundSize: size,
      backgroundRepeat: { width: 'repeat-y', tile: 'repeat', stretch: 'no-repeat' }[bg.fit]
    }
  }
  const stops = stopList(bg.stops)
  const image = {
    linear: `linear-gradient(${bg.kind === 'linear' ? bg.angle : 0}deg, ${stops})`,
    radial: `radial-gradient(${stops})`,
    conic: `conic-gradient(from ${bg.kind === 'conic' ? bg.angle : 0}deg, ${stops})`
  }[bg.kind]
  return {
    backgroundColor: WHITE,
    backgroundImage: image,
    backgroundSize: `100% ${bg.repeatEvery ?? at.bottom}px`,
    backgroundRepeat: bg.repeatEvery === null ? 'no-repeat' : 'repeat-y'
  }
}

/**
 * What the strip showed before it had a background: each row of panels, and the gap after it, in the gutter colour of
 * the row's last panel. Rows are the panels that share a top edge; a band runs to the top of the next row. White all
 * through reads as a plain white; anything else is a hard-edged linear gradient.
 */
export function legacyBackground(placed: PlacedPanel[]): StripBackground {
  const bottom = contentBottom(placed)
  const rows = new Map<number, PlacedPanel[]>()
  for (const p of [...placed].sort((a, b) => a.y - b.y || a.x - b.x)) rows.set(p.y, [...(rows.get(p.y) ?? []), p])
  const bands = [...rows.entries()].map(([top, panels]) => ({ top, color: panels[panels.length - 1].panel.gutter === 'black' ? BLACK : WHITE }))
  if (bottom <= 0 || bands.every((b) => b.color === bands[0].color)) return { kind: 'solid', color: bands[0]?.color ?? WHITE }

  const stops: Gradient['stops'] = [{ color: bands[0].color, at: 0 }]
  for (let i = 1; i < bands.length; i++) {
    if (bands[i].color === bands[i - 1].color) continue
    const at = Math.min(1, bands[i].top / bottom)
    stops.push({ color: bands[i - 1].color, at }, { color: bands[i].color, at })
  }
  stops.push({ color: stops[stops.length - 1].color, at: 1 })
  return { kind: 'linear', angle: 180, repeatEvery: null, stops }
}

/** The background to paint: the episode's own, else the one its gutters made. */
export function effectiveBackground(stored: StripBackground | null, placed: PlacedPanel[]): StripBackground {
  return stored ?? legacyBackground(placed)
}
