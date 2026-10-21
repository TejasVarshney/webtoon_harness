import { join } from 'node:path'
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
  bus?: EventBus
}

export interface Services {
  bus: EventBus
  projects: ProjectStore
  sessions: SessionStore
  registry: ModelRegistry
}

/** The one place main-process services are constructed and wired together. */
export async function createServices(opts: ServicesOptions): Promise<Services> {
  const bus = opts.bus ?? new EventBus()
  const projects = new ProjectStore({ projectsRoot: opts.projectsRoot, bus })
  const sessions = new SessionStore(bus, opts.trash)
  const secrets = new SecretStore(join(opts.userDataDir, 'secrets.json'), opts.encryptor)
  await secrets.load()
  const registry = new ModelRegistry({ file: join(opts.userDataDir, 'models.json'), secrets, bus })
  await registry.load()
  return { bus, projects, sessions, registry }
}
