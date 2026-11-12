import type { CropArea } from '@shared/types'

/** A crop box in the image's own pixels. */
export interface CropBox {
  x: number
  y: number
  width: number
  height: number
}

export type CropCorner = 'nw' | 'ne' | 'sw' | 'se'

export interface ImageSize {
  width: number
  height: number
}

/** The smallest a box may get, as a share of the image's shorter side, so a handle is never lost under the other. */
const MIN_SHARE = 0.08

/** The largest box of width / height `ratio`, centred on the image: where a crop starts. */
export function fitBox(image: ImageSize, ratio: number): CropBox {
  const width = Math.min(image.width, image.height * ratio)
  const height = width / ratio
  return { x: (image.width - width) / 2, y: (image.height - height) / 2, width, height }
}

/** The box moved by (dx, dy) image pixels, kept inside the image. */
export function moveBox(box: CropBox, dx: number, dy: number, image: ImageSize): CropBox {
  return {
    ...box,
    x: Math.min(image.width - box.width, Math.max(0, box.x + dx)),
    y: Math.min(image.height - box.height, Math.max(0, box.y + dy))
  }
}

/**
 * The box with `corner` dragged by (dx, dy) image pixels, keeping its ratio: the opposite corner stays put, the box
 * follows whichever way the pointer moved further (a drag straight across resizes it too), and it stays inside the
 * image and no smaller than the minimum.
 */
export function resizeBox(box: CropBox, corner: CropCorner, dx: number, dy: number, image: ImageSize, ratio: number): CropBox {
  const west = corner === 'nw' || corner === 'sw'
  const north = corner === 'nw' || corner === 'ne'
  const anchorX = west ? box.x + box.width : box.x
  const anchorY = north ? box.y + box.height : box.y
  const pointerX = (west ? box.x : box.x + box.width) + dx
  const pointerY = (north ? box.y : box.y + box.height) + dy
  // The width each way of the pointer asks for; the one that changed more is the way the user dragged.
  const across = west ? anchorX - pointerX : pointerX - anchorX
  const down = (north ? anchorY - pointerY : pointerY - anchorY) * ratio
  const wanted = Math.abs(across - box.width) >= Math.abs(down - box.width) ? across : down
  const roomX = west ? anchorX : image.width - anchorX
  const roomY = (north ? anchorY : image.height - anchorY) * ratio
  const least = Math.min(Math.min(image.width, image.height) * MIN_SHARE, roomX, roomY)
  const width = Math.max(least, Math.min(wanted, roomX, roomY))
  const height = width / ratio
  return { x: west ? anchorX - width : anchorX, y: north ? anchorY - height : anchorY, width, height }
}

/** The box as fractions of the image, as `panels:crop` takes it. */
export function boxArea(box: CropBox, image: ImageSize): CropArea {
  const clamp = (v: number): number => Math.min(1, Math.max(0, v))
  const x = clamp(box.x / image.width)
  const y = clamp(box.y / image.height)
  return { x, y, width: Math.min(1 - x, box.width / image.width), height: Math.min(1 - y, box.height / image.height) }
}

/** Whether the box is the whole image, give or take half a pixel: cropping to it would change nothing. */
export function isWholeImage(box: CropBox, image: ImageSize): boolean {
  return box.x <= 0.5 && box.y <= 0.5 && box.width >= image.width - 0.5 && box.height >= image.height - 0.5
}
