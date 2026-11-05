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
 * rejects, naming its panel by `data-position`), two animation frames, then each `.strip-band`'s top and bottom in
 * CSS px, rounded up, and the document's height. Call after React has committed.
 */
export async function waitForPaintAndMeasure(root: HTMLElement): Promise<ViewLayout> {
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
  const rows = [...root.querySelectorAll<HTMLElement>('.strip-band')].map((band) => ({
    top: Math.ceil(band.offsetTop),
    bottom: Math.ceil(band.offsetTop + band.offsetHeight)
  }))
  return { totalHeight: Math.ceil(document.documentElement.scrollHeight), rows }
}
