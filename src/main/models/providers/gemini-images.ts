import type { ResolvedModel } from '../registry'
import { ProviderError } from './types'
import type { ImageEditRequest, ImageProvider, ImageRef, ImageRequest, ImageResult } from './types'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function toMime(m: unknown): ImageResult['mime'] {
  return m === 'image/jpeg' || m === 'image/webp' ? m : 'image/png'
}

function imageFrom(block: unknown): ImageResult | null {
  if (!isRecord(block) || typeof block.data !== 'string' || block.data === '') return null
  return { mime: toMime(block.mime_type), data: Buffer.from(block.data, 'base64') }
}

/** Extracts the generated image from an Interactions response: `output_image`, else the last image block in `steps[].content[]`. */
export function parseInteractionImage(json: unknown): ImageResult {
  if (isRecord(json)) {
    const direct = imageFrom(json.output_image)
    if (direct) return direct
    let last: ImageResult | null = null
    for (const step of Array.isArray(json.steps) ? json.steps : []) {
      if (!isRecord(step) || !Array.isArray(step.content)) continue
      for (const block of step.content) {
        if (isRecord(block) && block.type === 'image') last = imageFrom(block) ?? last
      }
    }
    if (last) return last
  }
  throw new ProviderError('bad_request', 'The image model returned no image')
}

const imageBlock = (ref: ImageRef) => ({ type: 'image', mime_type: ref.mime, data: ref.data.toString('base64') })

function isAbort(err: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (isRecord(err) && err.name === 'AbortError')
}

export class GeminiImageProvider implements ImageProvider {
  private readonly fetchImpl: typeof fetch

  constructor(
    private readonly r: ResolvedModel,
    fetchImpl?: typeof fetch
  ) {
    this.fetchImpl = fetchImpl ?? fetch
  }

  generate(req: ImageRequest): Promise<ImageResult> {
    return this.call(req, req.references)
  }

  edit(req: ImageEditRequest): Promise<ImageResult> {
    return this.call(req, [req.source, ...req.references])
  }

  private async call(req: ImageRequest, images: ImageRef[]): Promise<ImageResult> {
    const { r } = this
    const body = {
      ...r.model.params,
      model: r.model.modelId,
      input: [{ type: 'text', text: req.prompt }, ...images.map(imageBlock)],
      response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: req.aspect }
    }
    const url = `${r.endpoint.baseUrl.replace(/\/+$/, '')}/v1beta/interactions`
    let res: Response
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'x-goog-api-key': r.apiKey ?? '', 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: req.signal
      })
    } catch (err) {
      if (isAbort(err, req.signal)) throw err
      throw new ProviderError('network', err instanceof Error ? err.message : String(err))
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const kind = res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'rate_limit' : 'bad_request'
      throw new ProviderError(kind, `Gemini request failed (${res.status}): ${text}`)
    }
    try {
      return parseInteractionImage(await res.json())
    } catch (err) {
      if (isAbort(err, req.signal) || err instanceof ProviderError) throw err
      throw new ProviderError('bad_request', 'The image model returned an unreadable response')
    }
  }
}
