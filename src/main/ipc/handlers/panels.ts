import fs from 'node:fs'
import path from 'node:path'
import { PanelDraftSchema, PanelPatchSchema } from '@shared/schemas'
import { PanelValidationError } from '../../domain/panel-service'
import type { Services } from '../../services'
import type { HandlerMap } from './projects'
import { STORED_EXT, type PickFiles } from './uploads'

export interface PanelsDeps {
  /** Shows the native file dialog. Absent (tests, headless) behaves like a cancelled dialog. */
  pickFiles?: PickFiles
}

/** Starts a task the caller does not wait for. Its outcome is recorded on the panel and announced as `panel.changed`. */
function inBackground(task: Promise<unknown>, what: string): void {
  task.catch((error: unknown) => console.error(`${what} failed`, error))
}

/**
 * The renderer shows an error's message as it is. A validation failure travels as a plain `Error`
 * (Electron prefixes the error's name, which `cleanIpcError` only strips for `Error`) holding one issue per line.
 */
async function showIssues<T>(task: Promise<T>): Promise<T> {
  try {
    return await task
  } catch (error) {
    if (error instanceof PanelValidationError) throw new Error(error.issues.join('\n'))
    throw error
  }
}

/** Episodes and the panels in them. */
export function panelsHandlers(s: Services, deps: PanelsDeps = {}): HandlerMap {
  const { episodes, panels } = s
  const pickFiles: PickFiles = deps.pickFiles ?? (async () => [])

  return {
    'episodes:list': async ({ projectId }) => episodes.list(await s.projects.open(projectId)),
    'episodes:create': async ({ projectId, title, synopsis }) => episodes.create(await s.projects.open(projectId), { title, synopsis }),
    'episodes:update': async ({ projectId, episodeId, patch }) => episodes.update(await s.projects.open(projectId), episodeId, patch),

    'panels:list': async ({ projectId, episodeId }) => panels.list(await s.projects.open(projectId), episodeId),
    'panels:get': async ({ projectId, panelId }) => panels.get(await s.projects.open(projectId), panelId),

    'panels:create': async ({ projectId, draft, generate }) => {
      const ctx = await s.projects.open(projectId)
      // The manual editor is lenient: a mention of a character who is not attached is a warning, not an error.
      const created = await showIssues(panels.create(ctx, PanelDraftSchema.parse(draft), { createdBy: 'user', strictMentions: false }))
      if (generate) inBackground(panels.generate(ctx, created.panel.id), 'Panel image generation')
      return created
    },

    'panels:update': async ({ projectId, panelId, patch }) =>
      showIssues(panels.update(await s.projects.open(projectId), panelId, PanelPatchSchema.parse(patch), { strictMentions: false })),

    'panels:generate': async ({ projectId, panelId }) => {
      const ctx = await s.projects.open(projectId)
      // An unknown panel must be refused here: in the background it would only be logged.
      await panels.get(ctx, panelId)
      inBackground(panels.generate(ctx, panelId), 'Panel image generation')
    },

    'panels:delete': async ({ projectId, panelId }) => panels.delete(await s.projects.open(projectId), panelId),
    'panels:move': async ({ projectId, panelId, toIndex }) => panels.move(await s.projects.open(projectId), panelId, toIndex),
    'panels:revert': async ({ projectId, panelId, versionId }) => panels.revert(await s.projects.open(projectId), panelId, versionId),

    'panels:uploadImage': async ({ projectId, panelId }, event) => {
      const ctx = await s.projects.open(projectId)
      await panels.get(ctx, panelId)
      const [file] = await pickFiles(event, { multiple: false, title: 'Choose a panel image' })
      if (file === undefined) return null
      const ext = STORED_EXT[path.extname(file).toLowerCase()]
      if (!ext) throw new Error('Unsupported image type: use png, jpg or webp')
      return panels.uploadImage(ctx, panelId, await fs.promises.readFile(file), ext)
    }
  }
}
