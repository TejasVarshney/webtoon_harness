// Which panels an export can draw. Mirrors PanelArt: a panel shows the version it points at, if that one is ready.

import type { Panel } from '@shared/types'

/** Whether the panel's current version is ready, so there is an image to draw. A newer failed attempt does not matter. */
export function isFinished(panel: Panel): boolean {
  return panel.versions.find((v) => v.id === panel.currentVersionId)?.status === 'ready'
}

/**
 * Why an unfinished panel has no image: `generating` when its newest version is pending, `failed` when that one
 * failed, `none` when it has no versions. Null when the panel is finished.
 */
export function unfinishedReason(panel: Panel): 'none' | 'generating' | 'failed' | null {
  if (isFinished(panel)) return null
  const newest = panel.versions.at(-1)
  if (!newest) return 'none'
  return newest.status === 'pending' ? 'generating' : 'failed'
}
