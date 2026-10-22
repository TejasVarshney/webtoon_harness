// Zod schemas for every persisted record, IPC input and tool input (spec §6). These are the
// single source of truth: `types.ts` derives every type from them with `z.infer`.
//
// Rules used throughout:
//  - A field the spec lists with a default is optional on input and filled on parse.
//    Everything else is required (nullable where the spec says so).
//  - Input/patch schemas (`PanelDraft`, `PanelPatch`, `CharacterInput`, `CharacterPatch`,
//    `VariationInput`) carry NO defaults. In zod 4 `.partial()` / `.optional()` do not stop a
//    default from firing, so a patch built from a defaulted schema would silently reset fields
//    the caller never named. Services apply defaults when they build the full entity.
//  - IDs and timestamps are plain strings (`<prefix>_<10 hex>` / ISO-8601). Format checks live in
//    one place each (`Id`, `IsoTimestamp`) should they ever need tightening.

import { z } from 'zod'

const Id = z.string()
const IsoTimestamp = z.string()

/** Re-declare an object shape without its `.default()` wrappers, so `.partial()` can't fill them. */
type WithoutDefaults<S extends z.ZodRawShape> = { [K in keyof S]: S[K] extends z.ZodDefault<infer Inner> ? Inner : S[K] }
function withoutDefaults<S extends z.ZodRawShape>(shape: S): WithoutDefaults<S> {
  return Object.fromEntries(Object.entries(shape).map(([key, field]) => [key, field instanceof z.ZodDefault ? field.unwrap() : field])) as WithoutDefaults<S>
}

// ---------------------------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------------------------

export const StoryModeSchema = z.enum(['user', 'ai'])
export const CreatedBySchema = z.enum(['user', 'ai'])
export const CharacterRoleSchema = z.enum(['protagonist', 'antagonist', 'supporting', 'minor'])
export const VariationKindSchema = z.enum(['base', 'outfit', 'expression', 'pose', 'age', 'form', 'other'])
export const ImageStatusSchema = z.enum(['pending', 'ready', 'failed'])
export const ShotTypeSchema = z.enum([
  'establishing',
  'wide',
  'medium',
  'close-up',
  'extreme-close-up',
  'over-the-shoulder',
  'birds-eye',
  'worms-eye'
])
export const PanelAspectSchema = z.enum(['1:1', '2:3', '3:4', '9:16', '4:3', '16:9'])
export const PanelPositionSchema = z.enum(['left', 'center', 'right', 'background'])
export const DialogueKindSchema = z.enum(['speech', 'thought', 'narration', 'sfx'])
export const VersionSourceSchema = z.enum(['generate', 'edit', 'upload'])
export const BeatStatusSchema = z.enum(['planned', 'drawn', 'dropped'])
export const StopReasonSchema = z.enum(['end', 'tool_use', 'max_tokens', 'refusal'])
export const EndpointKindSchema = z.enum(['anthropic', 'openai', 'gemini', 'mock'])
export const CapabilitySchema = z.enum(['text', 'vision', 'image-gen', 'image-edit'])
export const RoleSchema = z.enum(['agent', 'panelChat', 'vision', 'image', 'imageEdit'])

// ---------------------------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------------------------

export const DEFAULT_STYLE_PRESET = 'Clean full-color Korean webtoon style, crisp line art, soft cel shading, expressive faces'

export const ProjectMetaSchema = z.object({
  id: Id,
  title: z.string(),
  logline: z.string().default(''),
  stylePreset: z.string().default(DEFAULT_STYLE_PRESET),
  storyMode: StoryModeSchema.default('user'),
  defaultAspect: PanelAspectSchema.default('2:3'),
  autopilotPanels: z.number().int().min(1).default(4),
  consistencyRetries: z.number().int().min(0).default(1),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp
})

// ---------------------------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------------------------

const text = () => z.string().default('')

export const CharacterizationSchema = z.object({
  personality: text(),
  backstory: text(),
  motivation: text(),
  speechStyle: text(),
  relationships: z.array(z.object({ characterId: Id, relation: z.string() })).default([]),
  notes: text()
})

export const AppearanceSchema = z.object({
  age: text(),
  gender: text(),
  build: text(),
  height: text(),
  hair: text(),
  eyes: text(),
  skin: text(),
  distinguishingFeatures: text(),
  defaultOutfit: text(),
  palette: text()
})

export const VariationSchema = z.object({
  id: Id,
  characterId: Id,
  name: z.string(),
  kind: VariationKindSchema,
  delta: z.string().default(''),
  imagePath: z.string().nullable().default(null),
  status: ImageStatusSchema,
  error: z.string().nullable().default(null),
  createdBy: CreatedBySchema,
  createdAt: IsoTimestamp
})

export const CharacterSchema = z.object({
  id: Id,
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  role: CharacterRoleSchema,
  characterization: CharacterizationSchema.prefault({}),
  appearance: AppearanceSchema.prefault({}),
  appearanceLock: z.string(),
  variations: z.array(VariationSchema),
  archived: z.boolean().default(false),
  createdBy: CreatedBySchema,
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp
})

/** Characterization/appearance as a partial object: only the keys the caller names, no defaults. */
const PartialCharacterizationSchema = z.object(withoutDefaults(CharacterizationSchema.shape)).partial()
const PartialAppearanceSchema = z.object(withoutDefaults(AppearanceSchema.shape)).partial()

export const CharacterInputSchema = z.object({
  name: z.string(),
  role: CharacterRoleSchema,
  aliases: z.array(z.string()).optional(),
  characterization: PartialCharacterizationSchema.optional(),
  appearance: PartialAppearanceSchema.optional(),
  appearanceLock: z.string()
})

export const CharacterPatchSchema = CharacterInputSchema.partial()

export const VariationInputSchema = z.object({
  name: z.string(),
  kind: VariationKindSchema.exclude(['base']),
  delta: z.string()
})

// ---------------------------------------------------------------------------------------------
// Episodes, panels, story
// ---------------------------------------------------------------------------------------------

export const EpisodeSchema = z.object({
  id: Id,
  number: z.number().int().positive(),
  title: z.string(),
  synopsis: z.string().default(''),
  panelIds: z.array(Id).default([]),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp
})

export const PanelCharacterSchema = z.object({
  characterId: Id,
  variationId: Id,
  action: z.string().default(''),
  expression: z.string().default(''),
  position: PanelPositionSchema.default('center')
})

export const DialogueLineSchema = z.object({
  id: Id,
  speakerId: Id.nullable(),
  kind: DialogueKindSchema,
  text: z.string()
})

export const CheckResultSchema = z.object({
  passed: z.boolean(),
  issues: z.array(z.string()),
  skipped: z.boolean().default(false)
})

export const PanelVersionSchema = z.object({
  id: Id,
  source: VersionSourceSchema,
  status: ImageStatusSchema,
  error: z.string().nullable(),
  imagePath: z.string().nullable(),
  prompt: z.string(),
  referenceImagePaths: z.array(z.string()).default([]),
  instruction: z.string().nullable().default(null),
  parentVersionId: Id.nullable().default(null),
  check: CheckResultSchema.nullable(),
  createdAt: IsoTimestamp
})

export const PanelSchema = z.object({
  id: Id,
  episodeId: Id,
  description: z.string(),
  setting: z.string(),
  shot: ShotTypeSchema,
  aspect: PanelAspectSchema,
  characters: z.array(PanelCharacterSchema).default([]),
  dialogue: z.array(DialogueLineSchema),
  continuityNotes: z.string().default(''),
  offPanelMentions: z.array(z.string()).default([]),
  versions: z.array(PanelVersionSchema).default([]),
  currentVersionId: Id.nullable().default(null),
  createdBy: CreatedBySchema,
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp
})

/** A dialogue line before it is stored: the service assigns the `dlg_` id. */
const DialogueDraftSchema = DialogueLineSchema.omit({ id: true })

export const PanelDraftSchema = z.object({
  episodeId: Id,
  afterPanelId: Id.nullable().optional(),
  description: z.string(),
  setting: z.string(),
  shot: ShotTypeSchema,
  aspect: PanelAspectSchema.optional(),
  characters: z.array(PanelCharacterSchema),
  dialogue: z.array(DialogueDraftSchema),
  continuityNotes: z.string().optional(),
  offPanelMentions: z.array(z.string()).optional()
})

export const PanelPatchSchema = PanelDraftSchema.omit({ episodeId: true, afterPanelId: true }).partial()

export const BeatSchema = z.object({
  id: Id,
  episodeId: Id,
  summary: z.string(),
  status: BeatStatusSchema,
  createdAt: IsoTimestamp
})

export const OutlineSchema = z.object({ beats: z.array(BeatSchema) })

/** What a caller may change on a beat. Like the other patch schemas it carries no defaults. */
export const BeatPatchSchema = z.object({ summary: z.string().optional(), status: BeatStatusSchema.optional() })

// ---------------------------------------------------------------------------------------------
// Chat transcripts (discriminated on `role`)
// ---------------------------------------------------------------------------------------------

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  input: z.unknown()
})

export const ToolResultSchema = z.object({
  toolCallId: z.string(),
  name: z.string(),
  ok: z.boolean(),
  content: z.string(),
  images: z.array(z.string())
})

export const UserMessageSchema = z.object({
  id: Id,
  role: z.literal('user'),
  text: z.string(),
  imagePaths: z.array(z.string()).default([]),
  stateSnapshot: z.string().nullable(),
  createdAt: IsoTimestamp
})

export const AssistantMessageSchema = z.object({
  id: Id,
  role: z.literal('assistant'),
  text: z.string(),
  toolCalls: z.array(ToolCallSchema),
  stopReason: StopReasonSchema,
  model: z.object({ endpointId: Id, modelId: z.string() }),
  // Provider content is replayed unchanged (thinking blocks included), so its blocks stay `unknown`.
  raw: z.object({ provider: z.literal('anthropic'), content: z.array(z.unknown()) }).nullable(),
  createdAt: IsoTimestamp
})

export const ToolMessageSchema = z.object({
  id: Id,
  role: z.literal('tool'),
  results: z.array(ToolResultSchema),
  createdAt: IsoTimestamp
})

export const ChatMessageSchema = z.discriminatedUnion('role', [UserMessageSchema, AssistantMessageSchema, ToolMessageSchema])

// ---------------------------------------------------------------------------------------------
// Models file (models.json: endpoints, models, roles; never keys)
// ---------------------------------------------------------------------------------------------

export const EndpointConfigSchema = z.object({
  id: Id,
  name: z.string(),
  kind: EndpointKindSchema,
  baseUrl: z.string(),
  options: z.object({ serverSideFallback: z.boolean().optional() })
})

export const ModelConfigSchema = z.object({
  id: Id,
  endpointId: Id,
  modelId: z.string(),
  label: z.string(),
  capabilities: z.array(CapabilitySchema),
  params: z.record(z.string(), z.unknown()).default({}),
  maxReferenceImages: z.number().int().min(0).default(4)
})

/** Optional model id per role. */
export const RoleAssignmentsSchema = z.object({
  agent: Id.optional(),
  panelChat: Id.optional(),
  vision: Id.optional(),
  image: Id.optional(),
  imageEdit: Id.optional()
})

export const ModelsFileSchema = z.object({
  endpoints: z.array(EndpointConfigSchema),
  models: z.array(ModelConfigSchema),
  roles: RoleAssignmentsSchema
})
