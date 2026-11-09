// Zod schemas for every persisted record, IPC input and tool input. These are the
// single source of truth: `types.ts` derives every type from them with `z.infer`.
//
// Rules used throughout:
//  - A field the spec lists with a default is optional on input and filled on parse.
//    Everything else is required (nullable where the spec says so).
//  - Input/patch schemas (`PanelDraft`, `PanelPatch`, `CharacterInput`, `CharacterPatch`,
//    `VariationInput`, `ItemInput`, `ItemPatch`, `ItemUsageInput`) carry NO defaults. In zod 4 `.partial()` / `.optional()` do not stop a
//    default from firing, so a patch built from a defaulted schema would silently reset fields
//    the caller never named. Services apply defaults when they build the full entity.
//  - IDs and timestamps are plain strings (`<prefix>_<10 hex>` / ISO-8601). Format checks live in
//    one place each (`Id`, `IsoTimestamp`) should they ever need tightening.

import { z } from 'zod'
import { PanelLocationSchema } from './location-schemas'
import { CheckResultSchema, CreatedBySchema, Id, ImageStatusSchema, IsoTimestamp, text } from './schema-primitives'

export { CheckResultSchema } from './schema-primitives'
export * from './location-schemas'

/** Re-declare an object shape without its `.default()` wrappers, so `.partial()` can't fill them. */
type WithoutDefaults<S extends z.ZodRawShape> = { [K in keyof S]: S[K] extends z.ZodDefault<infer Inner> ? Inner : S[K] }
function withoutDefaults<S extends z.ZodRawShape>(shape: S): WithoutDefaults<S> {
  return Object.fromEntries(Object.entries(shape).map(([key, field]) => [key, field instanceof z.ZodDefault ? field.unwrap() : field])) as WithoutDefaults<S>
}

// ---------------------------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------------------------

export const CharacterRoleSchema = z.enum(['protagonist', 'antagonist', 'supporting', 'minor'])
export const VariationKindSchema = z.enum(['base', 'outfit', 'expression', 'pose', 'age', 'form', 'other'])
const ItemUsageKindSchema = z.enum(['base', 'state', 'action'])
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
/** What an image model can be asked to draw. */
export const DrawAspectSchema = z.enum(['1:1', '2:3', '3:4', '9:16', '4:3', '16:9'])
/** A panel's shape: the draw aspects plus the two very tall ones, which are drawn at 9:16 and faded at the top and bottom. */
export const PanelAspectSchema = z.enum(['1:1', '2:3', '3:4', '9:16', '4:3', '16:9', '1:2', '1:3'])
export const PanelFrameSchema = z.enum(['bordered', 'borderless', 'slanted'])
export const PanelGapSchema = z.enum(['tight', 'normal', 'long'])
export const PanelGutterSchema = z.enum(['white', 'black'])
/** Where a cast member stands, in the user's words ("left", "far right, half in shadow", "background"). */
const PanelPositionSchema = z.string()
export const DialogueKindSchema = z.enum(['speech', 'thought', 'narration', 'sfx'])
const VersionSourceSchema = z.enum(['generate', 'edit', 'upload'])
const BeatStatusSchema = z.enum(['planned', 'drawn', 'dropped'])
const StopReasonSchema = z.enum(['end', 'tool_use', 'max_tokens', 'refusal'])
export const EndpointKindSchema = z.enum(['anthropic', 'openai', 'gemini', 'mock'])
export const CapabilitySchema = z.enum(['text', 'vision', 'image-gen', 'image-edit'])
export const RoleSchema = z.enum(['agent', 'panelChat', 'vision', 'image', 'imageEdit'])

// ---------------------------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------------------------

export const DEFAULT_STYLE_PRESET ='Clean full-color Korean webtoon style, crisp line art, soft cel shading, expressive faces'

export const ProjectMetaSchema = z.object({
  id: Id,
  title: z.string(),
  logline: z.string().default(''),
  stylePreset: z.string().default(DEFAULT_STYLE_PRESET),
  defaultAspect: PanelAspectSchema.default('2:3'),
  autopilotPanels: z.number().int().min(1).default(4),
  consistencyRetries: z.number().int().min(0).default(1),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp
})

// ---------------------------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------------------------

const CharacterizationSchema = z.object({
  personality: text(),
  backstory: text(),
  motivation: text(),
  speechStyle: text(),
  relationships: z.array(z.object({ characterId: Id, relation: z.string() })).default([]),
  notes: text()
})

const AppearanceSchema = z.object({
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
  check: CheckResultSchema.nullable().default(null),
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
// Items
// ---------------------------------------------------------------------------------------------

export const ItemUsageSchema = z.object({
  id: Id,
  itemId: Id,
  name: z.string(),
  kind: ItemUsageKindSchema,
  delta: text(),
  imagePath: z.string().nullable().default(null),
  status: ImageStatusSchema,
  error: z.string().nullable().default(null),
  check: CheckResultSchema.nullable().default(null),
  createdBy: CreatedBySchema,
  createdAt: IsoTimestamp
})

export const ItemSchema = z.object({
  id: Id,
  name: z.string(),
  aliases: z.array(z.string()).default([]),
  ownerId: Id.nullable().default(null),
  notes: text(),
  appearanceLock: z.string(),
  usages: z.array(ItemUsageSchema),
  archived: z.boolean().default(false),
  createdBy: CreatedBySchema,
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp
})

export const ItemInputSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()).optional(),
  ownerId: Id.nullable().optional(),
  notes: z.string().optional(),
  appearanceLock: z.string()
})

export const ItemPatchSchema = ItemInputSchema.partial()

export const ItemUsageInputSchema = z.object({
  name: z.string(),
  kind: ItemUsageKindSchema.exclude(['base']),
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

export const PanelItemSchema = z.object({
  itemId: Id,
  usageId: Id,
  heldBy: Id.nullable().default(null),
  action: z.string().default('')
})

/** Where a speech bubble's centre sits, as fractions of the panel's width and height. */
export const BubblePlacementSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })

export const BubbleShapeSchema = z.enum(['speech', 'shout', 'whisper', 'thought', 'caption', 'sfx', 'fringe', 'burst', 'curly'])
export const BubbleFontSchema = z.enum(['comic', 'bangers', 'hand', 'impact', 'serif', 'typewriter'])
// A refine and not a regex: a regex reaches the tool schemas as `pattern`, sent as it is to every provider.
const HexColor = z.string().refine((v) => /^#[0-9a-f]{6}$/i.test(v), 'A colour is written as #rrggbb')

/** How one bubble looks. Every key is optional: only what differs from the shape's default is stored. */
export const BubbleStyleSchema = z.object({
  shape: BubbleShapeSchema.optional(),
  font: BubbleFontSchema.optional(),
  /** A multiplier of the lettering's size. */
  size: z.number().min(0.5).max(3).optional(),
  /** A multiplier of the shape's own padding: the room between the text and the outline. */
  padding: z.number().min(0.3).max(2).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  caps: z.boolean().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  color: HexColor.optional(),
  fill: HexColor.optional(),
  stroke: HexColor.optional(),
  /** CSS px at the lettering's scale. */
  strokeWidth: z.number().min(0).max(6).optional(),
  /** The bubble's whole width, outline included, as a share of the panel's width. Left out, the bubble fits its text. */
  width: z.number().min(0.1).max(0.95).optional()
})

/** Where a bubble's tail points: 'none' draws no tail, a point is the tip as fractions of the panel. An enum rather than a literal because tool schemas go to every provider as JSON Schema. */
const BubbleTailSchema = z.union([z.enum(['none']), BubblePlacementSchema])

export const DialogueLineSchema = z.object({
  id: Id,
  speakerId: Id.nullable(),
  kind: DialogueKindSchema,
  text: z.string(),
  /** Null leaves the bubble where the strip's automatic layout puts it. */
  placement: BubblePlacementSchema.nullable().default(null),
  /** Null draws the bubble in its kind's default look. */
  style: BubbleStyleSchema.nullable().default(null),
  /** Null points the tail the automatic way. */
  tail: BubbleTailSchema.nullable().default(null)
})

/** What a panel's picture shows. A change to any of these makes the image out of date. */
export const VisualFieldsSchema = z.object({
  description: z.string(),
  setting: z.string(),
  shot: ShotTypeSchema,
  aspect: PanelAspectSchema,
  characters: z.array(PanelCharacterSchema),
  items: z.array(PanelItemSchema),
  /** Missing in a version recorded before panels had locations. */
  location: PanelLocationSchema.nullable().default(null)
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
  /** The visual fields of the panel when this attempt began; null for a version recorded before this was kept. */
  drawnFrom: VisualFieldsSchema.nullable().default(null),
  check: CheckResultSchema.nullable(),
  createdAt: IsoTimestamp
})

export const PanelSchema = z.object({
  id: Id,
  episodeId: Id,
  description: z.string(),
  setting: z.string(),
  /**
   * The saved location the panel is set in, its state and the camera; null when it has none. It writes the prompt's
   * [LOCATION] line and picks the image a draw continues from (see `pickContinuity`). Without one, the panel continues
   * from the one before it. A plain name (a build before locations were saved) reads as none.
   */
  location: z.preprocess((v) => (typeof v === 'string' ? null : v), PanelLocationSchema.nullable()).default(null),
  shot: ShotTypeSchema,
  aspect: PanelAspectSchema,
  frame: PanelFrameSchema.default('bordered'),
  beside: z.boolean().default(false),
  gapAfter: PanelGapSchema.default('normal'),
  gutter: PanelGutterSchema.default('white'),
  characters: z.array(PanelCharacterSchema).default([]),
  items: z.array(PanelItemSchema).default([]),
  dialogue: z.array(DialogueLineSchema),
  continuityNotes: z.string().default(''),
  offPanelMentions: z.array(z.string()).default([]),
  versions: z.array(PanelVersionSchema).default([]),
  currentVersionId: Id.nullable().default(null),
  /** The user's rough layout sketch (`panels/<pnlId>/sketch-<n>.png`), a reference for generation only. Absent or null: none. */
  sketchPath: z.string().nullable().optional(),
  createdBy: CreatedBySchema,
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp
})

/**
 * A dialogue line before it is stored: the service assigns the `dlg_` id. `placement` has no default
 * on purpose: left out it stays `undefined` (the line inherits the stored one), where `null` means automatic.
 */
// No defaults on the look fields: undefined means inherit from the stored line, and a default would turn it into clear.
const DialogueDraftSchema = DialogueLineSchema.omit({ id: true }).extend({
  placement: BubblePlacementSchema.nullable().optional(),
  style: BubbleStyleSchema.nullable().optional(),
  tail: BubbleTailSchema.nullable().optional()
})

export const PanelDraftSchema = z.object({
  episodeId: Id,
  afterPanelId: Id.nullable().optional(),
  description: z.string(),
  setting: z.string(),
  /** Null clears it. */
  location: PanelLocationSchema.nullable().optional(),
  shot: ShotTypeSchema,
  aspect: PanelAspectSchema.optional(),
  frame: PanelFrameSchema.optional(),
  beside: z.boolean().optional(),
  gapAfter: PanelGapSchema.optional(),
  gutter: PanelGutterSchema.optional(),
  characters: z.array(PanelCharacterSchema),
  items: z.array(PanelItemSchema).optional(),
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
// Episode export (IPC input; nothing here is persisted)
// ---------------------------------------------------------------------------------------------

export const ExportPresetSchema = z.enum(['webtoon', 'long-image', 'pdf-reading', 'pdf-print', 'cbz'])

/**
 * One export job. Unfinished panels are always left out; the dialog's "Export anyway" is only a confirmation.
 * `imageType` applies to `webtoon` and `long-image` (PDF and CBZ pages are always JPEG), `paper` to `pdf-print`
 * (which is always high resolution), and `combine` to the PDF presets and CBZ with two or more episodes.
 */
export const ExportRequestSchema = z.object({
  projectId: Id,
  episodeIds: z.array(Id).min(1),
  preset: ExportPresetSchema,
  imageType: z.enum(['jpeg', 'png']).default('jpeg'),
  paper: z.enum(['a4', 'letter']).default('a4'),
  resolution: z.enum(['standard', 'high']).default('standard'),
  combine: z.boolean().default(false),
  lettering: z.boolean().default(true)
})

/** Which of a project's episodes the export dialog asks about. */
export const ExportInspectRequestSchema = z.object({ projectId: Id, episodeIds: z.array(Id) })

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
  options: z.object({
    serverSideFallback: z.boolean().optional(),
    // How long one image draw or consistency check on this endpoint may take; unset means 180 s. Bounded so a
    // value typed in milliseconds is refused instead of overflowing the timer (which would fire at once).
    timeoutSeconds: z.number().int().min(10).max(3600).optional()
  })
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
