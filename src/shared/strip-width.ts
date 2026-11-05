// The width the strip is laid out at, on screen and in an export. Pure.

/**
 * The strip's row width on screen, in CSS px: styles.css gives `.strip-row` and `.strip-gap` `min(100%, 440px)`, and
 * that 440 is the source of truth. The export lays the strip out at this width too, so lettering sized in `cqw`
 * (the row is the size container) and every fixed px value keep the proportions to the art they have on screen.
 */
export const STRIP_CSS_WIDTH = 440

/** How wide every export output is at scale 1 (Standard), in px. High doubles it. */
export const EXPORT_PX_WIDTH = 800

/**
 * Output px at scale 1 as CSS px of the export view, rounded down to a whole px: DevTools takes only whole viewport
 * heights, and rounding down keeps a page within its limit. 1280 px → 704 CSS px.
 */
export function cssFromPx(px: number): number {
  return Math.floor((px * STRIP_CSS_WIDTH) / EXPORT_PX_WIDTH)
}

/** Device px per CSS px when capturing at `scale`: 800 / 440 at Standard, twice that at High. */
export function captureScaleFactor(scale: 1 | 2): number {
  return (EXPORT_PX_WIDTH / STRIP_CSS_WIDTH) * scale
}
