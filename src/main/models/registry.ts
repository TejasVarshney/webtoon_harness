import type { z } from 'zod'
import type { EndpointInput, EndpointPatch, ModelInput, ModelPatch } from '@shared/ipc'
import { EndpointConfigSchema, ModelConfigSchema, ModelsFileSchema } from '@shared/schemas'
import type { EndpointConfig, ModelConfig, ModelRegistryView, Role } from '@shared/types'
import { newId } from '@shared/ids'
import { EntityNotFoundError } from '../domain/errors'
import type { EventBus } from '../events/bus'
import { readJson, writeJsonAtomic } from '../storage/atomic'
import { KeyedMutex } from '../storage/mutex'
import type { SecretStore } from './secrets'

type ModelsFile = z.infer<typeof ModelsFileSchema>
type Capability = ModelConfig['capabilities'][number]
type EndpointKind = EndpointConfig['kind']

/** Role declaration order; `clearedRoles` and the view follow it. */
const ROLES: readonly Role[] = ['agent', 'panelChat', 'vision', 'image', 'imageEdit']

const REQUIRED_CAPABILITY: Record<Role, Capability> = {
  agent: 'text',
  panelChat: 'text',
  vision: 'vision',
  image: 'image-gen',
  imageEdit: 'image-edit'
}

const FALLBACK: Partial<Record<Role, Role>> = { panelChat: 'agent', imageEdit: 'image' }

const KIND_CAPABILITIES: Record<EndpointKind, readonly Capability[]> = {
  anthropic: ['text', 'vision'],
  gemini: ['image-gen', 'image-edit'],
  openai: ['text', 'vision', 'image-gen', 'image-edit'],
  mock: ['text', 'vision', 'image-gen', 'image-edit']
}

const MOCK_ENDPOINT_ID = 'end_0000000000'
const MOCK_TEXT_MODEL_ID = 'mdl_000000000a'
const MOCK_IMAGE_MODEL_ID = 'mdl_000000000b'

/** A role has no usable model. The wording is shown to the user and relied on by tests. */
export class NoModelForRoleError extends Error {
  readonly role: Role

  constructor(role: Role) {
    super(`No model assigned to role '${role}'. Open Settings → Models.`)
    this.name = 'NoModelForRoleError'
    this.role = role
  }
}

/** A model's capabilities do not fit its endpoint kind, or a role it is assigned to. */
export class CapabilityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CapabilityError'
  }
}

export interface ResolvedModel {
  endpoint: EndpointConfig
  model: ModelConfig
  apiKey: string | null
}


function seed(): ModelsFile {
  return {
    endpoints: [{ id: MOCK_ENDPOINT_ID, name: 'Mock (offline)', kind: 'mock', baseUrl: 'mock://local', options: {} }],
    models: [
      {
        id: MOCK_TEXT_MODEL_ID,
        endpointId: MOCK_ENDPOINT_ID,
        modelId: 'mock-text',
        label: 'Mock text',
        capabilities: ['text', 'vision'],
        params: {},
        maxReferenceImages: 4
      },
      {
        id: MOCK_IMAGE_MODEL_ID,
        endpointId: MOCK_ENDPOINT_ID,
        modelId: 'mock-image',
        label: 'Mock image',
        capabilities: ['image-gen', 'image-edit'],
        params: {},
        maxReferenceImages: 4
      }
    ],
    roles: { agent: MOCK_TEXT_MODEL_ID, image: MOCK_IMAGE_MODEL_ID }
  }
}

function assertKindAllows(kind: EndpointKind, capabilities: readonly Capability[], what: string): void {
  const bad = capabilities.filter((c) => !KIND_CAPABILITIES[kind].includes(c))
  if (bad.length > 0) throw new CapabilityError(`${what}: a '${kind}' endpoint cannot provide ${bad.map((c) => `'${c}'`).join(', ')}.`)
}

function assertSatisfiesRole(model: ModelConfig, role: Role, capabilities: readonly Capability[] = model.capabilities): void {
  const need = REQUIRED_CAPABILITY[role]
  if (!capabilities.includes(need)) throw new CapabilityError(`Model '${model.label}' cannot be used for role '${role}': it needs the '${need}' capability.`)
}

/**
 * Endpoints, models and role assignments (`models.json`), plus API keys via the `SecretStore`.
 * Every mutation runs under a mutex, is validated, written atomically, and only then applied to
 * memory and announced with `models.changed`, so a failed write leaves the registry unchanged.
 */
export class ModelRegistry {
  private readonly mutex = new KeyedMutex()
  private state: ModelsFile = { endpoints: [], models: [], roles: {} }
  private readonly file: string
  private readonly secrets: SecretStore
  private readonly bus: EventBus

  constructor(opts: { file: string; secrets: SecretStore; bus: EventBus }) {
    this.file = opts.file
    this.secrets = opts.secrets
    this.bus = opts.bus
  }

  /** Reads `models.json`, seeding the mock endpoint when it does not exist. A corrupt file throws `CorruptFileError` and is left untouched. */
  async load(): Promise<void> {
    await this.mutex.run(this.file, async () => {
      try {
        this.state = await readJson(this.file, ModelsFileSchema)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        const seeded = seed()
        await writeJsonAtomic(this.file, seeded)
        this.state = seeded
        this.bus.emit({ type: 'models.changed' })
      }
    })
  }

  view(): ModelRegistryView {
    const s = structuredClone(this.state)
    const effectiveRoles = Object.fromEntries(ROLES.map((r) => [r, this.effectiveId(r)])) as Record<Role, string | null>
    return {
      endpoints: s.endpoints.map((e) => ({ ...e, hasKey: this.secrets.get(e.id) !== null })),
      models: s.models,
      roles: s.roles,
      effectiveRoles
    }
  }

  addEndpoint(input: EndpointInput): Promise<EndpointConfig> {
    return this.mutate((draft) => {
      const endpoint = EndpointConfigSchema.parse({ options: {}, ...input, id: newId('end') })
      draft.endpoints.push(endpoint)
      return endpoint
    })
  }

  updateEndpoint(id: string, patch: EndpointPatch): Promise<EndpointConfig> {
    return this.mutate((draft) => {
      const endpoint = this.requireEndpoint(draft, id)
      const next = EndpointConfigSchema.parse({ ...endpoint, ...patch, id })
      for (const m of draft.models.filter((x) => x.endpointId === id)) {
        assertKindAllows(next.kind, m.capabilities, `Model '${m.label}'`)
      }
      draft.endpoints[draft.endpoints.indexOf(endpoint)] = next
      return next
    })
  }

  removeEndpoint(id: string): Promise<{ clearedRoles: Role[] }> {
    return this.mutate(
      (draft) => {
        this.requireEndpoint(draft, id)
        const removed = new Set(draft.models.filter((m) => m.endpointId === id).map((m) => m.id))
        draft.endpoints = draft.endpoints.filter((e) => e.id !== id)
        draft.models = draft.models.filter((m) => m.endpointId !== id)
        return { clearedRoles: clearRoles(draft, removed) }
      },
      // The secret goes after models.json is safely written: an orphaned key is harmless, a lost key is not.
      () => this.secrets.set(id, null)
    )
  }

  setApiKey(endpointId: string, key: string | null): Promise<void> {
    return this.mutex.run(this.file, async () => {
      this.requireEndpoint(this.state, endpointId)
      await this.secrets.set(endpointId, key)
      this.bus.emit({ type: 'models.changed' })
    })
  }

  addModel(input: ModelInput): Promise<ModelConfig> {
    return this.mutate((draft) => {
      const endpoint = this.requireEndpoint(draft, input.endpointId)
      const model = ModelConfigSchema.parse({ ...input, id: newId('mdl') })
      assertKindAllows(endpoint.kind, model.capabilities, `Model '${model.label}'`)
      draft.models.push(model)
      return model
    })
  }

  updateModel(id: string, patch: ModelPatch): Promise<ModelConfig> {
    return this.mutate((draft) => {
      const model = this.requireModel(draft, id)
      const next = ModelConfigSchema.parse({ ...model, ...patch, id, endpointId: model.endpointId })
      assertKindAllows(this.requireEndpoint(draft, model.endpointId).kind, next.capabilities, `Model '${next.label}'`)
      for (const role of ROLES) {
        if (draft.roles[role] === id) assertSatisfiesRole(next, role)
      }
      draft.models[draft.models.indexOf(model)] = next
      return next
    })
  }

  removeModel(id: string): Promise<{ clearedRoles: Role[] }> {
    return this.mutate((draft) => {
      this.requireModel(draft, id)
      draft.models = draft.models.filter((m) => m.id !== id)
      return { clearedRoles: clearRoles(draft, new Set([id])) }
    })
  }

  assignRole(role: Role, modelId: string | null): Promise<void> {
    return this.mutate((draft) => {
      if (modelId === null) {
        delete draft.roles[role]
        return
      }
      assertSatisfiesRole(this.requireModel(draft, modelId), role)
      draft.roles[role] = modelId
    })
  }

  /** The model behind a role (after fallbacks), its endpoint and API key. Throws `NoModelForRoleError` when there is none. */
  resolve(role: Role): ResolvedModel {
    const resolved = this.resolveOptional(role)
    if (!resolved) throw new NoModelForRoleError(role)
    return resolved
  }

  resolveOptional(role: Role): ResolvedModel | null {
    const id = this.effectiveId(role)
    const model = id === null ? undefined : this.state.models.find((m) => m.id === id)
    const endpoint = model && this.state.endpoints.find((e) => e.id === model.endpointId)
    if (!model || !endpoint) return null
    return { endpoint: structuredClone(endpoint), model: structuredClone(model), apiKey: this.secrets.get(endpoint.id) }
  }

  private effectiveId(role: Role): string | null {
    const fallback = FALLBACK[role]
    return this.state.roles[role] ?? (fallback ? this.state.roles[fallback] : undefined) ?? null
  }

  private requireEndpoint(draft: ModelsFile, id: string): EndpointConfig {
    const found = draft.endpoints.find((e) => e.id === id)
    if (!found) throw new EntityNotFoundError('endpoint', id)
    return found
  }

  private requireModel(draft: ModelsFile, id: string): ModelConfig {
    const found = draft.models.find((m) => m.id === id)
    if (!found) throw new EntityNotFoundError('model', id)
    return found
  }

  /**
   * Runs `fn` on a copy of the state under the mutex, writes the copy atomically, then adopts it
   * and emits. `after` runs once the write has succeeded.
   */
  private mutate<T>(fn: (draft: ModelsFile) => T, after?: () => Promise<void>): Promise<T> {
    return this.mutex.run(this.file, async () => {
      const draft = structuredClone(this.state)
      const result = fn(draft)
      await writeJsonAtomic(this.file, draft)
      this.state = draft
      await after?.()
      this.bus.emit({ type: 'models.changed' })
      return result
    })
  }
}

/** Removes explicit assignments pointing at `removed` models; returns the cleared roles in declaration order. */
function clearRoles(draft: ModelsFile, removed: ReadonlySet<string>): Role[] {
  const cleared = ROLES.filter((r) => {
    const id = draft.roles[r]
    return id !== undefined && removed.has(id)
  })
  for (const r of cleared) delete draft.roles[r]
  return cleared
}
