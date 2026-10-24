import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { ResolvedModel } from '../registry'
import { GeminiImageProvider, parseInteractionImage } from './gemini-images'
import type { ImageRef } from './types'

const fixture = (n: string): unknown => JSON.parse(fs.readFileSync(`tests/fixtures/${n}`, 'utf8'))

function resolved(params: Record<string, unknown> = {}): ResolvedModel {
  return {
    endpoint: { id: 'end_0000000002', name: 'Gemini', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', options: {} },
    model: { id: 'mdl_0000000002', endpointId: 'end_0000000002', modelId: 'gemini-3.1-flash-image', label: 'g', capabilities: ['image-gen', 'image-edit'], params, maxReferenceImages: 14 },
    apiKey: 'k'
  } as ResolvedModel
}
const ref = (label: string): ImageRef => ({ mime: 'image/png', data: Buffer.from(label), label })
const signal = new AbortController().signal
const okFetch = () => vi.fn(async (_u: unknown, _i: unknown) => new Response(JSON.stringify(fixture('gemini-interaction-image.json')), { status: 200 }))

describe('GeminiImageProvider', () => {
  it('sends the Interactions request shape', async () => {
    const fetchImpl = okFetch()
    const g = new GeminiImageProvider(resolved({ generation_config: { thinking_level: 'low' } }), fetchImpl as unknown as typeof fetch)
    const out = await g.generate({ prompt: 'p', references: [ref('a')], aspect: '9:16', signal })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string>; body: string }]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions')
    expect(init.headers['x-goog-api-key']).toBe('k')
    expect(init.headers['content-type']).toBe('application/json')
    expect(JSON.parse(init.body)).toMatchObject({
      model: 'gemini-3.1-flash-image',
      input: [{ type: 'text', text: 'p' }, { type: 'image', mime_type: 'image/png', data: Buffer.from('a').toString('base64') }],
      response_format: { type: 'image', mime_type: 'image/png', aspect_ratio: '9:16' },
      generation_config: { thinking_level: 'low' }
    })
    expect(out.mime).toBe('image/png')
    expect(out.data.subarray(1, 4).toString()).toBe('PNG')
  })

  it('edit sends the source as the first image block', async () => {
    const fetchImpl = okFetch()
    const g = new GeminiImageProvider(resolved(), fetchImpl as unknown as typeof fetch)
    await g.edit({ prompt: 'edit it', source: ref('src'), references: [ref('r')], aspect: '1:1', signal })
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body)
    expect(body.input[0]).toEqual({ type: 'text', text: 'edit it' })
    expect(body.input[1].data).toBe(Buffer.from('src').toString('base64'))
    expect(body.input).toHaveLength(3)
  })

  it('maps HTTP errors', async () => {
    const mk = (status: number) => new GeminiImageProvider(resolved(), vi.fn(async () => new Response('nope', { status })) as unknown as typeof fetch)
    const req = { prompt: 'p', references: [], aspect: '1:1' as const, signal }
    await expect(mk(401).generate(req)).rejects.toMatchObject({ kind: 'auth' })
    await expect(mk(403).generate(req)).rejects.toMatchObject({ kind: 'auth' })
    await expect(mk(429).generate(req)).rejects.toMatchObject({ kind: 'rate_limit' })
    await expect(mk(400).generate(req)).rejects.toMatchObject({ kind: 'bad_request', message: expect.stringContaining('nope') })
  })

  it('network failure is network; abort propagates', async () => {
    const g = new GeminiImageProvider(resolved(), vi.fn(async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch)
    await expect(g.generate({ prompt: 'p', references: [], aspect: '1:1', signal })).rejects.toMatchObject({ kind: 'network' })
    const ac = new AbortController()
    ac.abort()
    const g2 = new GeminiImageProvider(resolved(), vi.fn(async () => { throw new DOMException('aborted', 'AbortError') }) as unknown as typeof fetch)
    await expect(g2.generate({ prompt: 'p', references: [], aspect: '1:1', signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('parseInteractionImage', () => {
  it('parses the fixture, prefers output_image, errors on text-only', () => {
    expect(parseInteractionImage(fixture('gemini-interaction-image.json')).mime).toBe('image/png')
    const withOut = parseInteractionImage({ output_image: { data: Buffer.from('zz').toString('base64'), mime_type: 'image/jpeg' } })
    expect(withOut.mime).toBe('image/jpeg')
    expect(withOut.data.toString()).toBe('zz')
    expect(() => parseInteractionImage(fixture('gemini-interaction-text-only.json'))).toThrow('The image model returned no image')
    expect(() => parseInteractionImage(null)).toThrow(/no image/)
  })
})
