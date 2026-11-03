import { useCallback, useSyncExternalStore } from 'react'
import type { DialogueLine } from '@shared/types'
import { errorText } from '../characters/controls'
import type { DialogueDraftLine } from '../visualizer/DialogueEditor'
import { queuePanelSave } from './panel-save-queue'

/** What became of a save: sent and kept, not sent because the line changed, refused by the service, or not sent because the panel is gone (R2). */
export type DialogueSaveOutcome = 'saved' | 'conflict' | 'refused' | 'skipped'

export interface DialogueSaver {
  /**
   * Saves the dialogue `build` makes from the panel's lines as they are when its turn comes. A `null` from `build`
   * means the line it was changing is no longer what it was: nothing is sent, and `conflict` is set until the next save.
   */
  save(build: (current: DialogueLine[]) => DialogueDraftLine[] | null): Promise<DialogueSaveOutcome>
  conflict: boolean
  /** The last save the service refused. */
  error: string | null
  /** Counts the conflicts and refusals reported, so a view can tell a new one from one it already showed. */
  reported: number
  /** Forgets the refusal: "Undo my change". */
  clear(): void
}

interface Notice {
  conflict: boolean
  error: string | null
  reported: number
}

const QUIET: Notice = { conflict: false, error: null, reported: 0 }

/**
 * Each panel's last conflict and refusal, shared by every saver of it (the stage and the Lines tab), so one message
 * shows once whichever of them made the save. Kept only while something shows it: the next editing of the panel starts
 * quiet.
 */
const notices = new Map<string, { notice: Notice; listeners: Set<() => void> }>()

function subscribe(panelId: string, listener: () => void): () => void {
  const entry = notices.get(panelId) ?? { notice: QUIET, listeners: new Set<() => void>() }
  notices.set(panelId, entry)
  entry.listeners.add(listener)
  return () => {
    entry.listeners.delete(listener)
    if (entry.listeners.size === 0 && notices.get(panelId) === entry) notices.delete(panelId)
  }
}

function report(panelId: string, change: Partial<Omit<Notice, 'reported'>>, counts: boolean): void {
  const entry = notices.get(panelId)
  if (entry === undefined) return
  const { conflict = entry.notice.conflict, error = entry.notice.error } = change
  if (!counts && conflict === entry.notice.conflict && error === entry.notice.error) return
  entry.notice = { ...entry.notice, ...change, reported: entry.notice.reported + (counts ? 1 : 0) }
  entry.listeners.forEach((listener) => listener())
}

/**
 * Saves a panel's dialogue as a whole array, built at send time (spec §6). The saves of a panel wait for the ones
 * before them, whichever saver made them (`queuePanelSave`), so each is built from the lines the last one left: two
 * quick edits never send the same stale array, and the second never undoes the first. A panel that left the store
 * (R2) saves nothing.
 */
export function useDialogueSaver(panelId: string): DialogueSaver {
  const notice = useSyncExternalStore(
    useCallback((listener: () => void) => subscribe(panelId, listener), [panelId]),
    () => notices.get(panelId)?.notice ?? QUIET
  )

  const save = useCallback(
    (build: (current: DialogueLine[]) => DialogueDraftLine[] | null): Promise<DialogueSaveOutcome> => {
      let conflict = false
      return queuePanelSave(panelId, (panel) => {
        const dialogue = build(panel.dialogue)
        if (dialogue === null) {
          conflict = true
          report(panelId, { conflict: true }, true)
          return []
        }
        report(panelId, { conflict: false, error: null }, false)
        return [{ dialogue }]
      }).then(
        (result) => (conflict ? 'conflict' : result === null ? 'skipped' : 'saved'),
        (e: unknown) => {
          report(panelId, { error: errorText(e) }, true)
          return 'refused'
        }
      )
    },
    [panelId]
  )

  const clear = useCallback(() => report(panelId, { error: null }, false), [panelId])

  return { save, conflict: notice.conflict, error: notice.error, reported: notice.reported, clear }
}
