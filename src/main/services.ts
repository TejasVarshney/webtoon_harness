import { EventBus } from './events/bus'
import { SessionStore } from './sessions/session-store'
import { ProjectStore } from './storage/project-store'

export interface ServicesOptions {
  projectsRoot: string
  userDataDir: string
  /** Moves a path to the OS trash (Electron `shell.trashItem`). */
  trash: (absPath: string) => Promise<void>
  bus?: EventBus
}

export interface Services {
  bus: EventBus
  projects: ProjectStore
  sessions: SessionStore
}

/** The one place main-process services are constructed and wired together. */
export async function createServices(opts: ServicesOptions): Promise<Services> {
  const bus = opts.bus ?? new EventBus()
  const projects = new ProjectStore({ projectsRoot: opts.projectsRoot, bus })
  const sessions = new SessionStore(bus, opts.trash)
  return { bus, projects, sessions }
}
