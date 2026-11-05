// Where an exported strip is cut. Pure. Limits are set in output px at scale 1 (800 px wide); slices are planned in
// CSS px of the export view, which is laid out STRIP_CSS_WIDTH (440) CSS px wide and captured at 800 / 440 × scale.

import { cssFromPx } from '@shared/strip-width'

/** One horizontal cut of the strip. */
export interface Slice {
  top: number
  height: number
}

/** The tallest bitmap a long-image part may be, in output pixels. */
export const MAX_LONG_IMAGE_PX = 65000

/** Slice height in output px at scale 1 for the formats that cut at a fixed page height. */
export const PAGE_HEIGHT = { webtoon: 1280, 'pdf-reading': 1280, cbz: 1280 } as const

/** Page height in output px at scale 1 for print PDFs: the printable height of the page with 800 px across the printable width. */
export const PRINT_PAGE_HEIGHT = { a4: 1177, letter: 1067 } as const

/** A fixed page height in whole CSS px: 1280 px → 704. */
export function pageHeightCss(preset: keyof typeof PAGE_HEIGHT): number {
  return cssFromPx(PAGE_HEIGHT[preset])
}

/** A print page's height in whole CSS px, rounded down so the page's image fits the printable height. */
export function printPageHeightCss(paper: keyof typeof PRINT_PAGE_HEIGHT): number {
  return cssFromPx(PRINT_PAGE_HEIGHT[paper])
}

/** The tallest part of a long image in CSS px, so the part stays within 65,000 output px at `scale`. */
export function longImagePartHeight(scale: 1 | 2): number {
  return cssFromPx(Math.floor(MAX_LONG_IMAGE_PX / scale))
}

/**
 * Cut a strip into slices of at most `pageHeight`. With `breaks: 'rows'` a slice ends at the last row
 * bottom that still fits, falling back to a cut inside the row when none does. The last slice ends at `totalHeight`.
 */
export function planSlices(input: {
  totalHeight: number
  rows: { top: number; bottom: number }[]
  pageHeight: number
  breaks: 'anywhere' | 'rows'
}): Slice[] {
  const { totalHeight, rows, pageHeight, breaks } = input
  const slices: Slice[] = []
  let top = 0
  while (top < totalHeight) {
    const limit = top + pageHeight
    let end = Math.min(limit, totalHeight)
    if (breaks === 'rows' && limit < totalHeight) {
      // The lowest row bottom inside this page; if none, the cut stays at the page limit.
      let best = 0
      for (const row of rows) if (row.bottom > top && row.bottom <= limit && row.bottom > best) best = row.bottom
      if (best > 0) end = best
    }
    slices.push({ top, height: end - top })
    top = end
  }
  return slices
}
