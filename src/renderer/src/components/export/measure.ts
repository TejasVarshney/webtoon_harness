import type { ViewLayout } from '@shared/types'

const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))

/** An image that already failed before anyone waited on it. */
const failedAlready = (img: HTMLImageElement): boolean => img.complete && img.naturalWidth === 0

function decodeFailure(img: HTMLImageElement): Error {
  const position = img.closest('[data-position]')?.getAttribute('data-position') ?? '?'
  return new Error(`Panel ${position}: the image could not be loaded`)
}

/** The URLs a canvas's CSS background draws, in order. */
function backgroundUrls(canvas: HTMLElement): string[] {
  return [...canvas.style.backgroundImage.matchAll(/url\("([^"]*)"\)/g)].map((m) => m[1])
}

/** Decodes the canvas's background image, so it is painted when measured. A missing or broken file rejects. */
async function decodeBackground(root: HTMLElement): Promise<void> {
  const canvas = root.querySelector<HTMLElement>('.strip-canvas')
  if (canvas === null) return
  await Promise.all(
    backgroundUrls(canvas).map(async (url) => {
      const img = new Image()
      img.src = url
      try {
        await img.decode()
      } catch {
        throw new Error('The background image could not be loaded')
      }
    })
  )
}

/**
 * Waits until what `root` holds is painted, then measures it: fonts ready, every image decoded (the first failure
 * rejects, naming its panel by `data-position`), a background image decoded too (a failure rejects, naming the
 * background), two animation frames, then the document top (rounded down) and bottom (rounded up) in CSS px of each
 * band of panels and bubbles (those that overlap vertically are one band, a bubble clipped to the strip, so a cut
 * between bands goes through neither; a band taller than the page is still cut inside), and the bottom of `root`
 * itself, rounded up; `root` is then padded to that height. `root` must be as tall as its content, and its bottom is the strip's bottom: the canvas ends at the
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
  await decodeBackground(root)
  await frame()
  await frame()
  // The real fractional positions (offsetTop and offsetHeight come pre-rounded to the nearest pixel), made
  // document-relative. Bands are merged on the exact values, then each starts on the pixel its top falls in and ends
  // on the pixel past its bottom.
  const scrollY = window.scrollY
  // The strip's own bottom: a short strip leaves the document as tall as the viewport, which would add blank space.
  const totalHeight = Math.ceil(root.getBoundingClientRect().bottom + scrollY)
  const spans = [...root.querySelectorAll<HTMLElement>('.panel-card, .strip-bubbles .bubble, .strip-bubbles .bubble-tail')]
    .map((el) => {
      const r = el.getBoundingClientRect()
      // What hangs past the strip is cut off, so it must not reach into a band, or past the page.
      return { top: Math.max(0, r.top + scrollY), bottom: Math.min(totalHeight, r.bottom + scrollY) }
    })
    .filter((span) => span.bottom > span.top)
    .sort((a, b) => a.top - b.top)
  const bands: { top: number; bottom: number }[] = []
  for (const span of spans) {
    const last = bands[bands.length - 1]
    if (last !== undefined && span.top < last.bottom) last.bottom = Math.max(last.bottom, span.bottom)
    else bands.push({ ...span })
  }
  const rows = bands.map((band) => ({ top: Math.floor(band.top), bottom: Math.ceil(band.bottom) }))
  // Pad the page up to that whole pixel. Otherwise it ends a fraction short, and Chromium stops the scroll to the
  // last slice (whose top is totalHeight minus its height) a pixel early.
  root.style.minHeight = `${totalHeight}px`
  return { totalHeight, rows }
}
