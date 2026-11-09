// Types for the shared domain. Everything that has a schema is derived from it with `z.infer`;
// this file has no runtime code (type-only imports), so it is free to import anywhere.

import type { z } from 'zod'
import type {
  AssistantMessageSchema,
  BeatPatchSchema,
  BeatSchema,
  BubbleFontSchema,
  BubblePlacementSchema,
  BubbleShapeSchema,
  BubbleStyleSchema,
  CapabilitySchema,
  CharacterInputSchema,
  CharacterPatchSchema,
  CharacterSchema,
  CheckResultSchema,
  ChatMessageSchema,
  DialogueLineSchema,
  DrawAspectSchema,
  EndpointConfigSchema,
  EndpointKindSchema,
  EpisodeSchema,
  ExportPresetSchema,
  ExportRequestSchema,
  ItemInputSchema,
  ItemPatchSchema,
  ItemSchema,
  ItemUsageInputSchema,
  ItemUsageSchema,
  LocationInputSchema,
  LocationPatchSchema,
  LocationSchema,
  LocationStateInputSchema,
  LocationStateSchema,
  ModelConfigSchema,
  PanelAspectSchema,
  PanelCharacterSchema,
  PanelDraftSchema,
  PanelGapSchema,
  PanelGutterSchema,
  PanelItemSchema,
  PanelLocationSchema,
  PanelPatchSchema,
  PanelPlacementSchema,
  PanelSchema,
  PanelVersionSchema,
  ProjectMetaSchema,
  RoleAssignmentsSchema,
  RoleSchema,
  ToolCallSchema,
  ToolMessageSchema,
  ToolResultSchema,
  UserMessageSchema,
  VariationInputSchema,
  VariationKindSchema,
  VariationSchema,
  VisualFieldsSchema
} from './schemas'

// --- derived from the schemas -----------------------------------------------------------------

export type ProjectMeta = z.infer<typeof ProjectMetaSchema>
export type Character = z.infer<typeof CharacterSchema>
export type Variation = z.infer<typeof VariationSchema>
export type Item = z.infer<typeof ItemSchema>
export type ItemUsage = z.infer<typeof ItemUsageSchema>
export type Location = z.infer<typeof LocationSchema>
export type LocationState = z.infer<typeof LocationStateSchema>
export type Episode = z.infer<typeof EpisodeSchema>
export type ExportPreset = z.infer<typeof ExportPresetSchema>
/** A parsed export request: every defaulted field is filled. */
export type ExportRequest = z.infer<typeof ExportRequestSchema>
export type Panel = z.infer<typeof PanelSchema>
export type PanelCharacter = z.infer<typeof PanelCharacterSchema>
export type PanelItem = z.infer<typeof PanelItemSchema>
export type PanelPlacement = z.infer<typeof PanelPlacementSchema>
export type PanelLocation = z.infer<typeof PanelLocationSchema>
export type DialogueLine = z.infer<typeof DialogueLineSchema>
export type BubblePlacement = z.infer<typeof BubblePlacementSchema>
export type BubbleShape = z.infer<typeof BubbleShapeSchema>
export type BubbleFont = z.infer<typeof BubbleFontSchema>
export type BubbleStyle = z.infer<typeof BubbleStyleSchema>
export type PanelVersion = z.infer<typeof PanelVersionSchema>
export type VisualFields = z.infer<typeof VisualFieldsSchema>
export type VisualField = keyof VisualFields
export type CheckResult = z.infer<typeof CheckResultSchema>
export type Beat = z.infer<typeof BeatSchema>
export type BeatPatch = z.infer<typeof BeatPatchSchema>

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
export type ItemInput = z.infer<typeof ItemInputSchema>
export type ItemPatch = z.infer<typeof ItemPatchSchema>
export type ItemUsageInput = z.infer<typeof ItemUsageInputSchema>
export type LocationInput = z.infer<typeof LocationInputSchema>
export type LocationPatch = z.infer<typeof LocationPatchSchema>
export type LocationStateInput = z.infer<typeof LocationStateInputSchema>

export type PanelAspect = z.infer<typeof PanelAspectSchema>
export type DrawAspect = z.infer<typeof DrawAspectSchema>
export type PanelGap = z.infer<typeof PanelGapSchema>
export type PanelGutter = z.infer<typeof PanelGutterSchema>
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
  driver: 'claude-code' | null
  /** The Claude Code session the next run resumes (phase 2 backend); null until its first run. */
  claudeSessionId: string | null
  /** Pinned under the Bookmarked heading in the chat's session list. */
  bookmarked: boolean
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

/** A plugin's own report of how it is doing, shown on its Settings card. */
export type PluginStatus = { state: 'off' | 'running' | 'error'; message: string }

/** What the renderer sees of a built-in plugin. */
export interface PluginView {
  id: string
  name: string
  description: string
  enabled: boolean
  status: PluginStatus
  config: Record<string, unknown>
}

/** How an agent loop run ended. Distinct from an assistant message's `stopReason`. */
export type LoopOutcome = 'end' | 'max_steps' | 'cancelled' | 'error' | 'refusal' | 'max_tokens'

export type AgentEvent =
  | { kind: 'run-started'; runId: string }
  | { kind: 'text-delta'; runId: string; text: string }
  | { kind: 'message'; runId: string; message: ChatMessage }
  | { kind: 'tool-started'; runId: string; toolCall: ToolCall }
  | { kind: 'run-finished'; runId: string; outcome: LoopOutcome; error: string | null }

/** What the export dialog shows about each ticked episode before it starts. */
export interface ExportInspection {
  episodes: {
    episodeId: string
    number: number
    title: string
    panelCount: number
    finishedCount: number
    /** `position` is 1-based in strip order. */
    unfinished: { panelId: string; position: number; reason: 'none' | 'generating' | 'failed' }[]
  }[]
}

/** Everything the export view draws for one episode, taken when the job starts so later edits do not reach it. */
export interface ExportSnapshot {
  projectId: string
  episode: Episode
  /** The full panel list in strip order, unfinished panels included: the view lays it out with `exportRows`. */
  panels: Panel[]
  characters: Character[]
  lettering: boolean
}

/** The export view's drawn layout in CSS px. Each row's `bottom` includes the gap below it. */
export interface ViewLayout {
  totalHeight: number
  rows: { top: number; bottom: number }[]
}

/**
 * Where an export job is. `episodeIndex` is 0-based among the episodes being exported (empty ones are skipped and
 * not counted in `episodeCount`). `slice` is 1-based within that episode's `sliceCount`, and 0 before its first
 * capture. `message` is the error on `failed`. `outputs` lists the written paths on `done`, and on `failed` the ones
 * already put in place before the failure (each replacing its old file); it is empty otherwise.
 */
export interface ExportProgress {
  jobId: string
  stage: 'rendering' | 'capturing' | 'writing' | 'done' | 'failed' | 'cancelled'
  episodeIndex: number
  episodeCount: number
  slice: number
  sliceCount: number
  message: string | null
  outputs: string[]
}

export type AppEvent =
  | { type: 'project.changed'; projectId: string }
  | { type: 'session.changed'; projectId: string; sessionId: string }
  | { type: 'character.changed'; projectId: string; characterId: string }
  | { type: 'item.changed'; projectId: string; itemId: string }
  | { type: 'location.changed'; projectId: string; locationId: string }
  | { type: 'episode.changed'; projectId: string; episodeId: string }
  | { type: 'panel.changed'; projectId: string; panelId: string }
  | { type: 'story.changed'; projectId: string }
  | { type: 'models.changed' }
  | { type: 'plugins.changed' }
  /** `threadKey` is a session id for the main chat, or `panel:<panelId>` for a panel side chat. */
  | { type: 'agent.event'; projectId: string; threadKey: string; event: AgentEvent }
  | { type: 'export.progress'; projectId: string; progress: ExportProgress }
