// Type-only imports: this module is bundled into the sandboxed preload, so zod must not enter it.
import type { ChatMessage, ProjectMeta, ProjectProblem, SessionSummary } from './types'

/** The `project.json` fields a caller may change. */
export type ProjectPatch = Partial<
  Pick<ProjectMeta, 'title' | 'logline' | 'stylePreset' | 'storyMode' | 'defaultAspect' | 'autopilotPanels' | 'consistencyRetries'>
>

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
  'sessions:load': true
}

export const IPC_CHANNELS = Object.keys(channelSet) as IpcChannel[]

/** Main to renderer push channel; the payload is an `AppEvent`. */
export const EVENT_CHANNEL = 'app:event'
