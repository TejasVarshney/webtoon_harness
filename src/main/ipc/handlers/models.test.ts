import { afterEach, describe, expect, it } from 'vitest'
import { testServices, type TestServices } from '../../test/test-services'
import { modelsHandlers } from './models'

let services: TestServices | undefined
afterEach(async () => {
  await services?.cleanup()
  services = undefined
})

async function withModel(kind: 'anthropic' | 'openai', capabilities: ('text' | 'image-gen')[], key: string | null) {
  const s = (services = await testServices())
  const e = await s.registry.addEndpoint({ name: 'E', kind, baseUrl: 'https://example.test' })
  if (key) await s.registry.setApiKey(e.id, key)
  const m = await s.registry.addModel({ endpointId: e.id, modelId: 'some-model', label: 'M', capabilities })
  return { s, m }
}

describe('models:test', () => {
  it('runs one turn for a text model resolved by model id', async () => {
    const { s, m } = await withModel('anthropic', ['text'], 'sk-SECRET')
    let seen: { apiKey: string | null; model: string; maxTokens: unknown } | null = null
    let system: string | null = null
    const h = modelsHandlers(s, {
      createTextProvider: (r) => {
        seen = { apiKey: r.apiKey, model: r.model.id, maxTokens: r.model.params.max_tokens }
        return { runTurn: async (req) => ((system = req.system), { text: 'OK', toolCalls: [], stopReason: 'end', raw: null }) }
      }
    })
    const res = await h['models:test']!({ modelId: m.id })
    expect(res.ok).toBe(true)
    expect(res.message).toContain('OK')
    expect(seen).toEqual({ apiKey: 'sk-SECRET', model: m.id, maxTokens: 16 })
    expect(system).toBe('You are a connectivity check.')
  })

  it('maps provider errors to ok:false and never leaks the key', async () => {
    const { s, m } = await withModel('anthropic', ['text'], 'sk-SECRET')
    const h = modelsHandlers(s, {
      createTextProvider: () => ({
        runTurn: async () => {
          throw new Error('401 invalid key sk-SECRET')
        }
      })
    })
    const res = await h['models:test']!({ modelId: m.id })
    expect(res.ok).toBe(false)
    expect(res.message).toContain('401')
    expect(res.message).not.toContain('sk-SECRET')
  })

  it('reports a timeout through the abort signal', async () => {
    const { s, m } = await withModel('openai', ['text'], null)
    const h = modelsHandlers(s, {
      textTestTimeoutMs: 10,
      createTextProvider: () => ({
        runTurn: (req) =>
          new Promise((_, reject) => req.signal.addEventListener('abort', () => reject(req.signal.reason)))
      })
    })
    const res = await h['models:test']!({ modelId: m.id })
    expect(res.ok).toBe(false)
    expect(res.message).toMatch(/timed out/i)
  })

  it('reports key presence for image models without calling a provider', async () => {
    const withKey = await withModel('openai', ['image-gen'], 'k')
    const h1 = modelsHandlers(withKey.s, {
      createTextProvider: () => {
        throw new Error('must not be called')
      }
    })
    expect(await h1['models:test']!({ modelId: withKey.m.id })).toEqual({ ok: true, message: 'Key present' })
    await services?.cleanup()
    const noKey = await withModel('openai', ['image-gen'], null)
    expect(await modelsHandlers(noKey.s)['models:test']!({ modelId: noKey.m.id })).toEqual({ ok: true, message: 'No key set' })
  })

  it('does not consume the mock script for the mock endpoint', async () => {
    const s = (services = await testServices())
    const h = modelsHandlers(s, {
      createTextProvider: () => {
        throw new Error('must not be called')
      }
    })
    const res = await h['models:test']!({ modelId: 'mdl_000000000a' })
    expect(res.ok).toBe(true)
  })

  it('fails for an unknown model id', async () => {
    const s = (services = await testServices())
    const res = await modelsHandlers(s)['models:test']!({ modelId: 'mdl_ffffffffff' })
    expect(res.ok).toBe(false)
  })
})
