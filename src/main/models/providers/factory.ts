import type { ResolvedModel } from '../registry'
import { AnthropicTextProvider } from './anthropic'
import { GeminiImageProvider } from './gemini-images'
import { MockImageProvider, MockTextProvider } from './mock'
import { OpenAIChatProvider } from './openai-chat'
import { OpenAIImageProvider } from './openai-images'
import { UnsupportedCapabilityError } from './types'
import type { ImageProvider, TextProvider } from './types'

export function createTextProvider(r: ResolvedModel): TextProvider {
  switch (r.endpoint.kind) {
    case 'mock':
      return new MockTextProvider(process.env.WEBTOON_MOCK_SCRIPT ?? null)
    case 'anthropic':
      return new AnthropicTextProvider(r)
    case 'openai':
      return new OpenAIChatProvider(r)
    default:
      throw new UnsupportedCapabilityError(r.endpoint.kind, 'text')
  }
}

export function createImageProvider(r: ResolvedModel): ImageProvider {
  switch (r.endpoint.kind) {
    case 'mock':
      return new MockImageProvider()
    case 'openai':
      return new OpenAIImageProvider(r)
    case 'gemini':
      return new GeminiImageProvider(r)
    default:
      throw new UnsupportedCapabilityError(r.endpoint.kind, 'image')
  }
}
