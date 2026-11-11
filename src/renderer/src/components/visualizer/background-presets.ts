import type { StripBackground } from '@shared/types'

/** Colours to start from in the Color kind; any other colour is typed or picked in the editor. */
export const COLOR_PRESETS: string[] = [
  '#ffffff', '#f5f5f4', '#e7e5e4', '#a8a29e', '#57534e', '#1c1917', '#000000', '#fef3c7',
  '#fde68a', '#fdba74', '#f87171', '#e11d48', '#fbcfe8', '#f472b6', '#c026d3', '#7c3aed',
  '#a5b4fc', '#6366f1', '#1e3a8a', '#0ea5e9', '#7dd3fc', '#99f6e4', '#14b8a6', '#065f46',
  '#86efac', '#22c55e', '#bef264', '#facc15', '#92400e', '#78350f', '#0f172a', '#312e81'
]

export interface GradientPreset {
  name: string
  background: Extract<StripBackground, { kind: 'linear' | 'radial' }>
}

function linear(name: string, angle: number, ...colors: string[]): GradientPreset {
  return { name, background: { kind: 'linear', angle, repeatEvery: null, stops: colors.map((color, i) => ({ color, at: i / (colors.length - 1) })) } }
}

function radial(name: string, ...colors: string[]): GradientPreset {
  return { name, background: { kind: 'radial', repeatEvery: null, stops: colors.map((color, i) => ({ color, at: i / (colors.length - 1) })) } }
}

/** Gradients to start from in the Linear, Radial and Conic kinds. */
export const GRADIENT_PRESETS: GradientPreset[] = [
  linear('Dusk', 180, '#1e1b4b', '#7c3aed', '#f472b6'),
  linear('Dawn', 180, '#fde68a', '#fdba74', '#f87171'),
  linear('Midnight', 180, '#020617', '#1e3a8a'),
  linear('Ocean', 180, '#7dd3fc', '#0ea5e9', '#1e3a8a'),
  linear('Forest', 180, '#bef264', '#22c55e', '#065f46'),
  linear('Sunset', 180, '#facc15', '#f87171', '#7c3aed'),
  linear('Mist', 180, '#ffffff', '#e7e5e4'),
  linear('Ink wash', 180, '#ffffff', '#a8a29e', '#1c1917'),
  linear('Cherry blossom', 135, '#fbcfe8', '#ffffff'),
  linear('Neon city', 135, '#0f172a', '#7c3aed', '#14b8a6'),
  linear('Ember', 90, '#1c1917', '#92400e', '#facc15'),
  linear('Candy', 45, '#f472b6', '#a5b4fc'),
  radial('Spotlight', '#ffffff', '#000000'),
  radial('Glow', '#fef3c7', '#fb923c', '#7f1d1d'),
  radial('Moonlit', '#99f6e4', '#1e3a8a', '#020617'),
  radial('Vignette', '#f5f5f4', '#a8a29e')
]
