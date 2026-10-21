import { nativeImage } from 'electron'
import type { ImageOps } from './image-ops'

/** `ImageOps` on Electron's `nativeImage`. Output is always PNG. */
export const electronImageOps: ImageOps = {
  async downscale(data, maxEdge) {
    let img = nativeImage.createFromBuffer(data)
    const { width, height } = img.getSize()
    const longEdge = Math.max(width, height)
    if (longEdge > maxEdge) {
      const scale = maxEdge / longEdge
      img = img.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'best' })
    }
    return { mime: 'image/png', data: img.toPNG() }
  },
  size(data) {
    return nativeImage.createFromBuffer(data).getSize()
  }
}
