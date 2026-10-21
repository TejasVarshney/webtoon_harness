import fs from 'node:fs'
import path from 'node:path'
import { newId } from '@shared/ids'
import type { Services } from '../../services'
import { writeFileAtomic } from '../../storage/atomic'
import type { HandlerMap } from './projects'

/** Shows the image picker over the window that sent `event`; resolves to the chosen absolute paths ([] on cancel). */
export type PickFiles = (event: unknown) => Promise<string[]>

export interface UploadsDeps {
  pickFiles?: PickFiles
}

/** Extensions the picker offers, mapped to the stored extension. */
const STORED_EXT: Record<string, string> = { '.png': 'png', '.jpg': 'jpg', '.jpeg': 'jpg', '.webp': 'webp' }

export function uploadsHandlers(s: Services, deps: UploadsDeps = {}): HandlerMap {
  const pickFiles = deps.pickFiles ?? (async () => [])
  return {
    'uploads:pickImages': async ({ projectId }, event) => {
      const ctx = await s.projects.open(projectId)
      const picked = await pickFiles(event)
      const paths: string[] = []
      for (const file of picked) {
        const ext = STORED_EXT[path.extname(file).toLowerCase()]
        if (!ext) continue
        const data = await fs.promises.readFile(file)
        const abs = path.join(ctx.paths.uploadsDir(), `${newId('upl')}.${ext}`)
        await ctx.mutex.run(abs, () => writeFileAtomic(abs, data))
        paths.push(ctx.paths.toRelative(abs))
      }
      return { paths }
    }
  }
}
