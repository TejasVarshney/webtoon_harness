// Type-only imports: this module is bundled into the sandboxed preload, so zod must not enter it.
import type {
  Capability,
  Beat,
  BeatPatch,
  Character,
  CharacterInput,
  CharacterPatch,
  ChatMessage,
  EndpointConfig,
  EndpointKind,
  Episode,
  ExportInspection,
  ExportRequest,
  Item,
  ItemInput,
  ItemPatch,
  ItemUsage,
  ItemUsageInput,
  Location,
  LocationInput,
  LocationPatch,
  LocationState,
  LocationStateInput,
  ModelConfig,
  ModelRegistryView,
  Panel,
  PanelDraft,
  PanelPatch,
  PanelPlacement,
  PanelVersion,
  PluginView,
  ProjectMeta,
  ProjectProblem,
  Role,
  SessionSummary,
  Variation,
  VariationInput
} from './types'

/** The `project.json` fields a caller may change. */
type ProjectPatch = Partial<
  Pick<ProjectMeta, 'title' | 'logline' | 'stylePreset' | 'defaultAspect' | 'autopilotPanels' | 'consistencyRetries'>
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

/** One workflow doc of a project: `name` is its path in the project's `agent/` folder without `.md` (`AGENTS`, `workflows/panel-editing`). */
export type WorkflowDocEntry = { name: string; title: string }

/** One style of the library. `edited`: a built-in the user changed, which Reset to default restores. */
export type StyleEntry = { id: string; name: string; text: string; builtin: boolean; edited: boolean }
/** What a project has drawn or is drawing: the art a new style would no longer match. */
export type StyleUsage = { sheets: number; panels: number }

/** Every request/response pair that crosses the preload bridge. Later tasks add channels here. */
export interface IpcContract {
  'projects:list': { req: Record<string, never>; res: { projects: ProjectMeta[]; problems: ProjectProblem[] } }
  'projects:create': { req: { title: string; logline?: string; stylePreset?: string }; res: ProjectMeta }
  'projects:open': { req: { projectId: string }; res: { meta: ProjectMeta; problems: ProjectProblem[] } }
  'projects:update': { req: { projectId: string; patch: ProjectPatch }; res: ProjectMeta }
  'sessions:list': { req: { projectId: string }; res: SessionSummary[] }
  'sessions:create': { req: { projectId: string }; res: SessionSummary }
  'sessions:rename': { req: { projectId: string; sessionId: string; title: string }; res: void }
  'sessions:bookmark': { req: { projectId: string; sessionId: string; bookmarked: boolean }; res: void }
  'sessions:delete': { req: { projectId: string; sessionId: string }; res: void }
  'sessions:load': { req: { projectId: string; sessionId: string }; res: ChatMessage[] }
  'models:get': { req: Record<string, never>; res: ModelRegistryView }
  'models:addEndpoint': { req: EndpointInput; res: EndpointConfig }
  /** `keyCleared`: the base URL moved to another host, so the stored key was removed (it is never sent to a new host). */
  'models:updateEndpoint': { req: { id: string; patch: EndpointPatch }; res: { endpoint: EndpointConfig; keyCleared: boolean } }
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
  'characters:list': { req: { projectId: string; includeArchived?: boolean }; res: Character[] }
  'characters:get': { req: { projectId: string; characterId: string }; res: Character }
  /** Returns the new character at once with a pending base variation; the base image follows through `character.changed`. */
  'characters:create': { req: { projectId: string; input: CharacterInput; generateBase: boolean }; res: Character }
  'characters:update': { req: { projectId: string; characterId: string; patch: CharacterPatch }; res: Character }
  'characters:archive': { req: { projectId: string; characterId: string }; res: void }
  'characters:unarchive': { req: { projectId: string; characterId: string }; res: void }
  /** Refused with an "archive it instead" error while any panel uses the character. */
  'characters:delete': { req: { projectId: string; characterId: string }; res: void }
  /** Returns the new variation at once (pending); its image follows through `character.changed` when `generate` is set. */
  'characters:addVariation': { req: { projectId: string; characterId: string; input: VariationInput; generate: boolean }; res: Variation }
  /** Starts generation without waiting for it; the outcome follows through `character.changed`. */
  'characters:generateVariation': { req: { projectId: string; characterId: string; variationId: string }; res: Variation }
  'characters:deleteVariation': { req: { projectId: string; characterId: string; variationId: string }; res: void }
  /** Opens a file dialog in main and stores the chosen png/jpg/webp as the variation's image. `null` when the dialog is cancelled. */
  'characters:uploadVariationImage': { req: { projectId: string; characterId: string; variationId: string }; res: Variation | null }
  'items:list': { req: { projectId: string; includeArchived?: boolean }; res: Item[] }
  'items:get': { req: { projectId: string; itemId: string }; res: Item }
  /** Returns the new item at once with a pending base usage; the base image follows through `item.changed`. */
  'items:create': { req: { projectId: string; input: ItemInput; generateBase: boolean }; res: Item }
  'items:update': { req: { projectId: string; itemId: string; patch: ItemPatch }; res: Item }
  'items:archive': { req: { projectId: string; itemId: string }; res: void }
  'items:unarchive': { req: { projectId: string; itemId: string }; res: void }
  /** Refused with an "archive it instead" error while any panel uses the item. */
  'items:delete': { req: { projectId: string; itemId: string }; res: void }
  /** Returns the new usage at once (pending); its image follows through `item.changed` when `generate` is set. */
  'items:addUsage': { req: { projectId: string; itemId: string; input: ItemUsageInput; generate: boolean }; res: ItemUsage }
  /** Starts generation without waiting for it; the outcome follows through `item.changed`. */
  'items:generateUsage': { req: { projectId: string; itemId: string; usageId: string }; res: ItemUsage }
  /** Refused for the base usage and while any panel uses the usage. */
  'items:deleteUsage': { req: { projectId: string; itemId: string; usageId: string }; res: void }
  /** Opens a file dialog in main and stores the chosen png/jpg/webp as the usage's image. `null` when the dialog is cancelled. */
  'items:uploadUsageImage': { req: { projectId: string; itemId: string; usageId: string }; res: ItemUsage | null }
  'locations:list': { req: { projectId: string; includeArchived?: boolean }; res: Location[] }
  'locations:get': { req: { projectId: string; locationId: string }; res: Location }
  /** Returns the new location at once with a pending base state; its picture follows through `location.changed`. */
  'locations:create': { req: { projectId: string; input: LocationInput; generateBase: boolean }; res: Location }
  'locations:update': { req: { projectId: string; locationId: string; patch: LocationPatch }; res: Location }
  'locations:archive': { req: { projectId: string; locationId: string }; res: void }
  'locations:unarchive': { req: { projectId: string; locationId: string }; res: void }
  /** Refused with an "archive it instead" error while any panel is set there. */
  'locations:delete': { req: { projectId: string; locationId: string }; res: void }
  /** Returns the new state at once; its picture follows through `location.changed` when `generate` is set. */
  'locations:addState': { req: { projectId: string; locationId: string; input: LocationStateInput; generate: boolean }; res: LocationState }
  /** Starts generation without waiting for it; the outcome follows through `location.changed`. */
  'locations:generateState': { req: { projectId: string; locationId: string; stateId: string }; res: LocationState }
  /** Refused for the base state and while any panel uses the state. */
  'locations:deleteState': { req: { projectId: string; locationId: string; stateId: string }; res: void }
  /** Opens a file dialog in main and stores the chosen png/jpg/webp as the state's picture. `null` when the dialog is cancelled. */
  'locations:uploadStateImage': { req: { projectId: string; locationId: string; stateId: string }; res: LocationState | null }
  /** A project with no episode yet gets `Episode 1` on the first call. */
  'episodes:list': { req: { projectId: string }; res: Episode[] }
  'episodes:create': { req: { projectId: string; title: string; synopsis?: string }; res: Episode }
  'episodes:update': { req: { projectId: string; episodeId: string; patch: { synopsis?: string } }; res: Episode }
  /** The episode's panels in episode order. */
  'panels:list': { req: { projectId: string; episodeId: string }; res: Panel[] }
  'panels:get': { req: { projectId: string; panelId: string }; res: Panel }
  /**
   * Returns the new panel at once, without an image; with `generate` the image follows through `panel.changed`.
   * The manual editor is lenient: a mention of a roster character that is not attached comes back in `warnings`, not as an error.
   * Any other validation failure rejects with the issues, one per line.
   */
  'panels:create': { req: { projectId: string; draft: PanelDraft; generate: boolean }; res: { panel: Panel; warnings: string[] } }
  /** Changes only the fields named in `patch`; it never touches the image. */
  'panels:update': { req: { projectId: string; panelId: string; patch: PanelPatch }; res: { panel: Panel; warnings: string[] } }
  /** Starts generation without waiting for it; the pending and final versions follow through `panel.changed`. */
  'panels:generate': { req: { projectId: string; panelId: string }; res: void }
  'panels:delete': { req: { projectId: string; panelId: string }; res: void }
  /** Saves where panels sit on the strip (everything else on it is frozen where it is drawn) and the reading order that follows. */
  'panels:place': { req: { projectId: string; episodeId: string; moves: { panelId: string; placement: PanelPlacement }[] }; res: void }
  'panels:move': { req: { projectId: string; panelId: string; toIndex: number }; res: void }
  /** Makes a ready version current; no version is deleted. */
  'panels:revert': { req: { projectId: string; panelId: string; versionId: string }; res: Panel }
  /** Opens a file dialog in main and stores the chosen png/jpg/webp as a new current version. `null` when the dialog is cancelled. */
  'panels:uploadImage': { req: { projectId: string; panelId: string }; res: PanelVersion | null }
  /** Stores the layout sketch, a `data:image/png;base64,` URL, as a new file; `null` forgets it. It never touches the image. */
  'panels:saveSketch': { req: { projectId: string; panelId: string; png: string | null }; res: Panel }
  /** The layout sketch as a `data:image/png;base64,` URL (a canvas can read it back, unlike an asset URL), or `null`. */
  'panels:readSketch': { req: { projectId: string; panelId: string }; res: string | null }
  /** A panel's chat thread, oldest first; empty until the first message. */
  'panelChat:load': { req: { projectId: string; panelId: string }; res: ChatMessage[] }
  /** Starts a run and returns at once. Its events arrive as `agent.event`s with threadKey `panel:<panelId>`; rejects while that panel's chat is already running. */
  'panelChat:send': { req: { projectId: string; panelId: string; text: string }; res: { runId: string } }
  'panelChat:cancel': { req: { runId: string }; res: void }
  /** The bible and the beats of one episode (all beats without `episodeId`). The first call in a project creates the bible template. */
  'story:get': { req: { projectId: string; episodeId?: string }; res: { bible: string; beats: Beat[] } }
  /** The style library. `loadError`: `styles.json` is unreadable, so the list holds only the built-ins and saves fail. */
  'styles:list': { req: Record<string, never>; res: { styles: StyleEntry[]; loadError: string | null } }
  'styles:create': { req: { name: string; text: string }; res: StyleEntry }
  'styles:update': { req: { id: string; patch: { name?: string; text?: string } }; res: StyleEntry }
  'styles:reset': { req: { id: string }; res: StyleEntry }
  'styles:delete': { req: { id: string }; res: void }
  'styles:usage': { req: { projectId: string }; res: StyleUsage }
  /** Copies a library style's text into the project. The user may do this at any time; the agent's `set_style` is the one that locks. */
  'styles:apply': { req: { projectId: string; styleId: string }; res: ProjectMeta }
  /** Replaces the whole bible with the editor's text. */
  'story:updateBible': { req: { projectId: string; markdown: string }; res: void }
  'story:updateBeat': { req: { projectId: string; beatId: string; patch: BeatPatch }; res: Beat }
  /** The project's workflow docs: AGENTS first, then the others by name. */
  'docs:list': { req: { projectId: string }; res: WorkflowDocEntry[] }
  /** Opens one listed doc in the system's default editor. */
  'docs:open': { req: { projectId: string; name: string }; res: void }
  /** Overwrites every doc of the project with its shipped default. */
  'docs:reset': { req: { projectId: string }; res: void }
  /** The built-in plugins with their on/off state, status line and config. */
  'plugins:list': { req: Record<string, never>; res: PluginView[] }
  /** Why `plugins.json` could not be read (every plugin is then off until it is fixed), or null. */
  'plugins:loadError': { req: Record<string, never>; res: string | null }
  'plugins:setEnabled': { req: { id: string; enabled: boolean }; res: PluginView }
  /** Merges `patch` into the plugin's config; a running plugin is restarted. */
  'plugins:setConfig': { req: { id: string; patch: Record<string, unknown> }; res: PluginView }
  /** The `claude mcp add` line (with the token) for the Claude Code link. Fails while the plugin is off. */
  'claudeCode:connectCommand': { req: Record<string, never>; res: { command: string } }
  /** Replaces the Claude Code link's token and disconnects its clients. Fails while the plugin is off. */
  'claudeCode:regenerateToken': { req: Record<string, never>; res: void }
  /** Where a run would find the Claude Code executable (the saved path, then PATH, then the desktop app's install), or null. Works while the plugin is off. */
  'claudeCode:detect': { req: Record<string, never>; res: { path: string | null } }
  /** Which project and episode the window shows, for plugins that act on "the open project". Sent on every change and once at load. */
  'app:setActiveContext': { req: { projectId: string | null; episodeId: string | null }; res: void }
  /** Per episode: its panel counts and the unfinished panels, for the export dialog. */
  'export:inspect': { req: { projectId: string; episodeIds: string[] }; res: ExportInspection }
  /** Asks where to save (a file or a folder, by preset), then starts the job. `{ cancelled: true }` when the dialog is dismissed. Rejects with a readable message when nothing can be exported or a job is running. */
  'export:start': { req: ExportRequest; res: { jobId: string } | { cancelled: true } }
  'export:cancel': { req: { jobId: string }; res: void }
  /** Shows the job's first output in the file manager; does nothing when the job has none. Takes no path. */
  'export:reveal': { req: { jobId: string }; res: void }
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
  'sessions:bookmark': true,
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
  'models:test': true,
  'characters:list': true,
  'characters:get': true,
  'characters:create': true,
  'characters:update': true,
  'characters:archive': true,
  'characters:unarchive': true,
  'characters:delete': true,
  'characters:addVariation': true,
  'characters:generateVariation': true,
  'characters:deleteVariation': true,
  'characters:uploadVariationImage': true,
  'items:list': true,
  'items:get': true,
  'items:create': true,
  'items:update': true,
  'items:archive': true,
  'items:unarchive': true,
  'items:delete': true,
  'items:addUsage': true,
  'items:generateUsage': true,
  'items:deleteUsage': true,
  'items:uploadUsageImage': true,
  'locations:list': true,
  'locations:get': true,
  'locations:create': true,
  'locations:update': true,
  'locations:archive': true,
  'locations:unarchive': true,
  'locations:delete': true,
  'locations:addState': true,
  'locations:generateState': true,
  'locations:deleteState': true,
  'locations:uploadStateImage': true,
  'episodes:list': true,
  'episodes:create': true,
  'episodes:update': true,
  'panels:list': true,
  'panels:get': true,
  'panels:create': true,
  'panels:update': true,
  'panels:generate': true,
  'panels:delete': true,
  'panels:place': true,
  'panels:move': true,
  'panels:revert': true,
  'panels:uploadImage': true,
  'panels:saveSketch': true,
  'panels:readSketch': true,
  'panelChat:load': true,
  'panelChat:send': true,
  'panelChat:cancel': true,
  'story:get': true,
  'styles:list': true,
  'styles:create': true,
  'styles:update': true,
  'styles:reset': true,
  'styles:delete': true,
  'styles:usage': true,
  'styles:apply': true,
  'story:updateBible': true,
  'story:updateBeat': true,
  'docs:list': true,
  'docs:open': true,
  'docs:reset': true,
  'plugins:list': true,
  'plugins:loadError': true,
  'plugins:setEnabled': true,
  'plugins:setConfig': true,
  'claudeCode:connectCommand': true,
  'claudeCode:regenerateToken': true,
  'claudeCode:detect': true,
  'app:setActiveContext': true,
  'export:inspect': true,
  'export:start': true,
  'export:cancel': true,
  'export:reveal': true
}

export const IPC_CHANNELS = Object.keys(channelSet) as IpcChannel[]

/** Main to renderer push channel; the payload is an `AppEvent`. */
export const EVENT_CHANNEL = 'app:event'
