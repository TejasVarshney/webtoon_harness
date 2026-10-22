import { z } from 'zod'
import { EntityNotFoundError } from '../../domain/errors'
import type { Services } from '../../services'
import type { HandlerMap } from './projects'

/** Opens a file in the system's default app (Electron `shell.openPath`): resolves to an error message, '' on success. */
export type OpenPath = (absPath: string) => Promise<string>

export interface DocsDeps {
  openPath?: OpenPath
}

/** The Settings → Workflow docs tab: list, open in the system editor, reset to the shipped defaults. */
export function docsHandlers(s: Services, deps: DocsDeps = {}): HandlerMap {
  const openPath: OpenPath = deps.openPath ?? (async () => 'Opening files is not available here')
  return {
    'docs:list': async ({ projectId }) => s.docs.list(await s.projects.open(projectId), { includeAgents: true }),
    'docs:open': async ({ projectId, name }) => {
      const ctx = await s.projects.open(projectId)
      const wanted = z.string().parse(name)
      // Only a listed doc is opened, so no name can reach a file outside the project's docs folder.
      const listed = await s.docs.list(ctx, { includeAgents: true })
      if (!listed.some((d) => d.name === wanted)) throw new EntityNotFoundError('doc', wanted)
      const failure = await openPath(s.docs.filePath(ctx, wanted))
      if (failure !== '') throw new Error(`Could not open ${wanted}.md: ${failure}`)
    },
    'docs:reset': async ({ projectId }) => s.docs.reset(await s.projects.open(projectId))
  }
}
