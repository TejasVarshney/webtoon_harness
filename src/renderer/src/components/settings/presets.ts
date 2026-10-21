import type { Capability, EndpointKind } from '@shared/types'

export interface EndpointPreset {
  label: string
  kind: EndpointKind
  baseUrl: string
  suggestedModels: { modelId: string; capabilities: Capability[] }[]
}

/** Spec §7 "Presets": editable starting points for the Add endpoint form. Nothing beyond these suggestions is hardcoded. */
export const presets: EndpointPreset[] = [
  {
    label: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    suggestedModels: [
      { modelId: 'claude-opus-5-5', capabilities: ['text', 'vision'] },
      { modelId: 'claude-sonnet-5-5', capabilities: ['text', 'vision'] },
      { modelId: 'claude-haiku-5-5', capabilities: ['text', 'vision'] }
    ]
  },
  {
    label: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    suggestedModels: [{ modelId: 'gpt-image-2', capabilities: ['image-gen', 'image-edit'] }]
  },
  {
    label: 'Google Gemini',
    kind: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    suggestedModels: [
      { modelId: 'gemini-3.1-flash-image', capabilities: ['image-gen', 'image-edit'] },
      { modelId: 'gemini-3-pro-image', capabilities: ['image-gen', 'image-edit'] }
    ]
  },
  { label: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', suggestedModels: [] },
  { label: 'Ollama', kind: 'openai', baseUrl: 'http://localhost:11434/v1', suggestedModels: [] },
  { label: 'LM Studio', kind: 'openai', baseUrl: 'http://localhost:1234/v1', suggestedModels: [] }
]

/** Endpoint kinds a user can add (the mock endpoint is seeded, never added). */
export const ADDABLE_KINDS: EndpointKind[] = ['anthropic', 'openai', 'gemini']

/** What each kind can serve; mirrors the registry's rule so the model form only offers valid capabilities. */
export const KIND_CAPABILITIES: Record<EndpointKind, Capability[]> = {
  anthropic: ['text', 'vision'],
  gemini: ['image-gen', 'image-edit'],
  openai: ['text', 'vision', 'image-gen', 'image-edit'],
  mock: ['text', 'vision', 'image-gen', 'image-edit']
}

export const ALL_CAPABILITIES: Capability[] = ['text', 'vision', 'image-gen', 'image-edit']
