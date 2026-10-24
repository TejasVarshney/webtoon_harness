import fs from 'node:fs'
import type { PanelAspect } from '@shared/types'
import { createImageProvider as defaultCreateImageProvider } from '../models/providers/factory'
import { ProviderError } from '../models/providers/types'
import type { ImageProvider, ImageRef } from '../models/providers/types'
import type { ModelRegistry } from '../models/registry'
import type { ProjectContext } from '../storage/project-store'
import { MAX_REFERENCE_IMAGE_EDGE, UnreadableImageError, type ImageOps } from './image-ops'

export const IMAGE_TIMEOUT_MS = 180_000

export interface ImageReferenceInput {
  relPath: string
  label: string
}

export interface ImageGenRequest {
  prompt: string
  references: ImageReferenceInput[]
  aspect: PanelAspect
  signal?: AbortSignal
}

export interface ImageGenResult {
  data: Buffer
  ext: 'png' | 'jpg' | 'webp'
}

export interface ImageServiceOptions {
  registry: ModelRegistry
  imageOps: ImageOps
  createImageProvider?: typeof defaultCreateImageProvider
  /** Test seam; production uses 180 s. */
  timeoutMs?: number
}

const EXT: Record<string, ImageGenResult['ext']> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

/** Loads references from the project, calls the image model for a role, and tells a timeout apart from a caller abort. */
export class ImageService {
  private readonly create: typeof defaultCreateImageProvider
  private readonly timeoutMs: number

  constructor(private readonly opts: ImageServiceOptions) {
    this.create = opts.createImageProvider ?? defaultCreateImageProvider
    this.timeoutMs = opts.timeoutMs ?? IMAGE_TIMEOUT_MS
  }

  maxReferences(role: 'image' | 'imageEdit'): number {
    return this.opts.registry.resolve(role).model.maxReferenceImages
  }

  generate(ctx: ProjectContext, req: ImageGenRequest): Promise<ImageGenResult> {
    return this.run(ctx, 'image', req, (provider, refs, signal) => provider.generate({ prompt: req.prompt, references: refs, aspect: req.aspect, signal }))
  }

  edit(ctx: ProjectContext, req: ImageGenRequest & { sourceRelPath: string }): Promise<ImageGenResult> {
    return this.run(ctx, 'imageEdit', req, async (provider, refs, signal) => {
      const source = await this.load(ctx, { relPath: req.sourceRelPath, label: 'source' })
      return provider.edit({ prompt: req.prompt, references: refs, source, aspect: req.aspect, signal })
    })
  }

  private async run(
    ctx: ProjectContext,
    role: 'image' | 'imageEdit',
    req: ImageGenRequest,
    call: (provider: ImageProvider, refs: ImageRef[], signal: AbortSignal) => Promise<{ mime: string; data: Buffer }>
  ): Promise<ImageGenResult> {
    const provider = this.create(this.opts.registry.resolve(role))
    const refs: ImageRef[] = []
    for (const r of req.references) refs.push(await this.load(ctx, r))
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout
    try {
      const out = await call(provider, refs, signal)
      return { data: out.data, ext: EXT[out.mime] ?? 'png' }
    } catch (err) {
      if (timeout.aborted && !req.signal?.aborted) throw new ProviderError('timeout', 'Image generation timed out after 180s')
      throw err
    }
  }

  /** Callers turn a rejection into a failed variation or version (their never-throw contracts). */
  private async load(ctx: ProjectContext, ref: ImageReferenceInput): Promise<ImageRef> {
    const raw = await fs.promises.readFile(ctx.paths.resolveAsset(ref.relPath))
    let out: { mime: string; data: Buffer }
    try {
      out = await this.opts.imageOps.downscale(raw, MAX_REFERENCE_IMAGE_EDGE)
    } catch (error) {
      if (error instanceof UnreadableImageError) throw new UnreadableImageError(`Reference image ${ref.relPath} is not a readable image (png, jpg, webp or gif)`)
      throw error
    }
    return { mime: out.mime as ImageRef['mime'], data: out.data, label: ref.label }
  }
}
