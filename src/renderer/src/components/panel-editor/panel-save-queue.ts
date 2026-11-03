import type { Panel, PanelPatch } from '@shared/types'
import { usePanelsStore } from '../../stores/panels-store'

// The editing mode's saves of one panel go one at a time, in the order they were made, whichever control made them:
// the stage, a row of the Lines tab or a field of another tab. Each is built when its turn comes, from the panel as the
// store has it then, or as the last save returned it while the store has not caught up: a reload that a later one
// superseded leaves the store as it was, and a save built from that would undo the one before it.

interface Queue {
  /** Settles when the last save queued has. */
  tail: Promise<void>
  /** Saves queued and not settled yet. */
  waiting: number
  /** The panel as the last save returned it, until the store has one as new. */
  latest: Panel | null
}

export interface SaveResult {
  panel: Panel
  warnings: string[]
}

const queues = new Map<string, Queue>()

/** The panel as the store has it, in whichever loaded episode has it. */
export function findPanel(panelId: string): Panel | undefined {
  for (const panels of Object.values(usePanelsStore.getState().panelsByEpisode)) {
    const found = panels.find((p) => p.id === panelId)
    if (found !== undefined) return found
  }
  return undefined
}

/** The store has the panel as new as the last save left it, or newer (an agent edit made since), or has no panel at all. */
function caughtUp(stored: Panel | undefined, queue: Queue): boolean {
  return stored === undefined || queue.latest === null || stored.updatedAt >= queue.latest.updatedAt
}

/**
 * Sends the patches `build` makes of the panel, in order, once the saves queued before them have settled. A refused
 * patch stops the ones after it. Resolves to the last result, or `null` when nothing was sent: `build` made no patch,
 * or the panel left the store (R2). Rejects when the service refuses a patch or `build` throws; neither holds up the
 * saves queued after it.
 */
export function queuePanelSave(panelId: string, build: (panel: Panel) => PanelPatch[]): Promise<SaveResult | null> {
  const queue = queues.get(panelId) ?? { tail: Promise.resolve(), waiting: 0, latest: null }
  queues.set(panelId, queue)
  queue.waiting += 1
  const run = queue.tail.then(async () => {
    const stored = findPanel(panelId)
    if (stored === undefined) return null
    const panel = caughtUp(stored, queue) ? stored : queue.latest!
    let result: SaveResult | null = null
    for (const patch of build(panel)) {
      result = await usePanelsStore.getState().updatePanel(panelId, patch)
      queue.latest = result.panel
    }
    return result
  })
  const settle = (): void => {
    queue.waiting -= 1
    // A queue that ran dry is forgotten once the store has caught up with it; until then its last save stays the base.
    if (queue.waiting === 0 && queues.get(panelId) === queue && caughtUp(findPanel(panelId), queue)) queues.delete(panelId)
  }
  queue.tail = run.then(settle, settle)
  return run
}
