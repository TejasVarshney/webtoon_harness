import Anthropic from '@anthropic-ai/sdk'
import type { ImageBlockParam, MessageParam, TextBlockParam, ToolResultBlockParam, ToolUseBlock } from '@anthropic-ai/sdk/resources/messages'
import type { ChatMessage, ToolCall } from '@shared/types'
import type { ResolvedModel } from '../registry'
import { ProviderError } from './types'
import type { ImageLoader, TextProvider, TextTurnRequest, TextTurnResult } from './types'

const DEFAULT_MAX_TOKENS = 64000
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'
const FALLBACK_MODEL_PREFIXES = ['claude-opus-5', 'claude-sonnet-5', 'claude-fable-5']
const ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

type MediaType = Extract<ImageBlockParam['source'], { type: 'base64' }>['media_type']
type ContentParam = Exclude<MessageParam['content'], string>[number]

interface ToolParam {
  name: string
  description: string
  input_schema: { type: 'object'; [key: string]: unknown }
  eager_input_streaming: true
}

/** Request body. Declared locally: not every field below is on the non-beta params type. */
export interface AnthropicRequestParams {
  model: string
  max_tokens: number
  system: string
  messages: MessageParam[]
  tools: ToolParam[]
  output_config: { effort: (typeof EFFORTS)[number] }
  cache_control: { type: 'ephemeral' }
}

export interface AnthropicBetaRequestParams extends AnthropicRequestParams {
  betas: string[]
  fallbacks: 'default'
}

export interface AnthropicFinalMessage {
  content: unknown[]
  stop_reason: string | null
}

export interface AnthropicStreamLike {
  on(ev: 'text', cb: (delta: string) => void): this
  finalMessage(): Promise<AnthropicFinalMessage>
}

export interface AnthropicClientLike {
  messages: { stream(params: AnthropicRequestParams, opts: { signal: AbortSignal }): AnthropicStreamLike }
  beta: { messages: { stream(params: AnthropicBetaRequestParams, opts: { signal: AbortSignal }): AnthropicStreamLike } }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function blockType(b: unknown): string | null {
  return isRecord(b) && typeof b.type === 'string' ? b.type : null
}

export function shouldUseServerFallback(r: ResolvedModel): boolean {
  return (
    r.endpoint.options.serverSideFallback !== false &&
    r.endpoint.baseUrl.replace(/\/+$/, '') === ANTHROPIC_BASE_URL &&
    FALLBACK_MODEL_PREFIXES.some((p) => r.model.modelId.startsWith(p))
  )
}

/** Drops thinking and tool_use blocks that come before the last `fallback` block: they belong to the refused attempt. */
function afterLastFallback(content: unknown[]): unknown[] {
  let last = -1
  content.forEach((b, i) => {
    if (blockType(b) === 'fallback') last = i
  })
  if (last < 0) return content
  return content.filter((b, i) => {
    if (i >= last) return true
    const t = blockType(b)
    return t !== 'thinking' && t !== 'redacted_thinking' && t !== 'tool_use'
  })
}

export function replayableContent(content: unknown[]): unknown[] {
  return afterLastFallback(content)
}

export function executableToolUses(content: unknown[]): ToolUseBlock[] {
  return afterLastFallback(content).filter((b): b is ToolUseBlock => blockType(b) === 'tool_use')
}

async function imageBlock(loadImage: ImageLoader, relPath: string): Promise<ImageBlockParam> {
  const { mime, base64 } = await loadImage(relPath)
  return { type: 'image', source: { type: 'base64', media_type: mime as MediaType, data: base64 } }
}

export async function toAnthropicMessages(messages: ChatMessage[], loadImage: ImageLoader): Promise<MessageParam[]> {
  const out: MessageParam[] = []
  for (const m of messages) {
    if (m.role === 'user') {
      const content: ContentParam[] = []
      if (m.stateSnapshot) content.push({ type: 'text', text: m.stateSnapshot })
      if (m.text) content.push({ type: 'text', text: m.text })
      for (const p of m.imagePaths) content.push(await imageBlock(loadImage, p))
      if (content.length > 0) out.push({ role: 'user', content })
    } else if (m.role === 'assistant') {
      let content: ContentParam[]
      if (m.raw) {
        content = m.raw.content as ContentParam[]
      } else {
        content = []
        if (m.text) content.push({ type: 'text', text: m.text })
        for (const c of m.toolCalls) content.push({ type: 'tool_use', id: c.id, name: c.name, input: isRecord(c.input) ? c.input : {} })
      }
      // The API rejects an assistant turn with no content (e.g. a refusal that produced no text).
      if (content.length > 0) out.push({ role: 'assistant', content })
    } else {
      const blocks: ToolResultBlockParam[] = []
      for (const res of m.results) {
        const inner: Array<TextBlockParam | ImageBlockParam> = []
        if (res.content) inner.push({ type: 'text', text: res.content })
        for (const p of res.images) inner.push(await imageBlock(loadImage, p))
        if (inner.length === 0) inner.push({ type: 'text', text: '(no output)' })
        blocks.push({ type: 'tool_result', tool_use_id: res.toolCallId, is_error: !res.ok, content: inner })
      }
      if (blocks.length > 0) out.push({ role: 'user', content: blocks })
    }
  }
  return out
}

function mapStopReason(s: string | null): TextTurnResult['stopReason'] {
  switch (s) {
    case 'tool_use':
      return 'tool_use'
    case 'max_tokens':
      return 'max_tokens'
    case 'refusal':
      return 'refusal'
    default:
      return 'end'
  }
}

function isAbort(err: unknown, signal: AbortSignal): boolean {
  return signal.aborted || err instanceof Anthropic.APIUserAbortError || (isRecord(err) && err.name === 'AbortError')
}

function mapError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err
  const message = err instanceof Error ? err.message : String(err)
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new ProviderError('timeout', message)
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return new ProviderError('auth', message)
  if (err instanceof Anthropic.RateLimitError) return new ProviderError('rate_limit', message)
  if (err instanceof Anthropic.BadRequestError) return new ProviderError('bad_request', message)
  if (err instanceof Anthropic.APIConnectionError) return new ProviderError('network', message)
  return new ProviderError('unknown', message)
}

export class AnthropicTextProvider implements TextProvider {
  private readonly client: AnthropicClientLike

  constructor(
    private readonly r: ResolvedModel,
    client?: AnthropicClientLike
  ) {
    this.client = client ?? new Anthropic({ apiKey: r.apiKey ?? undefined, baseURL: r.endpoint.baseUrl })
  }

  async runTurn(req: TextTurnRequest): Promise<TextTurnResult> {
    const { r } = this
    const effort = EFFORTS.find((e) => e === r.model.params.effort) ?? 'high'
    const maxTokens = r.model.params.max_tokens
    try {
      const params: AnthropicRequestParams = {
        model: r.model.modelId,
        max_tokens: typeof maxTokens === 'number' && Number.isInteger(maxTokens) && maxTokens > 0 ? maxTokens : DEFAULT_MAX_TOKENS,
        system: req.system,
        messages: await toAnthropicMessages(req.messages, req.loadImage),
        tools: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: { ...t.inputSchema, type: 'object' },
          eager_input_streaming: true
        })),
        output_config: { effort },
        cache_control: { type: 'ephemeral' }
      }
      const opts = { signal: req.signal }
      const stream = shouldUseServerFallback(r)
        ? this.client.beta.messages.stream({ ...params, betas: [FALLBACK_BETA], fallbacks: 'default' }, opts)
        : this.client.messages.stream(params, opts)
      if (req.onTextDelta) stream.on('text', req.onTextDelta)
      return toResult(await stream.finalMessage())
    } catch (err) {
      if (isAbort(err, req.signal)) throw err
      throw mapError(err)
    }
  }
}

function toResult(message: AnthropicFinalMessage): TextTurnResult {
  const stopReason = mapStopReason(message.stop_reason)
  const text = message.content
    .map((b) => (blockType(b) === 'text' && isRecord(b) && typeof b.text === 'string' ? b.text : ''))
    .join('')
  const noTools = stopReason === 'refusal' || stopReason === 'max_tokens'
  const toolCalls: ToolCall[] = noTools
    ? []
    : executableToolUses(message.content).map((t) => ({ id: t.id, name: t.name, input: isRecord(t.input) ? { ...t.input } : {} }))
  // A refused or truncated turn never runs its tools, so a replayed tool_use would have no result (API 400).
  const replay = replayableContent(message.content)
  const content = noTools ? replay.filter((b) => blockType(b) !== 'tool_use') : replay
  return { text, toolCalls, stopReason, raw: { provider: 'anthropic', content } }
}
