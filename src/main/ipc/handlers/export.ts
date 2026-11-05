import fs from 'node:fs'
import path from 'node:path'
import { ExportInspectRequestSchema, ExportRequestSchema } from '@shared/schemas'
import type { Services } from '../../services'
import type { HandlerMap } from './projects'

/**
 * Shows the save dialog over the window that sent `event`; resolves to the chosen absolute path, null on cancel.
 * `defaultPath` is left out when the Exports folder could not be made.
 */
export type ChooseExportTarget = (
  event: unknown,
  o: { kind: 'file' | 'folder'; defaultPath?: string; extension: string | null }
) => Promise<string | null>

/**
 * The test hook that stands in for the save dialog: a folder in `WEBTOON_EXPORT_TARGET`, honoured only when the app
 * is not packaged. A file goes in that folder under the name the dialog would have offered. Null when it does not apply.
 */
export function fixedExportTarget(
  envTarget: string | undefined,
  isPackaged: boolean,
  o: { kind: 'file' | 'folder'; defaultPath?: string; extension: string | null }
): string | null {
  if (isPackaged || !envTarget) return null
  if (o.kind === 'folder') return envTarget
  return path.join(envTarget, path.basename(o.defaultPath ?? `export${o.extension ? `.${o.extension}` : ''}`))
}

export interface ExportDeps {
  chooseExportTarget?: ChooseExportTarget
  showItemInFolder?: (absPath: string) => void
}

/** Export jobs. The renderer's request is parsed here; `reveal` takes a job id only, never a path. */
export function exportHandlers(s: Services, deps: ExportDeps = {}): HandlerMap {
  return {
    'export:inspect': async (raw) => {
      const { projectId, episodeIds } = ExportInspectRequestSchema.parse(raw)
      return s.exports.inspect(projectId, episodeIds)
    },
    'export:start': async (raw, event) => {
      const req = ExportRequestSchema.parse(raw)
      if (!deps.chooseExportTarget) return { cancelled: true }
      // The dialog still opens without the Exports folder, just with no starting place.
      const hasExportsDir = await fs.promises.mkdir(s.exports.exportsDir, { recursive: true }).then(
        () => true,
        (error: unknown) => {
          console.warn(`Export: could not create ${s.exports.exportsDir}`, error)
          return false
        }
      )
      const kind = s.exports.targetKind(req)
      let defaultPath = s.exports.exportsDir
      let extension: string | null = null
      if (kind === 'file') {
        const name = await s.exports.suggestedName(req)
        defaultPath = path.join(s.exports.exportsDir, name)
        extension = path.extname(name).slice(1) || null
      }
      const target = await deps.chooseExportTarget(event, hasExportsDir ? { kind, defaultPath, extension } : { kind, extension })
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
