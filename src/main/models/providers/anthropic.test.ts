import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@shared/types'
import type { ResolvedModel } from '../registry'
import {
  AnthropicTextProvider,
  executableToolUses,
  replayableContent,
  shouldUseServerFallback,
  toAnthropicMessages
} from './anthropic'
import type { AnthropicBetaRequestParams, AnthropicClientLike, AnthropicFinalMessage, AnthropicRequestParams, AnthropicStreamLike } from './anthropic'
import { createTextProvider } from './factory'
import { ProviderError } from './types'
import type { TextTurnRequest, ToolSpec } from './types'

interface ResolvedOverrides {
  modelId?: string
  baseUrl?: string
  options?: { serverSideFallback?: boolean }
  params?: Record<string, unknown>
}

function resolved(o: ResolvedOverrides = {}): ResolvedModel {
  return {
    endpoint: {
      id: 'end_0000000001',
      name: 'Anthropic',
      kind: 'anthropic',
      baseUrl: o.baseUrl ?? 'https://api.anthropic.com',
      options: o.options ?? {}
    },
    model: {
      id: 'mdl_0000000001',
      endpointId: 'end_0000000001',
      modelId: o.modelId ?? 'claude-opus-5-5',
      label: 'm',
      capabilities: ['text'],
      params: o.params ?? {},
      maxReferenceImages: 4
    },
    apiKey: 'sk-test'
  }
}

const textMessage: AnthropicFinalMessage = { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }

function makeFake(final: AnthropicFinalMessage | Error = textMessage, deltas: string[] = []) {
  const stream = (): AnthropicStreamLike => {
    const handlers: Array<(d: string) => void> = []
    const s: AnthropicStreamLike = {
      on(_ev, cb) {
        handlers.push(cb)
        return s
      },
      finalMessage: async () => {
        for (const d of deltas) handlers.forEach((h) => h(d))
        if (final instanceof Error) throw final
        return final
      }
    }
    return s
  }
  return {
    messages: { stream: vi.fn((_params: AnthropicRequestParams, _opts: { signal: AbortSignal }) => stream()) },
    beta: { messages: { stream: vi.fn((_params: AnthropicBetaRequestParams, _opts: { signal: AbortSignal }) => stream()) } }
  }
}

function req(over: Partial<TextTurnRequest> = {}): TextTurnRequest {
  const user: ChatMessage = {
    id: 'msg_0000000001',
    role: 'user',
    text: 'hi',
    imagePaths: [],
    stateSnapshot: null,
    createdAt: '2026-01-01T00:00:00.000Z'
  }
  return {
    system: 'sys',
    messages: [user],
    tools: [],
    loadImage: async () => ({ mime: 'image/png', base64: 'QUJD' }),
    signal: new AbortController().signal,
    ...over
  }
}

const spec = (name: string): ToolSpec => ({ name, description: `${name} tool`, inputSchema: { type: 'object', properties: {} } })

function provider(modelId: string, fake = makeFake(), o: ResolvedOverrides = {}) {
  return { fake, p: new AnthropicTextProvider(resolved({ modelId, ...o }), fake as AnthropicClientLike) }
}

const assistant = (over: Partial<Extract<ChatMessage, { role: 'assistant' }>>): ChatMessage => ({
  id: 'msg_0000000002',
  role: 'assistant',
  text: '',
  toolCalls: [],
  stopReason: 'end',
  model: { endpointId: 'end_0000000001', modelId: 'claude-opus-5-5' },
  raw: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over
})

describe('AnthropicTextProvider request', () => {
  it('builds the request', async () => {
    const { p, fake } = provider('claude-opus-5-5')
    await p.runTurn(req({ tools: [spec('list_characters')] }))
    const [params, opts] = fake.beta.messages.stream.mock.calls[0]
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 64000,
      output_config: { effort: 'high' },
      cache_control: { type: 'ephemeral' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default'
    })
    expect(params.tools[0]).toMatchObject({ name: 'list_characters', eager_input_streaming: true })
    expect(params).not.toHaveProperty('tool_choice')
    expect(params).not.toHaveProperty('thinking')
    expect(opts.signal).toBeInstanceOf(AbortSignal)
    expect(fake.messages.stream).not.toHaveBeenCalled()
  })

  it('uses the plain stream without betas when fallback does not apply', async () => {
    const { p, fake } = provider('claude-haiku-5-5')
    await p.runTurn(req())
    expect(fake.beta.messages.stream).not.toHaveBeenCalled()
    const [params] = fake.messages.stream.mock.calls[0]
    expect(params).not.toHaveProperty('betas')
    expect(params).not.toHaveProperty('fallbacks')
  })

  it('reads effort and max_tokens from model params', async () => {
    const { p, fake } = provider('claude-haiku-5-5', makeFake(), { params: { effort: 'low', max_tokens: 1000 } })
    await p.runTurn(req())
    expect(fake.messages.stream.mock.calls[0][0]).toMatchObject({ max_tokens: 1000, output_config: { effort: 'low' } })
  })

  it('ignores sampling params', async () => {
    const { p, fake } = provider('claude-haiku-5-5', makeFake(), { params: { temperature: 0.2, top_p: 0.5 } })
    await p.runTurn(req())
    const [params] = fake.messages.stream.mock.calls[0]
    expect(params).not.toHaveProperty('temperature')
    expect(params).not.toHaveProperty('top_p')
  })

  it('forwards text deltas', async () => {
    const { p } = provider('claude-opus-5-5', makeFake(textMessage, ['He', 'llo']))
    const got: string[] = []
    await p.runTurn(req({ onTextDelta: (d) => got.push(d) }))
    expect(got).toEqual(['He', 'llo'])
  })

  it('is created by the factory for anthropic endpoints', () => {
    expect(createTextProvider(resolved())).toBeInstanceOf(AnthropicTextProvider)
  })
})

describe('shouldUseServerFallback', () => {
  it('skips fallbacks for haiku, proxies and when disabled', () => {
    expect(shouldUseServerFallback(resolved({ modelId: 'claude-haiku-5-5' }))).toBe(false)
    expect(shouldUseServerFallback(resolved({ baseUrl: 'https://proxy.example.com' }))).toBe(false)
    expect(shouldUseServerFallback(resolved({ options: { serverSideFallback: false } }))).toBe(false)
  })

  it('applies to opus-5, sonnet-5 and fable-5 on the official URL with or without a trailing slash', () => {
    expect(shouldUseServerFallback(resolved())).toBe(true)
    expect(shouldUseServerFallback(resolved({ modelId: 'claude-sonnet-5-5', baseUrl: 'https://api.anthropic.com/' }))).toBe(true)
    expect(shouldUseServerFallback(resolved({ modelId: 'claude-fable-5-1' }))).toBe(true)
    expect(shouldUseServerFallback(resolved({ options: { serverSideFallback: true } }))).toBe(true)
  })
})

describe('toAnthropicMessages', () => {
  it('replays raw assistant content unchanged', async () => {
    const content = [
      { type: 'thinking', thinking: 'hm', signature: 'sig' },
      { type: 'text', text: 'hello' }
    ]
    const out = await toAnthropicMessages(
      [assistant({ text: 'ignored', raw: { provider: 'anthropic', content } })],
      req().loadImage
    )
    expect(out).toHaveLength(1)
    expect(out[0].content).toBe(content)
  })

  it('maps assistant text and tool calls when there is no raw content', async () => {
    const out = await toAnthropicMessages(
      [assistant({ text: 'doing it', toolCalls: [{ id: 'toolu_1', name: 'x', input: { a: 1 } }] })],
      req().loadImage
    )
    expect(out[0]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'doing it' },
        { type: 'tool_use', id: 'toolu_1', name: 'x', input: { a: 1 } }
      ]
    })
  })

  it('maps tool results with images and errors', async () => {
    const tool: ChatMessage = {
      id: 'msg_0000000003',
      role: 'tool',
      createdAt: '2026-01-01T00:00:00.000Z',
      results: [
        { toolCallId: 'toolu_1', name: 'x', ok: true, content: 'made it', images: ['a/b.png'] },
        { toolCallId: 'toolu_2', name: 'y', ok: false, content: 'boom', images: [] }
      ]
    }
    const out = await toAnthropicMessages([tool], req().loadImage)
    expect(out).toEqual([
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            is_error: false,
            content: [
              { type: 'text', text: 'made it' },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } }
            ]
          },
          { type: 'tool_result', tool_use_id: 'toolu_2', is_error: true, content: [{ type: 'text', text: 'boom' }] }
        ]
      }
    ])
  })

  it('puts the state snapshot before the user text and appends images', async () => {
    const user: ChatMessage = {
      id: 'msg_0000000001',
      role: 'user',
      text: 'make a panel',
      imagePaths: ['refs/x.png'],
      stateSnapshot: '<project_state>{}</project_state>',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    const [m] = await toAnthropicMessages([user], req().loadImage)
    const content = m.content as Array<{ type: string; text?: string }>
    expect(content[0].text?.startsWith('<project_state>')).toBe(true)
    expect(content[1]).toEqual({ type: 'text', text: 'make a panel' })
    expect(content[2].type).toBe('image')
  })

  it('omits empty assistant turns', async () => {
    const out = await toAnthropicMessages(
      [assistant({ text: '', toolCalls: [], raw: null }), assistant({ raw: { provider: 'anthropic', content: [] } })],
      req().loadImage
    )
    expect(out).toEqual([])
  })

  it('omits empty assistant turns from the request', async () => {
    const { p, fake } = provider('claude-opus-5-5')
    await p.runTurn(req({ messages: [...req().messages, assistant({ text: '', toolCalls: [], raw: null })] }))
    expect(fake.beta.messages.stream.mock.calls[0][0].messages.map((m: { role: string }) => m.role)).toEqual(['user'])
  })
})

describe('result mapping', () => {
  it('maps tool_use turns', async () => {
    const final: AnthropicFinalMessage = {
      content: [
        { type: 'text', text: 'on it' },
        { type: 'tool_use', id: 'toolu_1', name: 'list_characters', input: { q: 1 } }
      ],
      stop_reason: 'tool_use'
    }
    const { p } = provider('claude-opus-5-5', makeFake(final))
    const r = await p.runTurn(req())
    expect(r).toEqual({
      text: 'on it',
      toolCalls: [{ id: 'toolu_1', name: 'list_characters', input: { q: 1 } }],
      stopReason: 'tool_use',
      raw: { provider: 'anthropic', content: final.content }
    })
  })

  it.each(['end_turn', 'stop_sequence', 'pause_turn'])('maps %s to end', async (stop_reason) => {
    const { p } = provider('claude-opus-5-5', makeFake({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }], stop_reason }))
    expect(await p.runTurn(req())).toMatchObject({ text: 'ab', stopReason: 'end', toolCalls: [] })
  })

  it.each(['refusal', 'max_tokens'] as const)('never executes tools on %s', async (stop_reason) => {
    const final: AnthropicFinalMessage = { content: [{ type: 'tool_use', id: 'toolu_1', name: 'x', input: {} }], stop_reason }
    const { p } = provider('claude-opus-5-5', makeFake(final))
    expect(await p.runTurn(req())).toMatchObject({ toolCalls: [], stopReason: stop_reason })
  })
})

describe('fallback blocks', () => {
  const c = [
    { type: 'thinking', thinking: '' },
    { type: 'tool_use', id: 'a', name: 'x', input: {} },
    { type: 'fallback', from: {}, to: {} },
    { type: 'text', text: 'hi' },
    { type: 'tool_use', id: 'b', name: 'y', input: {} }
  ]

  it('drops pre-fallback tool_use and thinking', () => {
    expect(executableToolUses(c).map((t) => t.id)).toEqual(['b'])
    expect(replayableContent(c).map((b) => (b as { type: string }).type)).toEqual(['fallback', 'text', 'tool_use'])
  })

  it('uses the last fallback block', () => {
    const two = [
      { type: 'tool_use', id: 'a', name: 'x', input: {} },
      { type: 'fallback' },
      { type: 'redacted_thinking', data: 'z' },
      { type: 'tool_use', id: 'b', name: 'x', input: {} },
      { type: 'fallback' },
      { type: 'tool_use', id: 'c', name: 'x', input: {} }
    ]
    expect(executableToolUses(two).map((t) => t.id)).toEqual(['c'])
    expect(replayableContent(two).map((b) => (b as { type: string }).type)).toEqual(['fallback', 'fallback', 'tool_use'])
  })

  it('leaves content without a fallback block unchanged', () => {
    const plain = [{ type: 'thinking', thinking: 'x' }, { type: 'tool_use', id: 'a', name: 'x', input: {} }]
    expect(replayableContent(plain)).toEqual(plain)
    expect(executableToolUses(plain).map((t) => t.id)).toEqual(['a'])
  })
})

describe('error mapping', () => {
  const headers = new Headers()
  const cases: Array<[string, Error, string]> = [
    ['auth', new Anthropic.AuthenticationError(401, { error: { message: 'bad key' } }, 'bad key', headers), 'auth'],
    ['permission', new Anthropic.PermissionDeniedError(403, { error: { message: 'no' } }, 'no', headers), 'auth'],
    ['rate limit', new Anthropic.RateLimitError(429, { error: { message: 'slow' } }, 'slow', headers), 'rate_limit'],
    ['bad request', new Anthropic.BadRequestError(400, { error: { message: 'bad' } }, 'bad', headers), 'bad_request'],
    ['connection', new Anthropic.APIConnectionError({ message: 'down' }), 'network'],
    ['timeout', new Anthropic.APIConnectionTimeoutError(), 'timeout'],
    ['other', new Error('weird'), 'unknown']
  ]

  it.each(cases)('maps %s errors', async (_name, err, kind) => {
    const { p } = provider('claude-opus-5-5', makeFake(err))
    const caught = await p.runTurn(req()).catch((e: unknown) => e)
    expect(caught).toBeInstanceOf(ProviderError)
    expect(caught).toMatchObject({ kind, message: err.message })
  })

  it('lets an abort propagate unwrapped', async () => {
    const ac = new AbortController()
    const abort = new Anthropic.APIUserAbortError()
    const { p } = provider('claude-opus-5-5', makeFake(abort))
    ac.abort()
    const caught = await p.runTurn(req({ signal: ac.signal })).catch((e: unknown) => e)
    expect(caught).toBe(abort)
    expect(caught).not.toBeInstanceOf(ProviderError)
  })

  it('does not wrap an APIUserAbortError even if the signal is not aborted', async () => {
    const abort = new Anthropic.APIUserAbortError()
    const { p } = provider('claude-opus-5-5', makeFake(abort))
    expect(await p.runTurn(req()).catch((e: unknown) => e)).toBe(abort)
  })
})
