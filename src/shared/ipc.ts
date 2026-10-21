// Type-only imports: this module is bundled into the sandboxed preload, so zod must not enter it.
import type {
  Capability,
  ChatMessage,
  EndpointConfig,
  EndpointKind,
  ModelConfig,
  ModelRegistryView,
  ProjectMeta,
  ProjectProblem,
  Role,
  SessionSummary
} from './types'

/** The `project.json` fields a caller may change. */
export type ProjectPatch = Partial<
  Pick<ProjectMeta, 'title' | 'logline' | 'stylePreset' | 'storyMode' | 'defaultAspect' | 'autopilotPanels' | 'consistencyRetries'>
>

export type EndpointInput = { name: string; kind: EndpointKind; baseUrl: string; options?: EndpointConfig['options'] }
export type EndpointPatch = Partial<Omit<EndpointConfig, 'id'>>
export type ModelInput = {
  endpointId: string
  modelId: string
  label: string
  capabilities: Capability[]
  params?: Record<string, unknown>
  maxReferenceImages?: number
}
export type ModelPatch = Partial<Pick<ModelConfig, 'modelId' | 'label' | 'capabilities' | 'params' | 'maxReferenceImages'>>

/** Every request/response pair that crosses the preload bridge. Later tasks add channels here. */
export interface IpcContract {
  'projects:list': { req: Record<string, never>; res: { projects: ProjectMeta[]; problems: ProjectProblem[] } }
  'projects:create': { req: { title: string; logline?: string; stylePreset?: string }; res: ProjectMeta }
  'projects:open': { req: { projectId: string }; res: { meta: ProjectMeta; problems: ProjectProblem[] } }
  'projects:update': { req: { projectId: string; patch: ProjectPatch }; res: ProjectMeta }
  'sessions:list': { req: { projectId: string }; res: SessionSummary[] }
  'sessions:create': { req: { projectId: string }; res: SessionSummary }
  'sessions:rename': { req: { projectId: string; sessionId: string; title: string }; res: void }
  'sessions:delete': { req: { projectId: string; sessionId: string }; res: void }
  'sessions:load': { req: { projectId: string; sessionId: string }; res: ChatMessage[] }
  'models:get': { req: Record<string, never>; res: ModelRegistryView }
  'models:addEndpoint': { req: EndpointInput; res: EndpointConfig }
  'models:updateEndpoint': { req: { id: string; patch: EndpointPatch }; res: EndpointConfig }
  'models:removeEndpoint': { req: { id: string }; res: { clearedRoles: Role[] } }
  /** `key: null` removes the stored key. The key travels renderer to main only; it is never sent back. */
  'models:setApiKey': { req: { endpointId: string; key: string | null }; res: void }
  'models:addModel': { req: ModelInput; res: ModelConfig }
  'models:updateModel': { req: { id: string; patch: ModelPatch }; res: ModelConfig }
  'models:removeModel': { req: { id: string }; res: { clearedRoles: Role[] } }
  'models:assignRole': { req: { role: Role; modelId: string | null }; res: void }
  'agent:send': { req: { projectId: string; sessionId: string; text: string; imagePaths: string[]; activeEpisodeId: string | null }; res: { runId: string } }
  'agent:cancel': { req: { runId: string }; res: void }
  /** Opens the native file picker and copies the chosen images into the project; returns project-relative POSIX paths. */
  'uploads:pickImages': { req: { projectId: string }; res: { paths: string[] } }
  /** One cheap round trip to a model. Never returns the key. */
  'models:test': { req: { modelId: string }; res: { ok: boolean; message: string } }
}

export type IpcChannel = keyof IpcContract

/** A `Record` over every channel, so adding a channel to the contract without listing it here fails to compile. */
const channelSet: Record<IpcChannel, true> = {
  'projects:list': true,
  'projects:create': true,
  'projects:open': true,
  'projects:update': true,
  'sessions:list': true,
  'sessions:create': true,
  'sessions:rename': true,
  'sessions:delete': true,
  'sessions:load': true,
  'models:get': true,
  'models:addEndpoint': true,
  'models:updateEndpoint': true,
  'models:removeEndpoint': true,
  'models:setApiKey': true,
  'models:addModel': true,
  'models:updateModel': true,
  'models:removeModel': true,
  'models:assignRole': true,
  'agent:send': true,
  'agent:cancel': true,
  'uploads:pickImages': true,
  'models:test': true
}

export const IPC_CHANNELS = Object.keys(channelSet) as IpcChannel[]

/** Main to renderer push channel; the payload is an `AppEvent`. */
export const EVENT_CHANNEL = 'app:event'
