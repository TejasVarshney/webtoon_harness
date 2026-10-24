import { newId } from '@shared/ids'
import type { UserMessage } from '@shared/types'
import { createTextProvider as defaultCreateTextProvider } from '../../models/providers/factory'
import type { TextProvider } from '../../models/providers/types'
import type { ResolvedModel } from '../../models/registry'
import type { Services } from '../../services'
import type { HandlerMap } from './projects'

export interface ModelsHandlerDeps {
  createTextProvider?: (r: ResolvedModel) => TextProvider
  /** Defaults to 30 s. */
  textTestTimeoutMs?: number
}

const TEST_PROMPT = 'Reply with the single word OK.'

/** Replaces every occurrence of the key, so an error that echoes it cannot leak it to the renderer. */
function redact(message: string, key: string | null): string {
  return key ? message.split(key).join('***') : message
}

async function testModel(
  s: Services,
  modelId: string,
  createProvider: (r: ResolvedModel) => TextProvider,
  timeoutMs: number
): Promise<{ ok: boolean; message: string }> {
  let resolved: ResolvedModel | null = null
  try {
    resolved = s.registry.resolveModel(modelId)
    // The mock needs no network and no key; running it would also consume a scripted turn.
    if (resolved.endpoint.kind === 'mock') return { ok: true, message: 'Mock model: no key needed' }
    if (!resolved.model.capabilities.includes('text')) {
      return { ok: true, message: resolved.apiKey !== null ? 'Key present' : 'No key set' }
    }
    // A small cap keeps an Anthropic check fast and cheap. OpenAI reasoning models reject `max_tokens`, so an
    // `openai` model is tested with its own params only (the 30 s timeout still bounds it).
    const params = resolved.endpoint.kind === 'openai' ? resolved.model.params : { ...resolved.model.params, max_tokens: 16 }
    const provider = createProvider({ ...resolved, model: { ...resolved.model, params } })
    const user: UserMessage = {
      id: newId('msg'),
      role: 'user',
      text: TEST_PROMPT,
      imagePaths: [],
      stateSnapshot: null,
      createdAt: new Date().toISOString()
    }
    const result = await provider.runTurn({
      system: 'You are a connectivity check.',
      messages: [user],
      tools: [],
      loadImage: () => Promise.reject(new Error('Images are not used in a connection test')),
      signal: AbortSignal.timeout(timeoutMs)
    })
    const reply = result.text.trim()
    return { ok: true, message: reply === '' ? 'Connected (empty reply)' : `Replied: ${reply.slice(0, 80)}` }
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return { ok: false, message: `Timed out after ${Math.round(timeoutMs / 1000)} s` }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, message: redact(message, resolved?.apiKey ?? null) }
  }
}

export function modelsHandlers(s: Services, deps: ModelsHandlerDeps = {}): HandlerMap {
  const r = s.registry
  const createProvider = deps.createTextProvider ?? defaultCreateTextProvider
  return {
    'models:get': async () => r.view(),
    'models:addEndpoint': (req) => r.addEndpoint(req),
    'models:updateEndpoint': ({ id, patch }) => r.updateEndpoint(id, patch),
    'models:removeEndpoint': ({ id }) => r.removeEndpoint(id),
    'models:setApiKey': ({ endpointId, key }) => r.setApiKey(endpointId, key),
    'models:addModel': (req) => r.addModel(req),
    'models:updateModel': ({ id, patch }) => r.updateModel(id, patch),
    'models:removeModel': ({ id }) => r.removeModel(id),
    'models:assignRole': ({ role, modelId }) => r.assignRole(role, modelId),
    'models:test': ({ modelId }) => testModel(s, modelId, createProvider, deps.textTestTimeoutMs ?? 30_000)
  }
}
