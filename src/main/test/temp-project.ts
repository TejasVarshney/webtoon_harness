import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AppEvent } from '@shared/types'
import { EventBus } from '../events/bus'
import { ProjectStore, type ProjectContext } from '../storage/project-store'

export interface TempProject {
  store: ProjectStore
  /** The one project the helper created (title "Test Project"). */
  ctx: ProjectContext
  bus: EventBus
  /**
   * Every event emitted on `bus` since the store was built, including the `project.changed` for the
   * project created here. Clear it (`events.length = 0`) to assert on only what a test does next.
   */
  events: AppEvent[]
  /** The projects root. Its path contains a space, so code under test must cope with one. */
  root: string
  cleanup(): Promise<void>
}

/** A real `ProjectStore` on a throwaway directory, with one project created. Call `cleanup()` in `afterEach`. */
export async function tempProject(): Promise<TempProject> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'webtoon test projects '))
  const bus = new EventBus()
  const events: AppEvent[] = []
  bus.subscribe((event) => events.push(event))
  const store = new ProjectStore({ projectsRoot: root, bus })
  try {
    const ctx = await store.create({ title: 'Test Project' })
    return { store, ctx, bus, events, root, cleanup: () => fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5 }) }
  } catch (error) {
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5 })
    throw error
  }
}
