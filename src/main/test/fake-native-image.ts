import { sniffImageMime, type NativeImageFactory, type NativeImageLike } from '../domain/image-ops'

/** Real magic bytes of each format, padded so they look like a file. */
export const WEBP_BYTES = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(16, 7)])
export const GIF_BYTES = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(16, 1)])
export const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16, 2)])

/**
 * Stands in for Electron's `nativeImage`, which decodes PNG and JPEG but returns an empty image for WebP
 * (verified on Electron 45). `decodable` decides which buffers it can read; a decoded image is 3000x1500, and
 * its encoders return readable markers (`PNG 1500x750`, `JPEG q85 1500x750`).
 */
export function fakeNativeImage(decodable: (data: Buffer) => boolean = decodesPngAndJpeg): NativeImageFactory & { resized: Array<{ width: number; height: number }> } {
  const resized: Array<{ width: number; height: number }> = []
  const image = (ok: boolean, width: number, height: number): NativeImageLike => ({
    isEmpty: () => !ok,
    getSize: () => (ok ? { width, height } : { width: 0, height: 0 }),
    resize: (o) => {
      resized.push({ width: o.width, height: o.height })
      return image(ok, o.width, o.height)
    },
    toPNG: () => (ok ? Buffer.from(`PNG ${width}x${height}`) : Buffer.alloc(0)),
    toJPEG: (quality) => (ok ? Buffer.from(`JPEG q${quality} ${width}x${height}`) : Buffer.alloc(0))
  })
  return { resized, createFromBuffer: (data: Buffer) => image(decodable(data), 3000, 1500) }
}

export function decodesPngAndJpeg(data: Buffer): boolean {
  const mime = sniffImageMime(data)
  return mime === 'image/png' || mime === 'image/jpeg'
}
