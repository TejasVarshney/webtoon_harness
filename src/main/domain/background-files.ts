import fs from 'node:fs'
import { BACKGROUND_DIR } from '@shared/strip-background'
import type { ProjectContext } from '../storage/project-store'

/**
 * Deletes a background image of this episode, never the one that is `kept`. Anything outside the episode's own folder
 * is left alone, and a failure is ignored: the change it follows is already saved.
 */
export async function removeBackgroundImage(ctx: ProjectContext, episodeId: string, rel: string | null, kept: string | null): Promise<void> {
  if (rel === null || rel === kept || !rel.startsWith(`${BACKGROUND_DIR}/${episodeId}/`) || rel.includes('..')) return
  try {
    await fs.promises.rm(ctx.paths.resolveAsset(rel), { force: true })
  } catch {
    // The file stays; nothing refers to it.
  }
}
