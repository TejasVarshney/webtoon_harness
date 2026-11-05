// Where an exported strip is cut. Pure: heights are CSS px of the 800 px wide export view.

/** One horizontal cut of the strip. */
export interface Slice {
  top: number
  height: number
}

/** The tallest bitmap a long-image part may be, in device pixels. */
export const MAX_LONG_IMAGE_PX = 65000

/** Slice height in CSS px for the formats that cut at a fixed page height. */
export const PAGE_HEIGHT = { webtoon: 1280, 'pdf-reading': 1280, cbz: 1280 } as const

/** Page height in CSS px for print PDFs: the printable height of the page at 800 CSS px across the printable width. */
export const PRINT_PAGE_HEIGHT = { a4: 1177, letter: 1067 } as const

/** The tallest part of a long image in CSS px, so that part * scale stays within the bitmap limit. */
export function longImagePartHeight(scale: 1 | 2): number {
  return Math.floor(MAX_LONG_IMAGE_PX / scale)
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
