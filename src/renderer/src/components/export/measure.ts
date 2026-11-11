import type { ViewLayout } from '@shared/types'

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))

/** An image that already failed before anyone waited on it. */
const failedAlready = (img: HTMLImageElement): boolean => img.complete && img.naturalWidth === 0

function decodeFailure(img: HTMLImageElement): Error {
  const position = img.closest('[data-position]')?.getAttribute('data-position') ?? '?'
  return new Error(`Panel ${position}: the image could not be loaded`)
}

/**
 * Waits until what `root` holds is painted, then measures it: fonts ready, every image decoded (the first failure
 * rejects, naming its panel by `data-position`), two animation frames, then the document top (rounded down) and
 * bottom (rounded up) in CSS px of each band of panels (panels that overlap vertically are one band, so a cut
 * between bands never goes through a panel), and the bottom of `root` itself, rounded up; `root` is then padded to
 * that height. `root` must be as tall as its content, and its bottom is the strip's bottom: the canvas ends at the
 * lowest finished panel (export.css). Call after React has committed.
 */
export async function waitForPaintAndMeasure(root: HTMLElement): Promise<ViewLayout> {
  // A new face starts loading only once layout asks for it, so without this `ready` can resolve before it has begun.
  void root.offsetHeight
  await document.fonts?.ready
  const images = [...root.querySelectorAll('img')]
  await Promise.all(
    images.map(async (img) => {
      if (failedAlready(img)) throw decodeFailure(img)
      try {
        await img.decode?.()
      } catch {
        throw decodeFailure(img)
      }
    })
  )
  await frame()
  await frame()
  // The real fractional positions (offsetTop and offsetHeight come pre-rounded to the nearest pixel), made
  // document-relative. Bands are merged on the exact values, then each starts on the pixel its top falls in and ends
  // on the pixel past its bottom.
  const scrollY = window.scrollY
  const cards = [...root.querySelectorAll<HTMLElement>('.panel-card')]
    .map((card) => {
      const r = card.getBoundingClientRect()
      return { top: r.top + scrollY, bottom: r.bottom + scrollY }
    })
    .sort((a, b) => a.top - b.top)
  const bands: { top: number; bottom: number }[] = []
  for (const card of cards) {
    const last = bands[bands.length - 1]
    if (last !== undefined && card.top < last.bottom) last.bottom = Math.max(last.bottom, card.bottom)
    else bands.push({ ...card })
  }
  const rows = bands.map((band) => ({ top: Math.floor(band.top), bottom: Math.ceil(band.bottom) }))
  // The strip's own bottom: a short strip leaves the document as tall as the viewport, which would add blank space.
  const totalHeight = Math.ceil(root.getBoundingClientRect().bottom + scrollY)
  // Pad the page up to that whole pixel. Otherwise it ends a fraction short, and Chromium stops the scroll to the
  // last slice (whose top is totalHeight minus its height) a pixel early.
  root.style.minHeight = `${totalHeight}px`
  return { totalHeight, rows }
}
