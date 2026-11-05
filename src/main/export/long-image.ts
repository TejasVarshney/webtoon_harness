// Joins the captured slices of a long image into one bitmap. Pure: bitmaps are plain BGRA bytes.

import { MAX_LONG_IMAGE_PX } from './slice-plan'

/** A raw bitmap: BGRA, `width * 4` bytes per row, top row first. */
export type Bitmap = { width: number; height: number; data: Buffer }

/** Stack bitmaps top to bottom. They must share a width, and the result may not exceed the part limit. */
export function stitchBitmaps(parts: Bitmap[]): Bitmap {
  const width = parts[0]?.width ?? 0
  let height = 0
  for (const part of parts) {
    if (part.width !== width) throw new Error('Long image parts must share a width')
    height += part.height
  }
  if (height > MAX_LONG_IMAGE_PX) throw new Error(`Long image part is over ${MAX_LONG_IMAGE_PX} px`)
  return { width, height, data: Buffer.concat(parts.map((part) => part.data)) }
}
