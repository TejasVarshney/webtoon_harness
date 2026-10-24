import { describe, expect, it, vi } from 'vitest'
import type { ResolvedModel } from '../registry'
import { OpenAIImageProvider, aspectToOpenAISize } from './openai-images'
import type { ImageRef } from './types'

function resolved(params: Record<string, unknown> = {}): ResolvedModel {
  return {
    endpoint: { id: 'end_0000000001', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', options: {} },
    model: { id: 'mdl_0000000001', endpointId: 'end_0000000001', modelId: 'gpt-image-2', label: 'm', capabilities: ['image-gen', 'image-edit'], params, maxReferenceImages: 16 },
    apiKey: 'sk-test'
  } as ResolvedModel
}

const b64 = Buffer.from('result-bytes').toString('base64')
function fakeClient() {
  return {
    images: {
      generate: vi.fn(async (_p: unknown, _o: unknown) => ({ data: [{ b64_json: b64 }] as Array<{ b64_json?: string }> })),
      edit: vi.fn(async (_p: unknown, _o: unknown) => ({ data: [{ b64_json: b64 }] as Array<{ b64_json?: string }> }))
    }
  }
}
const ref = (label: string): ImageRef => ({ mime: 'image/png', data: Buffer.from(label), label })
const signal = new AbortController().signal

describe('aspectToOpenAISize', () => {
  it('maps every aspect', () => {
    expect(aspectToOpenAISize('1:1')).toBe('1024x1024')
    for (const a of ['2:3', '3:4', '9:16'] as const) expect(aspectToOpenAISize(a)).toBe('1024x1536')
    for (const a of ['4:3', '16:9'] as const) expect(aspectToOpenAISize(a)).toBe('1536x1024')
  })
})

describe('OpenAIImageProvider', () => {
  it('generate without refs uses images.generate, with refs uses images.edit', async () => {
    const client = fakeClient()
    const p = new OpenAIImageProvider(resolved(), client)
    const out = await p.generate({ prompt: 'x', references: [], aspect: '2:3', signal })
    expect(client.images.generate).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-image-2', size: '1024x1536', n: 1 }), expect.anything())
    expect(out.mime).toBe('image/png')
    expect(out.data.toString()).toBe('result-bytes')
    await p.generate({ prompt: 'x', references: [ref('a'), ref('b')], aspect: '16:9', signal })
    const args = client.images.edit.mock.calls[0] as unknown as [{ image: unknown[]; size: string }, unknown]
    expect(args[0].image).toHaveLength(2)
    expect(args[0].size).toBe('1536x1024')
  })

  it('edit puts the source first and merges params; mime follows output_format', async () => {
    const client = fakeClient()
    const p = new OpenAIImageProvider(resolved({ quality: 'high', output_format: 'webp' }), client)
    const out = await p.edit({ prompt: 'e', source: ref('src'), references: [ref('r1')], aspect: '1:1', signal })
    const args = client.images.edit.mock.calls[0] as unknown as [{ image: { name: string }[]; quality: string; model: string }, unknown]
    expect(args[0].quality).toBe('high')
    expect(args[0].model).toBe('gpt-image-2')
    expect(args[0].image).toHaveLength(2)
    expect(args[0].image[0].name).toContain('source')
    expect(out.mime).toBe('image/webp')
  })

  it('drops references beyond 16', async () => {
    const client = fakeClient()
    const p = new OpenAIImageProvider(resolved(), client)
    await p.generate({ prompt: 'x', references: Array.from({ length: 20 }, (_, i) => ref(`r${i}`)), aspect: '1:1', signal })
    const args = client.images.edit.mock.calls[0] as unknown as [{ image: unknown[] }, unknown]
    expect(args[0].image).toHaveLength(16)
  })

  it('propagates aborts and wraps other errors', async () => {
    const client = fakeClient()
    const ac = new AbortController()
    ac.abort()
    client.images.generate.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'AbortError' }))
    const p = new OpenAIImageProvider(resolved(), client)
    await expect(p.generate({ prompt: 'x', references: [], aspect: '1:1', signal: ac.signal })).rejects.toMatchObject({ name: 'AbortError' })
    client.images.generate.mockRejectedValueOnce(new Error('boom'))
    await expect(p.generate({ prompt: 'x', references: [], aspect: '1:1', signal })).rejects.toMatchObject({ name: 'ProviderError', kind: 'unknown' })
    client.images.generate.mockResolvedValueOnce({ data: [{}] })
    await expect(p.generate({ prompt: 'x', references: [], aspect: '1:1', signal })).rejects.toMatchObject({ kind: 'bad_request' })
  })
})
