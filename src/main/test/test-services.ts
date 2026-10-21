import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServices, type Services, type ServicesOptions } from '../services'

export interface TestServices extends Services {
  projectsRoot: string
  userDataDir: string
  /** Every path handed to the default `trash` double, in order. */
  trashed: string[]
  cleanup(): Promise<void>
}

/**
 * Real services on throwaway directories (their paths contain a space), with test doubles for every
 * Electron-backed option. Any task that adds a `ServicesOptions` field also gives it a default here.
 */
export async function testServices(overrides: Partial<ServicesOptions> = {}): Promise<TestServices> {
  const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'webtoon test services '))
  const projectsRoot = overrides.projectsRoot ?? path.join(base, 'projects')
  const userDataDir = overrides.userDataDir ?? path.join(base, 'user data')
  const trashed: string[] = []
  const trash =
    overrides.trash ??
    (async (p: string) => {
      trashed.push(p)
    })
  const services = await createServices({ ...overrides, projectsRoot, userDataDir, trash })
  return {
    ...services,
    projectsRoot,
    userDataDir,
    trashed,
    cleanup: () => fs.promises.rm(base, { recursive: true, force: true, maxRetries: 5 })
  }
}
