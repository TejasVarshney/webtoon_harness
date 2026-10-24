import fs from 'node:fs'
import { ImageUnavailableError } from '../models/providers/types'
import type { ProjectContext } from '../storage/project-store'
import { isNotFound } from '../storage/fs-errors'
import { PathEscapeError } from './errors'

/** Long-edge limit for images sent to a text/vision model. */
export const MAX_TEXT_MODEL_IMAGE_EDGE = 1568
/** Long-edge limit for reference images sent to an image model. */
export const MAX_REFERENCE_IMAGE_EDGE = 1536
/** JPEG quality for images sent to a text/vision model. */
export const TEXT_MODEL_JPEG_QUALITY = 85

export interface DownscaleOptions {
  /** Encoding of a decoded image. Default `png`. Bytes that cannot be decoded are passed through as they are. */
  format?: 'png' | 'jpeg'
}

/** Image resizing, behind an interface so tests need no Electron. */
export interface ImageOps {
  /**
   * Shrinks the image when its long edge exceeds `maxEdge` and re-encodes it. An image the decoder cannot read
   * (WebP on Electron's `nativeImage`) comes back unchanged with its sniffed MIME; bytes that are no image at all
   * throw `UnreadableImageError`. Never resolves to empty data.
   */
  downscale(data: Buffer, maxEdge: number, opts?: DownscaleOptions): Promise<{ mime: string; data: Buffer }>
  size(data: Buffer): { width: number; height: number }
}

/** The bytes are not a png, jpeg, webp or gif image. */
export class UnreadableImageError extends Error {
  constructor(message = 'Not a readable image: use png, jpg, webp or gif') {
    super(message)
    this.name = 'UnreadableImageError'
  }
}

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** The format the magic bytes name, or null when they name none of png, jpeg, webp and gif. */
export function sniffImageMime(data: Buffer): ImageMime | null {
  if (data.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  const gif = data.subarray(0, 6).toString('ascii')
  if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif'
  return null
}

/** The part of Electron's `NativeImage` the image ops use. */
export interface NativeImageLike {
  isEmpty(): boolean
  getSize(): { width: number; height: number }
  resize(options: { width: number; height: number; quality: 'best' }): NativeImageLike
  toPNG(): Buffer
  toJPEG(quality: number): Buffer
}

export interface NativeImageFactory {
  createFromBuffer(data: Buffer): NativeImageLike
}

/**
 * `ImageOps` on a `nativeImage`-like decoder (Electron's in production). Ruling F1: what the decoder cannot read
 * is passed through with the MIME its magic bytes name, so a WebP never reaches a model as empty data.
 */
export function createNativeImageOps(native: NativeImageFactory): ImageOps {
  return {
    async downscale(data, maxEdge, opts = {}) {
      let img = native.createFromBuffer(data)
      if (img.isEmpty()) return passThrough(data)
      const { width, height } = img.getSize()
      const longEdge = Math.max(width, height)
      if (longEdge > maxEdge) {
        const scale = maxEdge / longEdge
        img = img.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'best' })
      }
      const jpeg = opts.format === 'jpeg'
      const out = jpeg ? img.toJPEG(TEXT_MODEL_JPEG_QUALITY) : img.toPNG()
      if (out.length === 0) return passThrough(data)
      return { mime: jpeg ? 'image/jpeg' : 'image/png', data: out }
    },
    size(data) {
      return native.createFromBuffer(data).getSize()
    }
  }
}

/**
 * Only formats the decoder cannot read at all (WebP, GIF) pass through. A PNG or JPEG it fails on is corrupt or
 * truncated, and sending it on would earn a 400 on every turn (Ruling F7).
 */
function passThrough(data: Buffer): { mime: string; data: Buffer } {
  const mime = data.length > 0 ? sniffImageMime(data) : null
  if (mime === 'image/png' || mime === 'image/jpeg') throw new UnreadableImageError('The image is corrupt or truncated')
  if (mime === null) throw new UnreadableImageError()
  return { mime, data }
}

export interface IdentityImageOps extends ImageOps {
  /** Every `downscale` call, in order (`format` only when one was asked for). */
  calls: { maxEdge: number; bytes: number; format?: 'png' | 'jpeg' }[]
}

/** Test double: returns the input unchanged (mime sniffed from the bytes, png when unknown), reads PNG sizes, records calls. */
export function createIdentityImageOps(): IdentityImageOps {
  const calls: IdentityImageOps['calls'] = []
  return {
    calls,
    async downscale(data, maxEdge, opts = {}) {
      calls.push({ maxEdge, bytes: data.length, ...(opts.format ? { format: opts.format } : {}) })
      return { mime: sniffImageMime(data) ?? 'image/png', data }
    },
    size(data) {
      if (data.length >= 24 && data.subarray(0, 8).equals(PNG_SIGNATURE)) return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
      return { width: 0, height: 0 }
    }
  }
}

export const identityImageOps = createIdentityImageOps()

/** The image is permanently unusable rather than briefly unreadable: gone, not a file, outside the project. */
function isGone(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code: unknown }).code : undefined
  return isNotFound(error) || code === 'EISDIR' || error instanceof PathEscapeError
}

/**
 * Reads a project image (path validated by `resolveAsset`) and shrinks it for a text model (JPEG). Rejects with
 * `ImageUnavailableError` when the image is gone, outside the project, empty or undecodable, so a replayed history
 * that still names it can carry a note instead (C1). Other failures (a locked file, ...) propagate.
 */
export async function loadImageForTextModel(ctx: ProjectContext, imageOps: ImageOps, relPath: string): Promise<{ mime: string; base64: string }> {
  let data: Buffer
  try {
    data = await fs.promises.readFile(ctx.paths.resolveAsset(relPath))
  } catch (error) {
    if (isGone(error)) throw new ImageUnavailableError(relPath, error instanceof Error ? error.message : String(error))
    throw error
  }
  if (data.length === 0) throw new ImageUnavailableError(relPath, 'the file is empty')
  let out: { mime: string; data: Buffer }
  try {
    out = await imageOps.downscale(data, MAX_TEXT_MODEL_IMAGE_EDGE, { format: 'jpeg' })
  } catch (error) {
    if (error instanceof UnreadableImageError) throw new ImageUnavailableError(relPath, error.message)
    throw error
  }
  if (out.data.length === 0) throw new ImageUnavailableError(relPath, 'the image could not be decoded')
  return { mime: out.mime, base64: out.data.toString('base64') }
}
