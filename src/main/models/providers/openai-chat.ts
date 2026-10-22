import OpenAI from 'openai'
import type { ChatCompletionContentPart, ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'
import type { ChatMessage, ToolCall } from '@shared/types'
import type { ResolvedModel } from '../registry'
import { planImageReplay, type ReplayImage } from './image-replay'
import { ProviderError } from './types'
import type { ImageLoader, TextProvider, TextTurnRequest, TextTurnResult } from './types'

const NO_VISION_NOTE = '[image omitted: model has no vision capability]'

/** Request body. Model params are spread in first, so they cannot override the fields below. */
export interface OpenAIRequestParams {
  model: string
  messages: ChatCompletionMessageParam[]
  tools?: ChatCompletionTool[]
  [param: string]: unknown
}

export interface OpenAIFinalCompletion {
  choices: Array<{
    finish_reason: string | null
    message: {
      content?: string | null
      tool_calls?: Array<{ id: string; type: string; function?: { name: string; arguments: string } }>
    }
  }>
}

export interface OpenAIStreamLike {
  on(ev: 'content.delta', cb: (e: { delta: string }) => void): this
  finalChatCompletion(): Promise<OpenAIFinalCompletion>
}

export interface OpenAIClientLike {
  chat: {
    completions: {
      create(params: OpenAIRequestParams, opts: { signal: AbortSignal }): Promise<OpenAIFinalCompletion>
      stream(params: OpenAIRequestParams, opts: { signal: AbortSignal }): OpenAIStreamLike
    }
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** An image as a content part; a note (no vision, image gone, earlier image left out) as a text part. */
function contentPart(image: ReplayImage): ChatCompletionContentPart {
  if (image.kind === 'note') return { type: 'text', text: image.text }
  return { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.base64}` } }
}

export async function toOpenAIMessages(
  system: string,
  messages: ChatMessage[],
  loadImage: ImageLoader,
  vision: boolean
): Promise<ChatCompletionMessageParam[]> {
  const noVision = async (_index: number, paths: readonly string[]): Promise<ReplayImage[]> => paths.map(() => ({ kind: 'note', text: NO_VISION_NOTE }))
  const replay = vision ? planImageReplay(messages, loadImage) : noVision
  const out: ChatCompletionMessageParam[] = [{ role: 'system', content: system }]
  for (const [index, m] of messages.entries()) {
    if (m.role === 'user') {
      const parts: ChatCompletionContentPart[] = []
      if (m.stateSnapshot) parts.push({ type: 'text', text: m.stateSnapshot })
      if (m.text) parts.push({ type: 'text', text: m.text })
      for (const image of await replay(index, m.imagePaths)) parts.push(contentPart(image))
      if (parts.length > 0) out.push({ role: 'user', content: parts })
    } else if (m.role === 'assistant') {
      if (!m.text && m.toolCalls.length === 0) continue
      const toolCalls = m.toolCalls.map((c) => ({
        id: c.id,
        type: 'function' as const,
        // Invalid JSON is kept as the raw string; replay it as received.
        function: { name: c.name, arguments: typeof c.input === 'string' ? c.input : JSON.stringify(c.input ?? {}) }
      }))
      out.push({ role: 'assistant', content: m.text || null, ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) })
    } else {
      const images: ChatCompletionContentPart[] = []
      for (const [result, res] of m.results.entries()) {
        // Notes stay with their result's text; only real images move to the user message.
        const notes: string[] = []
        for (const image of await replay(index, res.images, result)) {
          if (image.kind === 'note') notes.push(image.text)
          else images.push(contentPart(image))
        }
        const content = [res.content, ...notes].filter(Boolean).join('\n')
        out.push({ role: 'tool', tool_call_id: res.toolCallId, content: content || '(no output)' })
      }
      // Tool messages cannot carry images: they follow as one user message, after all tool messages.
      if (images.length > 0) out.push({ role: 'user', content: images })
    }
  }
  return out
}

function mapFinishReason(s: string | null | undefined): TextTurnResult['stopReason'] {
  switch (s) {
    case 'tool_calls':
      return 'tool_use'
    case 'length':
      return 'max_tokens'
    case 'content_filter':
      return 'refusal'
    default:
      return 'end'
  }
}

function isAbort(err: unknown, signal: AbortSignal): boolean {
  return signal.aborted || err instanceof OpenAI.APIUserAbortError || (isRecord(err) && err.name === 'AbortError')
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

function parseArguments(raw: string): unknown {
  if (raw.trim() === '') return {}
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw // the tool registry rejects it as invalid input
  }
}

function toResult(completion: OpenAIFinalCompletion): TextTurnResult {
  const choice = completion.choices[0]
  if (!choice) throw new ProviderError('unknown', 'The model returned no choices')
  const text = choice.message.content ?? ''
  let stopReason = mapFinishReason(choice.finish_reason)
  const noTools = stopReason === 'refusal' || stopReason === 'max_tokens'
  const toolCalls: ToolCall[] = noTools
    ? []
    : (choice.message.tool_calls ?? []).flatMap((c) =>
        c.function ? [{ id: c.id, name: c.function.name, input: parseArguments(c.function.arguments) }] : []
      )
  // Some compatible servers report `stop` alongside tool calls.
  if (stopReason === 'end' && toolCalls.length > 0) stopReason = 'tool_use'
  if (stopReason === 'tool_use' && toolCalls.length === 0) stopReason = 'end'
  return { text, toolCalls, stopReason, raw: null }
}

export class OpenAIChatProvider implements TextProvider {
  private readonly client: OpenAIClientLike

  constructor(
    private readonly r: ResolvedModel,
    client?: OpenAIClientLike
  ) {
    this.client = client ?? new OpenAI({ apiKey: r.apiKey ?? 'not-needed', baseURL: r.endpoint.baseUrl })
  }

  async runTurn(req: TextTurnRequest): Promise<TextTurnResult> {
    const { r } = this
    const { stream: streamParam, ...extra } = r.model.params
    try {
      const params: OpenAIRequestParams = {
        ...extra,
        model: r.model.modelId,
        messages: await toOpenAIMessages(req.system, req.messages, req.loadImage, r.model.capabilities.includes('vision')),
        // Some compatible servers reject an empty tools array.
        ...(req.tools.length > 0
          ? {
              tools: req.tools.map((t) => ({
                type: 'function' as const,
                function: { name: t.name, description: t.description, parameters: t.inputSchema }
              }))
            }
          : {})
      }
      const opts = { signal: req.signal }
      if (streamParam === false) {
        const result = toResult(await this.client.chat.completions.create(params, opts))
        if (req.onTextDelta && result.text) req.onTextDelta(result.text)
        return result
      }
      const stream = this.client.chat.completions.stream(params, opts)
      if (req.onTextDelta) {
        const onDelta = req.onTextDelta
        stream.on('content.delta', (e) => onDelta(e.delta))
      }
      return toResult(await stream.finalChatCompletion())
    } catch (err) {
      if (isAbort(err, req.signal)) throw err
      throw mapError(err)
    }
  }
}
