import { useCallback, useSyncExternalStore } from 'react'
import type { Panel, PanelPatch } from '@shared/types'
import { usePanelsStore } from '../../stores/panels-store'

// Focus mode's saves of one panel go one at a time, in the order they were made, whichever control made them:
// the stage, a row of the Lines tab or a field of another tab. Each is built when its turn comes, from the panel as the
// store has it then, or as the last save returned it while the store has not caught up: a reload that a later one
// superseded leaves the store as it was, and a save built from that would undo the one before it.

interface Queue {
  /** Settles when the last save queued has. */
  tail: Promise<void>
  /** Saves queued and not settled yet. */
  waiting: number
  /** Those saves themselves, for `whenSaved`: each goes once it settles. */
  runs: Set<Promise<SaveResult | null>>
  /** The panel as the last save returned it, until the store has one as new. */
  latest: Panel | null
}

export interface SaveResult {
  panel: Panel
  warnings: string[]
}

const queues = new Map<string, Queue>()

/** The warnings of a panel's last save, and what made it: a field's name, or `dialogue`. */
interface LastWarnings {
  by: string
  warnings: string[]
}

/**
 * Each panel's last save's warnings. The service checks the whole panel on every save, so the last save's warnings
 * replace the ones before, whoever made them (they show until the next save). Kept only while a tab shows them.
 */
const lastWarnings = new Map<string, { last: LastWarnings | null; listeners: Set<() => void> }>()

function recordWarnings(panelId: string, by: string, warnings: string[]): void {
  const entry = lastWarnings.get(panelId)
  if (entry === undefined) return
  entry.last = { by, warnings }
  entry.listeners.forEach((listener) => listener())
}

const NONE: string[] = []

/** The warnings of the panel's last save, when one of `by` made it: the tab that made a save shows them. */
export function useLastWarnings(panelId: string, by: readonly string[]): string[] {
  const subscribe = useCallback(
    (listener: () => void) => {
      const entry = lastWarnings.get(panelId) ?? { last: null, listeners: new Set<() => void>() }
      lastWarnings.set(panelId, entry)
      entry.listeners.add(listener)
      return () => {
        entry.listeners.delete(listener)
        if (entry.listeners.size === 0 && lastWarnings.get(panelId) === entry) lastWarnings.delete(panelId)
      }
    },
    [panelId]
  )
  const last = useSyncExternalStore(subscribe, () => lastWarnings.get(panelId)?.last ?? null)
  return last !== null && by.includes(last.by) ? last.warnings : NONE
}

/** The panel as the store has it, in whichever loaded episode has it. */
function findPanel(panelId: string): Panel | undefined {
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
 * or the panel left the store. Rejects when the service refuses a patch or `build` throws; neither holds up the
 * saves queued after it. `by` (a field's name, or `dialogue`) is what made the save: its warnings show there.
 */
export function queuePanelSave(panelId: string, build: (panel: Panel) => PanelPatch[], by: string): Promise<SaveResult | null> {
  return enqueue(panelId, async (panel, queue) => {
    let result: SaveResult | null = null
    for (const patch of build(panel)) {
      result = await usePanelsStore.getState().updatePanel(panelId, patch)
      queue.latest = result.panel
      recordWarnings(panelId, by, result.warnings)
    }
    return result
  })
}

/**
 * Stores the panel's layout sketch (a PNG data URL, or `null` to forget it) in turn with its other saves, so a redraw
 * that waits on `whenSaved` is drawn from the last stroke. Resolves to `null` when the panel left the store.
 */
export function queueSketchSave(panelId: string, png: string | null): Promise<SaveResult | null> {
  return enqueue(panelId, async (_panel, queue) => {
    const panel = await usePanelsStore.getState().saveSketch(panelId, png)
    queue.latest = panel
    return { panel, warnings: [] }
  })
}

/** Runs `work` once the panel's saves queued before it have settled, with the panel as the last of them left it. */
function enqueue(panelId: string, work: (panel: Panel, queue: Queue) => Promise<SaveResult | null>): Promise<SaveResult | null> {
  const queue = queues.get(panelId) ?? { tail: Promise.resolve(), waiting: 0, runs: new Set(), latest: null }
  queues.set(panelId, queue)
  queue.waiting += 1
  const run = queue.tail.then(async () => {
    const stored = findPanel(panelId)
    if (stored === undefined) return null
    return work(caughtUp(stored, queue) ? stored : queue.latest!, queue)
  })
  queue.runs.add(run)
  const settle = (): void => {
    queue.waiting -= 1
    queue.runs.delete(run)
    // A queue that ran dry is forgotten once the store has caught up with it; until then its last save stays the base.
    if (queue.waiting === 0 && queues.get(panelId) === queue && caughtUp(findPanel(panelId), queue)) queues.delete(panelId)
  }
  queue.tail = run.then(settle, settle)
  return run
}

/**
 * Settles once every save of the panel queued so far has, so a redraw or an upload works from the fields as the user
 * left them (a field is saved when it is left, which comes before the click). Rejects with the first of those saves the
 * service refused: what waits on it does not run, as the field keeps the refused draft.
 */
export async function whenSaved(panelId: string): Promise<void> {
  const queue = queues.get(panelId)
  if (queue === undefined) return
  const refused = (await Promise.allSettled([...queue.runs])).find((outcome) => outcome.status === 'rejected')
  if (refused !== undefined) throw refused.reason
}
