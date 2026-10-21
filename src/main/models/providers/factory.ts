import type { ResolvedModel } from '../registry'
import { MockImageProvider, MockTextProvider } from './mock'
import { UnsupportedCapabilityError } from './types'
import type { ImageProvider, TextProvider } from './types'

/** Anthropic, OpenAI and Gemini adapters are added by Tasks 9, 10 and 14. */
export function createTextProvider(r: ResolvedModel): TextProvider {
  switch (r.endpoint.kind) {
    case 'mock':
      return new MockTextProvider(process.env.WEBTOON_MOCK_SCRIPT ?? null)
    default:
      throw new UnsupportedCapabilityError(r.endpoint.kind, 'text')
  }
}

export function createImageProvider(r: ResolvedModel): ImageProvider {
  switch (r.endpoint.kind) {
    case 'mock':
      return new MockImageProvider()
    default:
      throw new UnsupportedCapabilityError(r.endpoint.kind, 'image')
  }
}
