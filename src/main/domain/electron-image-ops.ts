import { nativeImage } from 'electron'
import { createNativeImageOps, type ImageOps } from './image-ops'

/** `ImageOps` on Electron's `nativeImage`, which cannot decode WebP: such images pass through unchanged (Ruling F1). */
export const electronImageOps: ImageOps = createNativeImageOps(nativeImage)
