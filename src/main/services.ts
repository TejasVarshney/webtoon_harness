import fs from 'node:fs'
import { join } from 'node:path'
import { ExportService } from './export/export-service'
import type { ImageCodec, StripCapturer } from './export/types'
import { AgentRunner } from './agent/agent-runner'
import { PanelChatRunner } from './agent/panel-chat'
import { WorkflowDocs } from './agent/workflow-docs'
import { CharacterService, type PanelUsageLookup } from './domain/character-service'
import { ConsistencyChecker } from './domain/consistency-checker'
import { EpisodeService } from './domain/episode-service'
import type { ImageOps } from './domain/image-ops'
import { ImageService } from './domain/image-service'
import { ItemService, type ItemUsageLookup } from './domain/item-service'
import { PanelService } from './domain/panel-service'
import type { PackComposer } from './domain/reference-pack'
import { StoryService } from './domain/story-service'
import { EventBus } from './events/bus'
import { ModelRegistry } from './models/registry'
import { SecretStore, type Encryptor } from './models/secrets'
import { ActiveContext } from './plugins/active-context'
import { builtinPlugins } from './plugins'
import { PluginManager } from './plugins/plugin-manager'
import { SessionStore } from './sessions/session-store'
import { ProjectStore } from './storage/project-store'

export interface ServicesOptions {
  projectsRoot: string
  userDataDir: string
  /** Moves a path to the OS trash (Electron `shell.trashItem`). */
  trash: (absPath: string) => Promise<void>
  /** OS-keychain encryption for API keys (Electron `safeStorage`). */
  encryptor: Encryptor
  /** Folder holding the shipped workflow doc templates (`AGENTS.md` at its root). */
  templatesDir: string
  imageOps: ImageOps
  /** Draws packed reference images (an offscreen canvas). Without it, panels drop the references over an image model's cap. */
  packComposer?: PackComposer
  bus?: EventBus
  /** A fresh strip capturer per export job. Without it, using export throws. */
  createCapturer?: () => StripCapturer
  /** Image decode/encode for export. Without it, using export throws. */
  codec?: ImageCodec
  /** Where the export dialog starts. Default: `Exports` beside the projects folder. */
  exportsDir?: string
}

export interface Services {
  bus: EventBus
  projects: ProjectStore
  sessions: SessionStore
  secrets: SecretStore
  registry: ModelRegistry
  docs: WorkflowDocs
  imageOps: ImageOps
  images: ImageService
  checker: ConsistencyChecker
  characters: CharacterService
  items: ItemService
  episodes: EpisodeService
  panels: PanelService
  story: StoryService
  exports: ExportService
  agent: AgentRunner
  panelChat: PanelChatRunner
  activeContext: ActiveContext
  plugins: PluginManager
}

/** The one place main-process services are constructed and wired together. */
export async function createServices(opts: ServicesOptions): Promise<Services> {
  if (!fs.existsSync(join(opts.templatesDir, 'AGENTS.md'))) throw new Error(`Workflow doc templates not found at ${opts.templatesDir}`)
  const bus = opts.bus ?? new EventBus()
  const projects = new ProjectStore({ projectsRoot: opts.projectsRoot, bus })
  const sessions = new SessionStore(bus, opts.trash)
  const secrets = new SecretStore(join(opts.userDataDir, 'secrets.json'), opts.encryptor)
  await secrets.load()
  const registry = new ModelRegistry({ file: join(opts.userDataDir, 'models.json'), secrets, bus })
  await registry.load()
  const docs = new WorkflowDocs(opts.templatesDir)
  // Install on create and on open, so projects made before a template existed get it too.
  projects.addHooks({ onCreate: (ctx) => docs.install(ctx), onOpen: (ctx) => docs.install(ctx) })
  const images = new ImageService({ registry, imageOps: opts.imageOps })
  // The usage lookup is lazy so CharacterService can be built before PanelService exists.
  const usage: PanelUsageLookup = {
    panelsUsingCharacter: (ctx, characterId) => services.panels.panelsUsingCharacter(ctx, characterId),
    panelsUsingVariation: (ctx, variationId) => services.panels.panelsUsingVariation(ctx, variationId)
  }
  // The vision check is optional at run time: with no model on the `vision` role it returns null, and neither panels nor reference sheets are checked.
  const checker = new ConsistencyChecker({ registry, docs, imageOps: opts.imageOps })
  const characters = new CharacterService({ bus, images, projects, usage, trash: opts.trash, sheetChecker: checker })
  // Lazy for the same reason as `usage`: PanelService does not exist yet when ItemService is built.
  const itemUsage: ItemUsageLookup = {
    panelsUsingItem: (ctx, itemId) => services.panels.panelsUsingItem(ctx, itemId),
    panelsUsingItemUsage: (ctx, usageId) => services.panels.panelsUsingItemUsage(ctx, usageId)
  }
  const items = new ItemService({ bus, images, projects, usage: itemUsage, trash: opts.trash, sheetChecker: checker })
  const episodes = new EpisodeService({ bus })
  const panels = new PanelService({ bus, projects, episodes, characters, items, images, checker, trash: opts.trash, packComposer: opts.packComposer })
  const story = new StoryService({ bus, projects })
  const unavailable = (): never => {
    throw new Error('Export is not available in this build')
  }
  const exports = new ExportService({
    projects,
    episodes,
    panels,
    characters,
    bus,
    trash: opts.trash,
    createCapturer: opts.createCapturer ?? unavailable,
    codec: opts.codec ?? { toBitmap: unavailable, encode: unavailable, size: unavailable },
    exportsDir: opts.exportsDir ?? join(opts.projectsRoot, '..', 'Exports')
  })
  // A generation cannot survive the app closing, so a project's pending images are failed on open.
  projects.addHooks({ onOpen: (ctx) => characters.recoverInterrupted(ctx) })
  projects.addHooks({ onOpen: (ctx) => items.recoverInterrupted(ctx) })
  projects.addHooks({ onOpen: (ctx) => panels.recoverInterrupted(ctx) })
  const services = { bus, projects, sessions, secrets, registry, docs, imageOps: opts.imageOps, images, checker, characters, items, episodes, panels, story, exports } as Services
  services.agent = new AgentRunner({ services })
  services.panelChat = new PanelChatRunner({ services })
  services.activeContext = new ActiveContext()
  services.plugins = new PluginManager({
    file: join(opts.userDataDir, 'plugins.json'),
    plugins: builtinPlugins(),
    services,
    activeContext: services.activeContext
  })
  // A corrupt plugins.json is reported by `plugins.loadError()` and leaves every plugin off; it does not stop the app.
  await services.plugins.load()
  return services
}
