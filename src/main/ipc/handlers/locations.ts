import fs from 'node:fs'
import path from 'node:path'
import { LocationInputSchema, LocationPatchSchema, LocationStateInputSchema } from '@shared/schemas'
import { EntityNotFoundError } from '../../domain/errors'
import type { Services } from '../../services'
import type { ProjectContext } from '../../storage/project-store'
import { parseInput } from '../validate'
import type { HandlerMap } from './projects'
import { STORED_EXT, type PickFiles } from './uploads'

// The twin of items.ts: a change here usually belongs there too.

export interface LocationsDeps {
  /** Shows the native file dialog. Absent (tests, headless) behaves like a cancelled dialog. */
  pickFiles?: PickFiles
}

/** Starts a task the caller does not wait for. Its outcome is recorded on the location and announced as `location.changed`. */
function inBackground(task: Promise<unknown>, what: string): void {
  task.catch((error: unknown) => console.error(`${what} failed`, error))
}

export function locationsHandlers(s: Services, deps: LocationsDeps = {}): HandlerMap {
  const { locations } = s
  const pickFiles: PickFiles = deps.pickFiles ?? (async () => [])

  /** The state must exist before any work (or a file dialog) starts. */
  async function requireState(ctx: ProjectContext, locationId: string, stateId: string) {
    const location = await locations.get(ctx, locationId)
    const state = location.states.find((st) => st.id === stateId)
    if (!state) throw new EntityNotFoundError('state', stateId)
    return state
  }

  return {
    'locations:list': async ({ projectId, includeArchived }) => locations.list(await s.projects.open(projectId), { includeArchived }),
    'locations:get': async ({ projectId, locationId }) => locations.get(await s.projects.open(projectId), locationId),

    'locations:create': async ({ projectId, input, generateBase }) => {
      const ctx = await s.projects.open(projectId)
      // `=== true`: a missing flag must not create a pending state that nothing will ever generate.
      const generate = generateBase === true
      const created = await locations.create(ctx, parseInput(LocationInputSchema, input), 'user', { generate })
      if (generate) inBackground(locations.generateStateImage(ctx, created.id, created.states[0].id), 'Location picture generation')
      return created
    },

    'locations:update': async ({ projectId, locationId, patch }) => {
      const { location } = await locations.update(await s.projects.open(projectId), locationId, parseInput(LocationPatchSchema, patch))
      return location
    },

    'locations:archive': async ({ projectId, locationId }) => locations.archive(await s.projects.open(projectId), locationId),
    'locations:unarchive': async ({ projectId, locationId }) => locations.unarchive(await s.projects.open(projectId), locationId),
    'locations:delete': async ({ projectId, locationId }) => locations.delete(await s.projects.open(projectId), locationId),

    'locations:addState': async ({ projectId, locationId, input, generate }) => {
      const ctx = await s.projects.open(projectId)
      const run = generate === true
      const added = await locations.addState(ctx, locationId, parseInput(LocationStateInputSchema, input), 'user', { generate: run })
      if (run) inBackground(locations.generateStateImage(ctx, locationId, added.id), 'State picture generation')
      return added
    },

    'locations:generateState': async ({ projectId, locationId, stateId }) => {
      const ctx = await s.projects.open(projectId)
      const state = await requireState(ctx, locationId, stateId)
      inBackground(locations.generateStateImage(ctx, locationId, stateId), 'State picture generation')
      // The service marks it pending as its first step; the caller can show that right away.
      return { ...state, status: 'pending', error: null }
    },

    'locations:deleteState': async ({ projectId, locationId, stateId }) => locations.deleteState(await s.projects.open(projectId), locationId, stateId),

    'locations:uploadStateImage': async ({ projectId, locationId, stateId }, event) => {
      const ctx = await s.projects.open(projectId)
      await requireState(ctx, locationId, stateId)
      const [file] = await pickFiles(event, { multiple: false, title: 'Choose a location picture' })
      if (file === undefined) return null
      const ext = STORED_EXT[path.extname(file).toLowerCase()]
      if (!ext) throw new Error('Unsupported image type: use png, jpg or webp')
      return locations.uploadStateImage(ctx, locationId, stateId, await fs.promises.readFile(file), ext)
    }
  }
}
