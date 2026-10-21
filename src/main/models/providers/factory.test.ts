import { describe, expect, it } from 'vitest'
import type { EndpointConfig } from '@shared/types'
import type { ResolvedModel } from '../registry'
import { createImageProvider, createTextProvider } from './factory'
import { MockImageProvider, MockTextProvider } from './mock'
import { OpenAIChatProvider } from './openai-chat'
import { UnsupportedCapabilityError } from './types'

function resolved(kind: EndpointConfig['kind']): ResolvedModel {
  return {
    endpoint: { id: 'end_0000000001', name: kind, kind, baseUrl: 'x://y', options: {} },
    model: {
      id: 'mdl_0000000001',
      endpointId: 'end_0000000001',
      modelId: 'm',
      label: 'm',
      capabilities: ['text'],
      params: {},
      maxReferenceImages: 1
    },
    apiKey: null
  } as ResolvedModel
}

describe('provider factory', () => {
  it('picks mock providers', () => {
    expect(createTextProvider(resolved('mock'))).toBeInstanceOf(MockTextProvider)
    expect(createImageProvider(resolved('mock'))).toBeInstanceOf(MockImageProvider)
  })

  it('picks the openai text provider', () => {
    expect(createTextProvider(resolved('openai'))).toBeInstanceOf(OpenAIChatProvider)
  })

  it('rejects unsupported combos', () => {
    expect(() => createTextProvider(resolved('gemini'))).toThrow(UnsupportedCapabilityError)
    expect(() => createImageProvider(resolved('anthropic'))).toThrow(UnsupportedCapabilityError)
    expect(() => createImageProvider(resolved('openai'))).toThrow(/openai endpoints do not support image models/)
  })
})
