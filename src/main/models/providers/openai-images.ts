import OpenAI, { toFile } from 'openai'
import type { PanelAspect } from '@shared/types'
import type { ResolvedModel } from '../registry'
import { ProviderError } from './types'
import type { ImageEditRequest, ImageProvider, ImageRef, ImageRequest, ImageResult } from './types'

const MAX_REFERENCES = 16

export type OpenAISize = '1024x1024' | '1024x1536' | '1536x1024'

export function aspectToOpenAISize(aspect: PanelAspect): OpenAISize {
  switch (aspect) {
    case '1:1':
      return '1024x1024'
    case '2:3':
    case '3:4':
    case '9:16':
      return '1024x1536'
    case '4:3':
    case '16:9':
      return '1536x1024'
  }
}

interface ImagesResponse {
  data?: Array<{ b64_json?: string | null }>
}

/** The slice of the OpenAI SDK this adapter uses; params are loosely typed so model params can be spread in. */
export interface OpenAIImagesClientLike {
  images: {
    generate(params: Record<string, unknown>, opts: { signal: AbortSignal }): PromiseLike<ImagesResponse>
    edit(params: Record<string, unknown>, opts: { signal: AbortSignal }): PromiseLike<ImagesResponse>
  }
}

const MIME_BY_FORMAT: Record<string, ImageResult['mime']> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }
const EXT_BY_MIME: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

function isAbort(err: unknown, signal: AbortSignal): boolean {
  return signal.aborted || err instanceof OpenAI.APIUserAbortError || (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError')
}

function mapError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof OpenAI.APIConnectionTimeoutError) return new ProviderError('timeout', message)
  if (err instanceof OpenAI.AuthenticationError || err instanceof OpenAI.PermissionDeniedError) return new ProviderError('auth', message)
  if (err instanceof OpenAI.RateLimitError) return new ProviderError('rate_limit', message)
  if (err instanceof OpenAI.BadRequestError) return new ProviderError('bad_request', message)
  if (err instanceof OpenAI.APIConnectionError) return new ProviderError('network', message)
  return new ProviderError('unknown', message)
}

export class OpenAIImageProvider implements ImageProvider {
  private readonly client: OpenAIImagesClientLike

  constructor(
    private readonly r: ResolvedModel,
    client?: OpenAIImagesClientLike
  ) {
    this.client = client ?? (new OpenAI({ apiKey: r.apiKey ?? 'not-needed', baseURL: r.endpoint.baseUrl }) as unknown as OpenAIImagesClientLike)
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    const refs = req.references.slice(0, MAX_REFERENCES)
    const size = aspectToOpenAISize(req.aspect)
    const params = this.r.model.params
    const model = this.r.model.modelId
    if (refs.length === 0) {
      return this.run(req.signal, () => this.client.images.generate({ ...params, model, prompt: req.prompt, size, n: 1 }, { signal: req.signal }))
    }
    return this.run(req.signal, async () =>
      this.client.images.edit({ ...params, model, prompt: req.prompt, size, image: await this.files(refs, 'reference') }, { signal: req.signal })
    )
  }

  async edit(req: ImageEditRequest): Promise<ImageResult> {
    const refs = req.references.slice(0, MAX_REFERENCES - 1)
    const params = this.r.model.params
    const model = this.r.model.modelId
    return this.run(req.signal, async () =>
      this.client.images.edit(
        {
          ...params,
          model,
          prompt: req.prompt,
          size: aspectToOpenAISize(req.aspect),
          image: [...(await this.files([req.source], 'source')), ...(await this.files(refs, 'reference'))]
        },
        { signal: req.signal }
      )
    )
  }

  private files(refs: ImageRef[], stem: string): Promise<Awaited<ReturnType<typeof toFile>>[]> {
    return Promise.all(refs.map((ref, i) => toFile(ref.data, `${stem}-${i}.${EXT_BY_MIME[ref.mime] ?? 'png'}`, { type: ref.mime })))
  }

  private async run(signal: AbortSignal, call: () => PromiseLike<ImagesResponse>): Promise<ImageResult> {
    let res: ImagesResponse
    try {
      res = await call()
    } catch (err) {
      if (isAbort(err, signal)) throw err
      throw mapError(err)
    }
    const b64 = res.data?.[0]?.b64_json
    if (!b64) throw new ProviderError('bad_request', 'The image model returned no image')
    const format = this.r.model.params.output_format
    const mime = (typeof format === 'string' ? MIME_BY_FORMAT[format] : undefined) ?? 'image/png'
    return { mime, data: Buffer.from(b64, 'base64') }
  }
}
