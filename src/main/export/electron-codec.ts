import { nativeImage, type NativeImage } from 'electron'
import type { ImageCodec } from './types'

/** JPEG quality for every export output. */
const JPEG_QUALITY = 90

/** A decoded image. `nativeImage` gives an empty image, not an error, for bytes it cannot read. */
function decode(img: Buffer): NativeImage {
  const decoded = nativeImage.createFromBuffer(img)
  if (decoded.isEmpty()) throw new Error('A captured slice could not be decoded')
  return decoded
}

/** `ImageCodec` on Electron's `nativeImage`. Bitmaps are BGRA, as `toBitmap` and `createFromBitmap` use them. */
export const electronCodec: ImageCodec = {
  toBitmap(png) {
    const img = decode(png)
    const { width, height } = img.getSize()
    return { width, height, data: img.toBitmap() }
  },
  encode(b, format) {
    const img = nativeImage.createFromBitmap(b.data, { width: b.width, height: b.height })
    return format === 'jpeg' ? img.toJPEG(JPEG_QUALITY) : img.toPNG()
  },
  size(img) {
    return decode(img).getSize()
  }
}
