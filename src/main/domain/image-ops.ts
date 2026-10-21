import fs from 'node:fs'
import type { ProjectContext } from '../storage/project-store'

/** Long-edge limit for images sent to a text/vision model. */
export const MAX_TEXT_MODEL_IMAGE_EDGE = 1568
/** Long-edge limit for reference images sent to an image model. */
export const MAX_REFERENCE_IMAGE_EDGE = 1536

/** Image resizing, behind an interface so tests need no Electron. */
export interface ImageOps {
  /** Shrinks the image when its long edge exceeds `maxEdge`; otherwise returns it unchanged. */
  downscale(data: Buffer, maxEdge: number): Promise<{ mime: string; data: Buffer }>
  size(data: Buffer): { width: number; height: number }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function sniffMime(data: Buffer): string {
  if (data.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png'
  if (data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg'
  if (data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return 'image/png'
}

export interface IdentityImageOps extends ImageOps {
  /** Every `downscale` call, in order. */
  calls: { maxEdge: number; bytes: number }[]
}

/** Test double: returns the input unchanged (mime sniffed from the bytes), reads PNG sizes, records calls. */
export function createIdentityImageOps(): IdentityImageOps {
  const calls: IdentityImageOps['calls'] = []
  return {
    calls,
    async downscale(data, maxEdge) {
      calls.push({ maxEdge, bytes: data.length })
      return { mime: sniffMime(data), data }
    },
    size(data) {
      if (data.length >= 24 && data.subarray(0, 8).equals(PNG_SIGNATURE)) return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
      return { width: 0, height: 0 }
    }
  }
}

export const identityImageOps = createIdentityImageOps()

/** Reads a project image (path validated by `resolveAsset`) and shrinks it for a text model. */
export async function loadImageForTextModel(ctx: ProjectContext, imageOps: ImageOps, relPath: string): Promise<{ mime: string; base64: string }> {
  const data = await fs.promises.readFile(ctx.paths.resolveAsset(relPath))
  const out = await imageOps.downscale(data, MAX_TEXT_MODEL_IMAGE_EDGE)
  return { mime: out.mime, base64: out.data.toString('base64') }
}
