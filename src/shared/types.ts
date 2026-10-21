// Types for the shared domain. Everything that has a schema is derived from it with `z.infer`;
// this file has no runtime code (type-only imports), so it is free to import anywhere.

import type { z } from 'zod'
import type {
  AssistantMessageSchema,
  BeatSchema,
  CapabilitySchema,
  CharacterInputSchema,
  CharacterPatchSchema,
  CharacterSchema,
  CheckResultSchema,
  ChatMessageSchema,
  DialogueLineSchema,
  EndpointConfigSchema,
  EndpointKindSchema,
  EpisodeSchema,
  ModelConfigSchema,
  PanelAspectSchema,
  PanelCharacterSchema,
  PanelDraftSchema,
  PanelPatchSchema,
  PanelSchema,
  PanelVersionSchema,
  ProjectMetaSchema,
  RoleAssignmentsSchema,
  RoleSchema,
  ShotTypeSchema,
  StoryModeSchema,
  ToolCallSchema,
  ToolMessageSchema,
  ToolResultSchema,
  UserMessageSchema,
  VariationInputSchema,
  VariationKindSchema,
  VariationSchema
} from './schemas'

// --- derived from the schemas -----------------------------------------------------------------

export type ProjectMeta = z.infer<typeof ProjectMetaSchema>
export type Character = z.infer<typeof CharacterSchema>
export type Variation = z.infer<typeof VariationSchema>
export type Episode = z.infer<typeof EpisodeSchema>
export type Panel = z.infer<typeof PanelSchema>
export type PanelCharacter = z.infer<typeof PanelCharacterSchema>
export type DialogueLine = z.infer<typeof DialogueLineSchema>
export type PanelVersion = z.infer<typeof PanelVersionSchema>
export type CheckResult = z.infer<typeof CheckResultSchema>
export type Beat = z.infer<typeof BeatSchema>

export type ChatMessage = z.infer<typeof ChatMessageSchema>
export type UserMessage = z.infer<typeof UserMessageSchema>
export type AssistantMessage = z.infer<typeof AssistantMessageSchema>
export type ToolMessage = z.infer<typeof ToolMessageSchema>
export type ToolCall = z.infer<typeof ToolCallSchema>
export type ToolResult = z.infer<typeof ToolResultSchema>

export type EndpointConfig = z.infer<typeof EndpointConfigSchema>
export type ModelConfig = z.infer<typeof ModelConfigSchema>
export type RoleAssignments = z.infer<typeof RoleAssignmentsSchema>

export type PanelDraft = z.infer<typeof PanelDraftSchema>
export type PanelPatch = z.infer<typeof PanelPatchSchema>
export type CharacterInput = z.infer<typeof CharacterInputSchema>
export type CharacterPatch = z.infer<typeof CharacterPatchSchema>
export type VariationInput = z.infer<typeof VariationInputSchema>

export type PanelAspect = z.infer<typeof PanelAspectSchema>
export type ShotType = z.infer<typeof ShotTypeSchema>
export type StoryMode = z.infer<typeof StoryModeSchema>
export type VariationKind = z.infer<typeof VariationKindSchema>

export type Role = z.infer<typeof RoleSchema>
export type Capability = z.infer<typeof CapabilitySchema>
export type EndpointKind = z.infer<typeof EndpointKindSchema>

// --- types with no schema ---------------------------------------------------------------------

export interface SessionSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

/** A project file that failed to load (corrupt JSON, schema mismatch); the project still opens. */
export interface ProjectProblem {
  /** Project-relative POSIX path of the offending file. */
  path: string
  message: string
}

/** What the renderer sees of the model registry: no API keys, only whether one is stored. */
export interface ModelRegistryView {
  endpoints: (EndpointConfig & { hasKey: boolean })[]
  models: ModelConfig[]
  roles: RoleAssignments
  /** The model id each role resolves to after fallbacks (`panelChat` to `agent`, `imageEdit` to `image`), or null. */
  effectiveRoles: Record<Role, string | null>
}

/** How an agent loop run ended. Distinct from an assistant message's `stopReason`. */
export type LoopOutcome = 'end' | 'max_steps' | 'cancelled' | 'error' | 'refusal' | 'max_tokens'

export type AgentEvent =
  | { kind: 'run-started'; runId: string }
  | { kind: 'text-delta'; runId: string; text: string }
  | { kind: 'message'; runId: string; message: ChatMessage }
  | { kind: 'tool-started'; runId: string; toolCall: ToolCall }
  | { kind: 'run-finished'; runId: string; outcome: LoopOutcome; error: string | null }

export type AppEvent =
  | { type: 'project.changed'; projectId: string }
  | { type: 'session.changed'; projectId: string; sessionId: string }
  | { type: 'character.changed'; projectId: string; characterId: string }
  | { type: 'episode.changed'; projectId: string; episodeId: string }
  | { type: 'panel.changed'; projectId: string; panelId: string }
  | { type: 'story.changed'; projectId: string }
  | { type: 'models.changed' }
  /** `threadKey` is a session id for the main chat, or `panel:<panelId>` for a panel side chat. */
  | { type: 'agent.event'; projectId: string; threadKey: string; event: AgentEvent }
