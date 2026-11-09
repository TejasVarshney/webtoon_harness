import { DEFAULT_STYLE_PRESET } from '@shared/schemas'

/** The styles the app ships. They describe line, shading, palette and rendering, and never name an artist or a franchise. Ids are stable: a user's edits are saved against them. */
export const BUILTIN_STYLES: { id: string; name: string; text: string }[] = [
  { id: 'korean-webtoon', name: 'Korean webtoon', text: DEFAULT_STYLE_PRESET },
  { id: 'soft-romance', name: 'Soft romance', text: 'Soft romance webtoon style, delicate thin line art, airbrushed pastel shading, glowing highlights, gentle warm blush tones' },
  { id: 'action-manhwa', name: 'Action manhwa', text: 'Bold action manhwa style, heavy confident inks, high-contrast cel shading, saturated colors, sharp dynamic linework' },
  { id: 'dark-fantasy', name: 'Painterly dark fantasy', text: 'Painterly dark fantasy style, textured digital brushwork, muted earthy palette, dramatic chiaroscuro lighting' },
  { id: 'ink-noir', name: 'Ink noir', text: 'Black-and-white ink noir style, high-contrast brush inks, solid black shadows, no color' },
  { id: 'screentone-manga', name: 'Screentone manga', text: 'Black-and-white manga style, fine pen linework, halftone screentone shading, clean white highlights, no color' },
  { id: 'watercolor', name: 'Watercolor', text: 'Soft watercolor illustration style, loose pencil outlines, translucent color washes, visible paper grain, warm natural colors' },
  { id: 'flat-slice-of-life', name: 'Flat slice-of-life', text: 'Flat-color slice-of-life style, simple clean outlines, minimal shading, bright friendly pastel palette' },
  { id: 'retro-comic', name: 'Retro print comic', text: 'Retro print comic style, bold black outlines, flat primary colors, visible halftone dots, slightly off-register inks' },
  { id: 'semi-realistic', name: 'Semi-realistic painting', text: 'Semi-realistic digital painting style, refined anatomy, subtly rendered skin, cinematic natural lighting' }
]
