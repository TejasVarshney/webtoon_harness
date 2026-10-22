import fs from 'node:fs'
import { join } from 'node:path'
import { AgentRunner } from './agent/agent-runner'
import { PanelChatRunner } from './agent/panel-chat'
import { WorkflowDocs } from './agent/workflow-docs'
import { CharacterService, type PanelUsageLookup } from './domain/character-service'
import { ConsistencyChecker } from './domain/consistency-checker'
import { EpisodeService } from './domain/episode-service'
import type { ImageOps } from './domain/image-ops'
import { ImageService } from './domain/image-service'
import { PanelService } from './domain/panel-service'
import { StoryService } from './domain/story-service'
import { EventBus } from './events/bus'
import { ModelRegistry } from './models/registry'
import { SecretStore, type Encryptor } from './models/secrets'
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
  bus?: EventBus
}

export interface Services {
  bus: EventBus
  projects: ProjectStore
  sessions: SessionStore
  registry: ModelRegistry
  docs: WorkflowDocs
  imageOps: ImageOps
  images: ImageService
  checker: ConsistencyChecker
  characters: CharacterService
  episodes: EpisodeService
  panels: PanelService
  story: StoryService
  agent: AgentRunner
  panelChat: PanelChatRunner
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
  // Ruling T12a: install on create and on open, so projects made before a template existed get it too.
  projects.addHooks({ onCreate: (ctx) => docs.install(ctx), onOpen: (ctx) => docs.install(ctx) })
  const images = new ImageService({ registry, imageOps: opts.imageOps })
  // Ruling P6: the usage lookup is lazy so CharacterService can be built before PanelService exists.
  const usage: PanelUsageLookup = {
    panelsUsingCharacter: (ctx, characterId) => services.panels.panelsUsingCharacter(ctx, characterId),
    panelsUsingVariation: (ctx, variationId) => services.panels.panelsUsingVariation(ctx, variationId)
  }
  const characters = new CharacterService({ bus, images, projects, usage, trash: opts.trash })
  const episodes = new EpisodeService({ bus })
  // The vision check is optional at run time: with no model on the `vision` role it returns null and panels are not checked.
  const checker = new ConsistencyChecker({ registry, docs, imageOps: opts.imageOps })
  const panels = new PanelService({ bus, projects, episodes, characters, images, checker, trash: opts.trash })
  const story = new StoryService({ bus, projects })
  // A generation cannot survive the app closing, so a project's pending images are failed on open.
  projects.addHooks({ onOpen: (ctx) => characters.recoverInterrupted(ctx) })
  projects.addHooks({ onOpen: (ctx) => panels.recoverInterrupted(ctx) })
  const services = { bus, projects, sessions, registry, docs, imageOps: opts.imageOps, images, checker, characters, episodes, panels, story } as Services
  services.agent = new AgentRunner({ services })
  services.panelChat = new PanelChatRunner({ services })
  return services
}
