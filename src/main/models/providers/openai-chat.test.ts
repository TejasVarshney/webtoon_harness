import OpenAI from 'openai'
import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@shared/types'
import type { ResolvedModel } from '../registry'
import { OpenAIChatProvider, toOpenAIMessages } from './openai-chat'
import type { OpenAIClientLike, OpenAIFinalCompletion, OpenAIRequestParams, OpenAIStreamLike } from './openai-chat'
import { ProviderError } from './types'
import type { TextTurnRequest } from './types'

function resolved(over: { params?: Record<string, unknown>; capabilities?: Array<'text' | 'vision'> } = {}): ResolvedModel {
  return {
    endpoint: { id: 'end_0000000001', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', options: {} },
    model: {
      id: 'mdl_0000000001',
      endpointId: 'end_0000000001',
      modelId: 'gpt-x',
      label: 'm',
      capabilities: over.capabilities ?? ['text'],
      params: over.params ?? {},
      maxReferenceImages: 4
    },
    apiKey: 'sk-test'
  } as ResolvedModel
}

const textCompletion = (finish = 'stop', content = 'ok'): OpenAIFinalCompletion => ({
  choices: [{ finish_reason: finish, message: { content } }]
})

function makeFake(final: OpenAIFinalCompletion | Error = textCompletion(), deltas: string[] = []) {
  const result = async (): Promise<OpenAIFinalCompletion> => {
    if (final instanceof Error) throw final
    return final
  }
  const stream = (): OpenAIStreamLike => {
    const handlers: Array<(e: { delta: string }) => void> = []
    const s: OpenAIStreamLike = {
      on(_ev, cb) {
        handlers.push(cb)
        return s
      },
      finalChatCompletion: async () => {
        for (const d of deltas) handlers.forEach((h) => h({ delta: d }))
        return result()
      }
    }
    return s
  }
  return {
    chat: {
      completions: {
        create: vi.fn((_p: OpenAIRequestParams, _o: { signal: AbortSignal }) => result()),
        stream: vi.fn((_p: OpenAIRequestParams, _o: { signal: AbortSignal }) => stream())
      }
    }
  }
}

const loadImage = async (p: string) => ({ mime: 'image/png', base64: `B64:${p}` })

function req(over: Partial<TextTurnRequest> = {}): TextTurnRequest {
  const user: ChatMessage = {
    id: 'msg_0000000001',
    role: 'user',
    text: 'hi',
    imagePaths: [],
    stateSnapshot: null,
    createdAt: '2026-01-01T00:00:00.000Z'
  }
  return { system: 'sys', messages: [user], tools: [], loadImage, signal: new AbortController().signal, ...over }
}

function provider(fake = makeFake(), o: Parameters<typeof resolved>[0] = {}) {
  return { fake, p: new OpenAIChatProvider(resolved(o), fake as OpenAIClientLike) }
}

const assistant = (over: Partial<Extract<ChatMessage, { role: 'assistant' }>>): ChatMessage => ({
  id: 'msg_0000000002',
  role: 'assistant',
  text: '',
  toolCalls: [],
  stopReason: 'end',
  model: { endpointId: 'end_0000000001', modelId: 'gpt-x' },
  raw: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over
})

const toolMessage = (images: string[]): ChatMessage => ({
  id: 'msg_0000000003',
  role: 'tool',
  results: [{ toolCallId: 'call_1', name: 'view', ok: true, content: 'done', images }],
  createdAt: '2026-01-01T00:00:00.000Z'
})

describe('toOpenAIMessages', () => {
  it('maps tools and assistant tool calls', async () => {
    const fake = makeFake()
    const p = new OpenAIChatProvider(resolved(), fake as OpenAIClientLike)
    const messages: ChatMessage[] = [assistant({ text: 'sure', toolCalls: [{ id: 'call_1', name: 'view', input: { a: 1 } }] })]
    await p.runTurn(
      req({ messages, tools: [{ name: 'view', description: 'View it', inputSchema: { type: 'object', properties: {} } }] })
    )
    const [params] = fake.chat.completions.stream.mock.calls[0]
    expect(params.tools).toEqual([
      { type: 'function', function: { name: 'view', description: 'View it', parameters: { type: 'object', properties: {} } } }
    ])
    expect(params.messages[0]).toEqual({ role: 'system', content: 'sys' })
    expect(params.messages[1]).toEqual({
      role: 'assistant',
      content: 'sure',
      tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'view', arguments: '{"a":1}' } }]
    })
    expect(params).not.toHaveProperty('tool_choice')
  })

  it('sends tool results as role tool and images as a follow-up user message', async () => {
    const out = await toOpenAIMessages('sys', [toolMessage(['a.png', 'b.png'])], loadImage, true)
    expect(out[1]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: 'done' })
    expect(out[2]).toEqual({
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: 'data:image/png;base64,B64:a.png' } },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,B64:b.png' } }
      ]
    })
    expect(out).toHaveLength(3)
  })

  it('omits images for non-vision models', async () => {
    const user: ChatMessage = { id: 'msg_0000000001', role: 'user', text: 'look', imagePaths: ['x.png'], stateSnapshot: 'snap', createdAt: '2026-01-01T00:00:00.000Z' }
    const out = await toOpenAIMessages('sys', [user, toolMessage(['a.png'])], loadImage, false)
    expect(JSON.stringify(out)).not.toContain('image_url')
    expect(out[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'snap' },
        { type: 'text', text: 'look' },
        { type: 'text', text: '[image omitted: model has no vision capability]' }
      ]
    })
    expect(out[2]).toMatchObject({ role: 'tool', content: 'done\n[image omitted: model has no vision capability]' })
    expect(out).toHaveLength(3)
  })

  it('replays raw invalid tool arguments unchanged and skips empty assistant turns', async () => {
    const out = await toOpenAIMessages(
      'sys',
      [assistant({ toolCalls: [{ id: 'call_1', name: 'view', input: '{oops' }] }), assistant({})],
      loadImage,
      false
    )
    expect(out).toHaveLength(2)
    expect(out[1]).toMatchObject({ tool_calls: [{ function: { arguments: '{oops' } }] })
  })
})

describe('OpenAIChatProvider results', () => {
  it('parses tool call arguments and keeps invalid JSON raw', async () => {
    const final: OpenAIFinalCompletion = {
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: null,
            tool_calls: [
              { id: 'c1', type: 'function', function: { name: 'good', arguments: '{"a":1}' } },
              { id: 'c2', type: 'function', function: { name: 'bad', arguments: '{oops' } },
              { id: 'c3', type: 'function', function: { name: 'none', arguments: '' } }
            ]
          }
        }
      ]
    }
    const { p } = provider(makeFake(final))
    const r = await p.runTurn(req())
    expect(r.stopReason).toBe('tool_use')
    expect(r.raw).toBeNull()
    expect(r.toolCalls).toEqual([
      { id: 'c1', name: 'good', input: { a: 1 } },
      { id: 'c2', name: 'bad', input: '{oops' },
      { id: 'c3', name: 'none', input: {} }
    ])
  })

  it('maps finish reasons and drops tool calls from truncated or filtered turns', async () => {
    const withTool = (finish: string): OpenAIFinalCompletion => ({
      choices: [
        { finish_reason: finish, message: { content: 'x', tool_calls: [{ id: 'c1', type: 'function', function: { name: 't', arguments: '{}' } }] } }
      ]
    })
    const run = async (finish: string) => (await provider(makeFake(withTool(finish))).p.runTurn(req())).stopReason
    expect(await run('length')).toBe('max_tokens')
    expect(await run('tool_calls')).toBe('tool_use')
    expect(await run('content_filter')).toBe('refusal')
    expect(await run('stop')).toBe('tool_use') // stop with tool calls still executes them
    expect(await provider(makeFake(textCompletion('stop'))).p.runTurn(req())).toMatchObject({ stopReason: 'end', text: 'ok' })
    expect((await provider(makeFake(withTool('length'))).p.runTurn(req())).toolCalls).toEqual([])
  })

  it('forwards content deltas', async () => {
    const onTextDelta = vi.fn()
    await provider(makeFake(textCompletion(), ['a', 'b'])).p.runTurn(req({ onTextDelta }))
    expect(onTextDelta.mock.calls).toEqual([['a'], ['b']])
  })
})

describe('OpenAIChatProvider request', () => {
  it('merges params and honors stream:false', async () => {
    const { p, fake } = provider(makeFake(), { params: { temperature: 0.4, stream: false } })
    const onTextDelta = vi.fn()
    await p.runTurn(req({ onTextDelta }))
    expect(fake.chat.completions.stream).not.toHaveBeenCalled()
    const [params, opts] = fake.chat.completions.create.mock.calls[0]
    expect(params).toMatchObject({ model: 'gpt-x', temperature: 0.4 })
    expect(params).not.toHaveProperty('stream')
    expect(params).not.toHaveProperty('tools')
    expect(opts.signal).toBeInstanceOf(AbortSignal)
    expect(onTextDelta).toHaveBeenCalledWith('ok')
  })

  it('streams by default and strips a stream:true param', async () => {
    const { p, fake } = provider(makeFake(), { params: { temperature: 1, stream: true } })
    await p.runTurn(req())
    expect(fake.chat.completions.create).not.toHaveBeenCalled()
    const [params] = fake.chat.completions.stream.mock.calls[0]
    expect(params).toMatchObject({ temperature: 1 })
    expect(params).not.toHaveProperty('stream')
  })

  it('uses vision capability to include images', async () => {
    const user: ChatMessage = { id: 'msg_0000000001', role: 'user', text: 'x', imagePaths: ['x.png'], stateSnapshot: null, createdAt: '2026-01-01T00:00:00.000Z' }
    const { p, fake } = provider(makeFake(), { capabilities: ['text', 'vision'] })
    await p.runTurn(req({ messages: [user] }))
    expect(JSON.stringify(fake.chat.completions.stream.mock.calls[0][0].messages)).toContain('data:image/png;base64,B64:x.png')
  })
})

describe('OpenAIChatProvider errors', () => {
  const headers = new Headers()
  const cases: Array<[string, Error, string]> = [
    ['timeout', new OpenAI.APIConnectionTimeoutError(), 'timeout'],
    ['auth', new OpenAI.AuthenticationError(401, undefined, 'no', headers), 'auth'],
    ['permission', new OpenAI.PermissionDeniedError(403, undefined, 'no', headers), 'auth'],
    ['rate limit', new OpenAI.RateLimitError(429, undefined, 'slow', headers), 'rate_limit'],
    ['bad request', new OpenAI.BadRequestError(400, undefined, 'bad', headers), 'bad_request'],
    ['network', new OpenAI.APIConnectionError({ message: 'down' }), 'network'],
    ['unknown', new Error('boom'), 'unknown']
  ]
  it.each(cases)('maps %s errors', async (_n, err, kind) => {
    const e = await provider(makeFake(err)).p.runTurn(req()).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(ProviderError)
    expect((e as ProviderError).kind).toBe(kind)
  })

  it('propagates aborts unwrapped', async () => {
    const abort = new OpenAI.APIUserAbortError()
    await expect(provider(makeFake(abort)).p.runTurn(req())).rejects.toBe(abort)
    const named = Object.assign(new Error('x'), { name: 'AbortError' })
    await expect(provider(makeFake(named)).p.runTurn(req())).rejects.toBe(named)
    const ac = new AbortController()
    ac.abort()
    const other = new Error('whatever')
    await expect(provider(makeFake(other)).p.runTurn(req({ signal: ac.signal }))).rejects.toBe(other)
  })

  it('fails on an empty choices list', async () => {
    await expect(provider(makeFake({ choices: [] })).p.runTurn(req())).rejects.toBeInstanceOf(ProviderError)
  })
})
