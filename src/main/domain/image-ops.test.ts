import fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { encodeSolidPng } from '../models/providers/png'
import { ImageUnavailableError } from '../models/providers/types'
import { fakeNativeImage, GIF_BYTES, JPEG_BYTES, WEBP_BYTES } from '../test/fake-native-image'
import { tempProject, type TempProject } from '../test/temp-project'
import {
  createIdentityImageOps,
  createNativeImageOps,
  loadImageForTextModel,
  MAX_TEXT_MODEL_IMAGE_EDGE,
  sniffImageMime,
  UnreadableImageError
} from './image-ops'

let tp: TempProject | undefined
afterEach(async () => {
  await tp?.cleanup()
  tp = undefined
})

const WEBP = WEBP_BYTES
const GIF = GIF_BYTES
const JPEG = JPEG_BYTES

describe('sniffImageMime', () => {
  it('recognises png, jpeg, webp and gif and nothing else', () => {
    expect(sniffImageMime(encodeSolidPng(1, 1, [0, 0, 0]))).toBe('image/png')
    expect(sniffImageMime(JPEG)).toBe('image/jpeg')
    expect(sniffImageMime(WEBP)).toBe('image/webp')
    expect(sniffImageMime(GIF)).toBe('image/gif')
    expect(sniffImageMime(Buffer.from('not an image at all'))).toBeNull()
    expect(sniffImageMime(Buffer.alloc(0))).toBeNull()
  })
})

describe('createNativeImageOps (Ruling F1)', () => {
  it('downscales a decodable image and encodes PNG by default, JPEG on request', async () => {
    const native = fakeNativeImage()
    const ops = createNativeImageOps(native)
    const png = await ops.downscale(JPEG, 1500)
    expect(native.resized).toEqual([{ width: 1500, height: 750 }])
    expect(png).toEqual({ mime: 'image/png', data: Buffer.from('PNG 1500x750') })
    const jpeg = await ops.downscale(JPEG, 1500, { format: 'jpeg' })
    expect(jpeg).toEqual({ mime: 'image/jpeg', data: Buffer.from('JPEG q85 1500x750') })
  })

  it('passes WebP it cannot decode through unchanged, with its sniffed MIME (never empty data)', async () => {
    const ops = createNativeImageOps(fakeNativeImage())
    expect(await ops.downscale(WEBP, 1568, { format: 'jpeg' })).toEqual({ mime: 'image/webp', data: WEBP })
    expect(await ops.downscale(GIF, 1536)).toEqual({ mime: 'image/gif', data: GIF })
  })

  it('rejects a corrupt PNG or JPEG the decoder cannot read instead of passing it through (Ruling F7)', async () => {
    const ops = createNativeImageOps(fakeNativeImage(() => false))
    await expect(ops.downscale(JPEG, 1568, { format: 'jpeg' })).rejects.toThrow('The image is corrupt or truncated')
    await expect(ops.downscale(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]), 1536)).rejects.toBeInstanceOf(UnreadableImageError)
  })

  it('throws a clear error for bytes that are no image at all', async () => {
    const ops = createNativeImageOps(fakeNativeImage())
    await expect(ops.downscale(Buffer.from('garbage bytes here'), 1568)).rejects.toBeInstanceOf(UnreadableImageError)
    await expect(ops.downscale(Buffer.alloc(0), 1568)).rejects.toThrow(/not a readable image/i)
  })
})

describe('loadImageForTextModel', () => {
  it('downscales attachments for text models and asks for JPEG', async () => {
    tp = await tempProject()
    const png = encodeSolidPng(4, 2, [1, 2, 3])
    await fs.promises.writeFile(tp.ctx.paths.resolveAsset('uploads/a b.png'), png)
    const ops = createIdentityImageOps()
    const out = await loadImageForTextModel(tp.ctx, ops, 'uploads/a b.png')
    expect(MAX_TEXT_MODEL_IMAGE_EDGE).toBe(1568)
    expect(ops.calls).toEqual([{ maxEdge: 1568, bytes: png.length, format: 'jpeg' }])
    expect(out).toEqual({ mime: 'image/png', base64: png.toString('base64') })
  })

  it('sends an undecodable WebP as the original bytes', async () => {
    tp = await tempProject()
    await fs.promises.writeFile(tp.ctx.paths.resolveAsset('uploads/w.webp'), WEBP)
    const out = await loadImageForTextModel(tp.ctx, createNativeImageOps(fakeNativeImage()), 'uploads/w.webp')
    expect(out).toEqual({ mime: 'image/webp', base64: WEBP.toString('base64') })
  })

  it('reports a missing, empty, undecodable or escaping image as ImageUnavailableError', async () => {
    tp = await tempProject()
    const ops = createNativeImageOps(fakeNativeImage())
    await fs.promises.writeFile(tp.ctx.paths.resolveAsset('uploads/empty.png'), Buffer.alloc(0))
    await fs.promises.writeFile(tp.ctx.paths.resolveAsset('uploads/junk.png'), Buffer.from('this is not an image'))
    for (const rel of ['uploads/gone.png', 'uploads/gone.png/inner.png', 'uploads/empty.png', 'uploads/junk.png', '../x.png', 'uploads']) {
      const error = await loadImageForTextModel(tp.ctx, ops, rel).catch((e: unknown) => e)
      expect(error, rel).toBeInstanceOf(ImageUnavailableError)
      expect((error as ImageUnavailableError).relPath, rel).toBe(rel)
    }
  })

  it('lets other read errors through', async () => {
    tp = await tempProject()
    await fs.promises.writeFile(tp.ctx.paths.resolveAsset('uploads/a.png'), encodeSolidPng(1, 1, [0, 0, 0]))
    const failing = { ...createIdentityImageOps(), downscale: () => Promise.reject(new Error('EBUSY: resource busy')) }
    await expect(loadImageForTextModel(tp.ctx, failing, 'uploads/a.png')).rejects.toThrow('EBUSY')
  })

  it('identity size reads PNG dimensions', () => {
    expect(createIdentityImageOps().size(encodeSolidPng(5, 7, [0, 0, 0]))).toEqual({ width: 5, height: 7 })
    expect(createIdentityImageOps().size(Buffer.from('nope'))).toEqual({ width: 0, height: 0 })
  })
})
