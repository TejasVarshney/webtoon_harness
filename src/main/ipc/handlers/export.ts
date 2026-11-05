import fs from 'node:fs'
import path from 'node:path'
import { ExportRequestSchema } from '@shared/schemas'
import type { Services } from '../../services'
import type { HandlerMap } from './projects'

/** Shows the save dialog over the window that sent `event`; resolves to the chosen absolute path, null on cancel. */
export type ChooseExportTarget = (
  event: unknown,
  o: { kind: 'file' | 'folder'; defaultPath: string; extension: string | null }
) => Promise<string | null>

export interface ExportDeps {
  chooseExportTarget?: ChooseExportTarget
  showItemInFolder?: (absPath: string) => void
}

/** Export jobs. The renderer's request is parsed here; `reveal` takes a job id only, never a path. */
export function exportHandlers(s: Services, deps: ExportDeps = {}): HandlerMap {
  return {
    'export:inspect': async ({ projectId, episodeIds }) => s.exports.inspect(projectId, episodeIds),
    'export:start': async (raw, event) => {
      const req = ExportRequestSchema.parse(raw)
      if (!deps.chooseExportTarget) return { cancelled: true }
      await fs.promises.mkdir(s.exports.exportsDir, { recursive: true })
      const kind = s.exports.targetKind(req)
      let defaultPath = s.exports.exportsDir
      let extension: string | null = null
      if (kind === 'file') {
        const name = await s.exports.suggestedName(req)
        defaultPath = path.join(s.exports.exportsDir, name)
        extension = path.extname(name).slice(1) || null
      }
      const target = await deps.chooseExportTarget(event, { kind, defaultPath, extension })
      if (!target) return { cancelled: true }
      return s.exports.start(req, target)
    },
    'export:cancel': async ({ jobId }) => s.exports.cancel(jobId),
    'export:reveal': async ({ jobId }) => {
      const [first] = s.exports.outputsOf(jobId)
      if (first) deps.showItemInFolder?.(first)
    }
  }
}
