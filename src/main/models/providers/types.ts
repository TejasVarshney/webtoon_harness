import type { ChatMessage, PanelAspect, ToolCall } from '@shared/types'

export interface ToolSpec {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type ImageLoader = (relPath: string) => Promise<{ mime: string; base64: string }>

export interface TextTurnRequest {
  system: string
  messages: ChatMessage[]
  tools: ToolSpec[]
  loadImage: ImageLoader
  signal: AbortSignal
  onTextDelta?: (t: string) => void
}

export interface TextTurnResult {
  text: string
  toolCalls: ToolCall[]
  stopReason: 'end' | 'tool_use' | 'max_tokens' | 'refusal'
  raw: { provider: 'anthropic'; content: unknown[] } | null
}

export interface TextProvider {
  runTurn(req: TextTurnRequest): Promise<TextTurnResult>
}

export interface ImageRef {
  mime: string
  data: Buffer
  label: string
}

export interface ImageRequest {
  prompt: string
  references: ImageRef[]
  aspect: PanelAspect
  signal: AbortSignal
}

export interface ImageEditRequest extends ImageRequest {
  source: ImageRef
}

export interface ImageResult {
  mime: 'image/png' | 'image/jpeg' | 'image/webp'
  data: Buffer
}

export interface ImageProvider {
  generate(req: ImageRequest): Promise<ImageResult>
  edit(req: ImageEditRequest): Promise<ImageResult>
}

export type ProviderErrorKind = 'auth' | 'rate_limit' | 'bad_request' | 'network' | 'timeout' | 'unknown'

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind

  constructor(kind: ProviderErrorKind, message: string) {
    super(message)
    this.name = 'ProviderError'
    this.kind = kind
  }
}

/** The endpoint kind cannot serve the requested model type. */
export class UnsupportedCapabilityError extends Error {
  constructor(kind: string, wanted: 'text' | 'image') {
    super(`${kind} endpoints do not support ${wanted} models`)
    this.name = 'UnsupportedCapabilityError'
  }
}
