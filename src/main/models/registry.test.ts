import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppEvent } from '@shared/types'
import { CorruptFileError, EntityNotFoundError } from '../domain/errors'
import { EventBus } from '../events/bus'
import { FakeEncryptor } from '../test/fake-encryptor'
import { CapabilityError, ModelRegistry, NoModelForRoleError } from './registry'
import { SecretsUnavailableError, SecretStore } from './secrets'

let dir: string
let file: string
let secretsFile: string
let enc: FakeEncryptor
let bus: EventBus
let events: AppEvent[]
let secrets: SecretStore
let registry: ModelRegistry

function build(): { registry: ModelRegistry; secrets: SecretStore } {
  const s = new SecretStore(secretsFile, enc)
  return { registry: new ModelRegistry({ file, secrets: s, bus }), secrets: s }
}

beforeEach(async () => {
  dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'webtoon test models '))
  file = path.join(dir, 'models.json')
  secretsFile = path.join(dir, 'secrets.json')
  enc = new FakeEncryptor()
  bus = new EventBus()
  events = []
  bus.subscribe((e) => events.push(e))
  const b = build()
  secrets = b.secrets
  registry = b.registry
  await secrets.load()
  await registry.load()
})
afterEach(async () => {
  await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5 })
})

describe('ModelRegistry', () => {
  it('seeds the mock endpoint on first load', async () => {
    const v = registry.view()
    expect(v.endpoints.map((e) => e.kind)).toEqual(['mock'])
    expect(v.endpoints[0]).toMatchObject({ id: 'end_0000000000', name: 'Mock (offline)', baseUrl: 'mock://local', hasKey: false })
    expect(v.models.map((m) => [m.id, m.modelId, m.capabilities])).toEqual([
      ['mdl_000000000a', 'mock-text', ['text', 'vision']],
      ['mdl_000000000b', 'mock-image', ['image-gen', 'image-edit']]
    ])
    expect(v.roles).toEqual({ agent: 'mdl_000000000a', image: 'mdl_000000000b' })
    expect(v.effectiveRoles).toEqual({
      agent: 'mdl_000000000a',
      panelChat: 'mdl_000000000a',
      vision: null,
      image: 'mdl_000000000b',
      imageEdit: 'mdl_000000000b'
    })
    expect(fs.existsSync(file)).toBe(true)
  })

  it('persists across instances', async () => {
    const e = await registry.addEndpoint({ name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1' })
    const m = await registry.addModel({
      endpointId: e.id,
      modelId: 'gpt-image-2',
      label: 'GPT Image',
      capabilities: ['image-gen'],
      params: { quality: 'high' }
    })
    await registry.assignRole('image', m.id)
    const again = build()
    await again.secrets.load()
    await again.registry.load()
    expect(again.registry.view()).toEqual(registry.view())
    expect(again.registry.view().roles.image).toBe(m.id)
  })

  it('applies schema defaults to added endpoints and models', async () => {
    const e = await registry.addEndpoint({ name: 'X', kind: 'openai', baseUrl: 'http://localhost:11434/v1' })
    expect(e.options).toEqual({})
    expect(e.id).toMatch(/^end_[0-9a-f]{10}$/)
    const m = await registry.addModel({ endpointId: e.id, modelId: 'llama', label: 'Llama', capabilities: ['text'] })
    expect(m).toMatchObject({ params: {}, maxReferenceImages: 4 })
    expect(m.id).toMatch(/^mdl_[0-9a-f]{10}$/)
  })

  it('never exposes or stores the plaintext key', async () => {
    const e = await registry.addEndpoint({ name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com' })
    await registry.setApiKey(e.id, 'sk-ant-SECRET')
    expect(JSON.stringify(registry.view())).not.toContain('SECRET')
    expect(await fs.promises.readFile(secretsFile, 'utf8')).not.toContain('SECRET')
    expect(await fs.promises.readFile(file, 'utf8')).not.toContain('SECRET')
    expect(registry.view().endpoints.find((x) => x.id === e.id)!.hasKey).toBe(true)
    expect(registry.resolve('agent').apiKey).toBeNull() // agent still on mock
    const m = await registry.addModel({ endpointId: e.id, modelId: 'claude-opus-5-5', label: 'Opus', capabilities: ['text', 'vision'] })
    await registry.assignRole('agent', m.id)
    expect(registry.resolve('agent')).toMatchObject({ apiKey: 'sk-ant-SECRET', model: { id: m.id }, endpoint: { id: e.id } })
    await registry.setApiKey(e.id, null)
    expect(registry.view().endpoints.find((x) => x.id === e.id)!.hasKey).toBe(false)
    expect(registry.resolve('agent').apiKey).toBeNull()
  })

  it('rejects role/capability mismatches', async () => {
    await expect(registry.assignRole('image', 'mdl_000000000a')).rejects.toBeInstanceOf(CapabilityError)
    await expect(registry.assignRole('imageEdit', 'mdl_000000000a')).rejects.toBeInstanceOf(CapabilityError)
    await expect(registry.assignRole('agent', 'mdl_000000000b')).rejects.toBeInstanceOf(CapabilityError)
    await expect(registry.assignRole('vision', 'mdl_000000000b')).rejects.toBeInstanceOf(CapabilityError)
    await registry.assignRole('vision', 'mdl_000000000a')
    expect(registry.view().effectiveRoles.vision).toBe('mdl_000000000a')
    const anth = await registry.addEndpoint({ name: 'A', kind: 'anthropic', baseUrl: 'https://api.anthropic.com' })
    await expect(registry.addModel({ endpointId: anth.id, modelId: 'img', label: 'img', capabilities: ['image-gen'] })).rejects.toBeInstanceOf(
      CapabilityError
    )
    const gem = await registry.addEndpoint({ name: 'G', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com' })
    await expect(registry.addModel({ endpointId: gem.id, modelId: 't', label: 't', capabilities: ['text'] })).rejects.toBeInstanceOf(CapabilityError)
    await expect(
      registry.addModel({ endpointId: gem.id, modelId: 'g', label: 'g', capabilities: ['image-gen', 'image-edit'] })
    ).resolves.toBeDefined()
    expect(registry.view().models).toHaveLength(3)
  })

  it('rejects capability or kind edits that would break assigned roles or models', async () => {
    await expect(registry.updateModel('mdl_000000000a', { capabilities: ['vision'] })).rejects.toBeInstanceOf(CapabilityError)
    await expect(registry.updateEndpoint('end_0000000000', { kind: 'gemini' })).rejects.toBeInstanceOf(CapabilityError)
    await registry.updateModel('mdl_000000000a', { label: 'Renamed' })
    expect(registry.view().models[0]!.label).toBe('Renamed')
    await registry.updateEndpoint('end_0000000000', { name: 'Offline' })
    expect(registry.view().endpoints[0]!.name).toBe('Offline')
  })

  it('rejects unknown ids', async () => {
    await expect(registry.assignRole('agent', 'mdl_ffffffffff')).rejects.toBeInstanceOf(EntityNotFoundError)
    await expect(registry.addModel({ endpointId: 'end_ffffffffff', modelId: 'x', label: 'x', capabilities: ['text'] })).rejects.toBeInstanceOf(
      EntityNotFoundError
    )
    await expect(registry.setApiKey('end_ffffffffff', 'k')).rejects.toBeInstanceOf(EntityNotFoundError)
    await expect(registry.removeModel('mdl_ffffffffff')).rejects.toBeInstanceOf(EntityNotFoundError)
  })

  it('clears roles when a model is removed (Review Focus 3)', async () => {
    const { clearedRoles } = await registry.removeModel('mdl_000000000a')
    expect(clearedRoles).toEqual(['agent'])
    expect(() => registry.resolve('agent')).toThrow("No model assigned to role 'agent'. Open Settings → Models.")
    expect(() => registry.resolve('agent')).toThrow(NoModelForRoleError)
    expect(registry.resolveOptional('agent')).toBeNull()
    expect(registry.view().effectiveRoles.panelChat).toBeNull()
    expect(registry.view().roles).toEqual({ image: 'mdl_000000000b' })
  })

  it('reports explicitly assigned roles only, in role order', async () => {
    await registry.assignRole('panelChat', 'mdl_000000000a')
    await registry.assignRole('imageEdit', 'mdl_000000000b')
    await registry.assignRole('vision', 'mdl_000000000a')
    expect((await registry.removeModel('mdl_000000000a')).clearedRoles).toEqual(['agent', 'panelChat', 'vision'])
    expect((await registry.removeModel('mdl_000000000b')).clearedRoles).toEqual(['image', 'imageEdit'])
  })

  it('removing an endpoint cascades models, roles and secret', async () => {
    await registry.setApiKey('end_0000000000', 'mock-key')
    expect(secrets.get('end_0000000000')).toBe('mock-key')
    const { clearedRoles } = await registry.removeEndpoint('end_0000000000')
    expect(clearedRoles).toEqual(['agent', 'image'])
    expect(registry.view().models).toEqual([])
    expect(registry.view().endpoints).toEqual([])
    expect(secrets.get('end_0000000000')).toBeNull()
    expect(() => registry.resolve('image')).toThrow("No model assigned to role 'image'. Open Settings → Models.")
    await expect(registry.removeEndpoint('end_0000000000')).rejects.toBeInstanceOf(EntityNotFoundError)
  })

  it('does not re-seed after everything was removed', async () => {
    await registry.removeEndpoint('end_0000000000')
    const again = build()
    await again.secrets.load()
    await again.registry.load()
    expect(again.registry.view().endpoints).toEqual([])
  })

  it('falls back panelChat to agent and imageEdit to image, unless assigned', async () => {
    const e = await registry.addEndpoint({ name: 'O', kind: 'openai', baseUrl: 'https://api.openai.com/v1' })
    const t = await registry.addModel({ endpointId: e.id, modelId: 'gpt', label: 'gpt', capabilities: ['text'] })
    await registry.assignRole('panelChat', t.id)
    expect(registry.resolve('panelChat').model.id).toBe(t.id)
    expect(registry.resolve('agent').model.id).toBe('mdl_000000000a')
    await registry.assignRole('panelChat', null)
    expect(registry.resolve('panelChat').model.id).toBe('mdl_000000000a')
    expect(registry.resolve('imageEdit').model.id).toBe('mdl_000000000b')
    expect(() => registry.resolve('vision')).toThrow("No model assigned to role 'vision'. Open Settings → Models.")
  })

  it('refuses keys when encryption is unavailable', async () => {
    enc.available = false
    await expect(registry.setApiKey('end_0000000000', 'k')).rejects.toBeInstanceOf(SecretsUnavailableError)
    expect(registry.view().endpoints[0]!.hasKey).toBe(false)
  })

  it('clears a stored key when the base URL moves to another host, and says so (Ruling F3)', async () => {
    const e = await registry.addEndpoint({ name: 'O', kind: 'openai', baseUrl: 'https://api.openai.com/v1' })
    await registry.setApiKey(e.id, 'sk-old')
    const hasKey = (): boolean => registry.view().endpoints.find((x) => x.id === e.id)!.hasKey

    expect(await registry.updateEndpoint(e.id, { name: 'O2' })).toMatchObject({ endpoint: { name: 'O2' }, keyCleared: false })
    expect(await registry.updateEndpoint(e.id, { baseUrl: 'https://API.openai.com/v2/' })).toMatchObject({ keyCleared: false })
    expect(hasKey()).toBe(true)

    const moved = await registry.updateEndpoint(e.id, { baseUrl: 'https://proxy.example.com/v1' })
    expect(moved).toEqual({ endpoint: expect.objectContaining({ baseUrl: 'https://proxy.example.com/v1' }), keyCleared: true })
    expect(hasKey()).toBe(false)
    expect(registry.resolveModel((await registry.addModel({ endpointId: e.id, modelId: 'm', label: 'm', capabilities: ['text'] })).id).apiKey).toBeNull()

    // A different port is a different server; with no key stored there is nothing to clear.
    await registry.setApiKey(e.id, 'sk-new')
    expect(await registry.updateEndpoint(e.id, { baseUrl: 'https://proxy.example.com:8443/v1' })).toMatchObject({ keyCleared: true })
    expect(await registry.updateEndpoint(e.id, { baseUrl: 'https://elsewhere.example.com' })).toMatchObject({ keyCleared: false })
  })

  it('compares unparseable base URLs as strings', async () => {
    const e = await registry.addEndpoint({ name: 'L', kind: 'openai', baseUrl: 'localhost-box' })
    await registry.setApiKey(e.id, 'k')
    expect(await registry.updateEndpoint(e.id, { baseUrl: 'localhost-box' })).toMatchObject({ keyCleared: false })
    expect(await registry.updateEndpoint(e.id, { baseUrl: 'other-box' })).toMatchObject({ keyCleared: true })
  })

  it('emits models.changed after every mutation', async () => {
    events.length = 0
    const e = await registry.addEndpoint({ name: 'O', kind: 'openai', baseUrl: 'u' })
    await registry.updateEndpoint(e.id, { name: 'O2' })
    await registry.setApiKey(e.id, 'k')
    const m = await registry.addModel({ endpointId: e.id, modelId: 'm', label: 'm', capabilities: ['text'] })
    await registry.updateModel(m.id, { label: 'm2' })
    await registry.assignRole('agent', m.id)
    await registry.removeModel(m.id)
    await registry.removeEndpoint(e.id)
    expect(events).toEqual(Array(8).fill({ type: 'models.changed' }))
  })

  it('serializes concurrent mutations without losing updates', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => registry.addEndpoint({ name: `E${i}`, kind: 'openai', baseUrl: `http://h${i}` }))
    )
    expect(registry.view().endpoints).toHaveLength(9)
    const again = build()
    await again.secrets.load()
    await again.registry.load()
    expect(again.registry.view().endpoints.map((e) => e.id)).toEqual(registry.view().endpoints.map((e) => e.id))
    expect(new Set(results.map((r) => r.id)).size).toBe(8)
  })

  it('leaves state untouched when a write fails', async () => {
    await fs.promises.rm(file)
    await fs.promises.mkdir(file) // a directory where the file should go: rename over it fails
    await expect(registry.addEndpoint({ name: 'X', kind: 'openai', baseUrl: 'u' })).rejects.toThrow()
    expect(registry.view().endpoints).toHaveLength(1)
    expect(events.filter((e) => e.type === 'models.changed')).toHaveLength(1) // the seed only
  })

  it('reports a corrupt models.json instead of overwriting it', async () => {
    await fs.promises.writeFile(file, '{ nope')
    const again = build()
    await expect(again.registry.load()).rejects.toBeInstanceOf(CorruptFileError)
    expect(await fs.promises.readFile(file, 'utf8')).toBe('{ nope')
  })
})
