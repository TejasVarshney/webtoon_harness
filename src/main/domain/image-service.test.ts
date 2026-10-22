import fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { createIdentityImageOps, createNativeImageOps, type ImageOps } from './image-ops'
import { ImageService } from './image-service'
import type { ImageEditRequest, ImageProvider, ImageRequest } from '../models/providers/types'
import { encodeSolidPng } from '../models/providers/png'
import { fakeNativeImage, WEBP_BYTES } from '../test/fake-native-image'
import { tempProject } from '../test/temp-project'
import type { ModelRegistry } from '../models/registry'

const png = encodeSolidPng(2, 2, [1, 2, 3])

async function setup(provider: Partial<ImageProvider>, timeoutMs?: number, ops?: ImageOps) {
  const tp = await tempProject()
  await fs.promises.mkdir(tp.ctx.paths.uploadsDir(), { recursive: true })
  await fs.promises.writeFile(tp.ctx.paths.resolveAsset('uploads/a.png'), png)
  const identity = createIdentityImageOps()
  const imageOps = ops ?? identity
  const seen: { req?: ImageRequest | ImageEditRequest; fn?: string } = {}
  const roles: string[] = []
  const registry = {
    resolve: (role: string) => {
      roles.push(role)
      return { endpoint: { kind: 'mock' }, model: { maxReferenceImages: role === 'imageEdit' ? 3 : 5 }, apiKey: null }
    }
  } as unknown as ModelRegistry
  const svc = new ImageService({
    registry,
    imageOps,
    timeoutMs,
    createImageProvider: () => ({
      generate: async (req) => { seen.req = req; seen.fn = 'generate'; return provider.generate!(req) },
      edit: async (req) => { seen.req = req; seen.fn = 'edit'; return provider.edit!(req) }
    })
  })
  return { tp, svc, imageOps: identity, seen, roles }
}

const ok = async () => ({ mime: 'image/jpeg' as const, data: Buffer.from('out') })
const never = (req: ImageRequest) => new Promise<never>((_, rej) => req.signal.addEventListener('abort', () => rej(req.signal.reason)))
let cleanup: (() => Promise<void>) | null = null
afterEach(async () => { await cleanup?.(); cleanup = null })

describe('ImageService', () => {
  it('generate: image role, downscale, labels, ext from mime', async () => {
    const { tp, svc, imageOps, seen, roles } = await setup({ generate: ok })
    cleanup = tp.cleanup
    const out = await svc.generate(tp.ctx, { prompt: 'p', references: [{ relPath: 'uploads/a.png', label: 'Mina' }], aspect: '2:3' })
    expect(out.ext).toBe('jpg')
    expect(roles).toContain('image')
    expect(imageOps.calls.map((c) => c.maxEdge)).toContain(1536)
    expect(seen.req!.references[0].label).toBe('Mina')
    expect(seen.req!.references[0].mime).toBe('image/png')
  })

  it('edit: imageEdit role with source first', async () => {
    const { tp, svc, seen, roles } = await setup({ edit: ok })
    cleanup = tp.cleanup
    await svc.edit(tp.ctx, { prompt: 'p', references: [], aspect: '1:1', sourceRelPath: 'uploads/a.png' })
    expect(roles).toEqual(['imageEdit'])
    expect(seen.fn).toBe('edit')
    expect((seen.req as ImageEditRequest).source.data.equals(png)).toBe(true)
    expect(svc.maxReferences('imageEdit')).toBe(3)
    expect(svc.maxReferences('image')).toBe(5)
  })

  it('passes a WebP reference the decoder cannot read through with its MIME (Ruling F1)', async () => {
    const { tp, svc, seen } = await setup({ generate: ok }, undefined, createNativeImageOps(fakeNativeImage()))
    cleanup = tp.cleanup
    await fs.promises.writeFile(tp.ctx.paths.resolveAsset('uploads/w.webp'), WEBP_BYTES)
    await svc.generate(tp.ctx, { prompt: 'p', references: [{ relPath: 'uploads/w.webp', label: 'Mina' }], aspect: '2:3' })
    expect(seen.req!.references[0]).toMatchObject({ mime: 'image/webp', label: 'Mina' })
    expect(seen.req!.references[0].data.equals(WEBP_BYTES)).toBe(true)
  })

  it('rejects a reference that is no image with an error naming it, before calling the model', async () => {
    const { tp, svc, seen } = await setup({ generate: ok }, undefined, createNativeImageOps(fakeNativeImage()))
    cleanup = tp.cleanup
    await fs.promises.writeFile(tp.ctx.paths.resolveAsset('uploads/junk.webp'), Buffer.from('not an image'))
    await expect(svc.generate(tp.ctx, { prompt: 'p', references: [{ relPath: 'uploads/junk.webp', label: 'x' }], aspect: '1:1' })).rejects.toThrow(
      'Reference image uploads/junk.webp is not a readable image (png, jpg, webp or gif)'
    )
    expect(seen.fn).toBeUndefined()
  })

  it('rejects path escapes', async () => {
    const { tp, svc } = await setup({ generate: ok })
    cleanup = tp.cleanup
    await expect(svc.generate(tp.ctx, { prompt: 'p', references: [{ relPath: '../../x.png', label: 'x' }], aspect: '1:1' })).rejects.toThrow()
  })

  it('timeout becomes ProviderError timeout', async () => {
    const { tp, svc } = await setup({ generate: never }, 30)
    cleanup = tp.cleanup
    await expect(svc.generate(tp.ctx, { prompt: 'p', references: [], aspect: '1:1' })).rejects.toMatchObject({
      name: 'ProviderError', kind: 'timeout', message: 'Image generation timed out after 180s'
    })
  })

  it('caller abort propagates as AbortError, not timeout', async () => {
    const { tp, svc } = await setup({ generate: never }, 5000)
    cleanup = tp.cleanup
    const ac = new AbortController()
    const p = svc.generate(tp.ctx, { prompt: 'p', references: [], aspect: '1:1', signal: ac.signal })
    setTimeout(() => ac.abort(), 10)
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })
})
