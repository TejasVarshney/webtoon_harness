import { useCallback, useRef, useState } from 'react'
import type { DialogueLine, Panel } from '@shared/types'
import { usePanelsStore } from '../../stores/panels-store'
import { errorText } from '../characters/controls'
import type { DialogueDraftLine } from '../visualizer/DialogueEditor'

export interface DialogueSaver {
  /**
   * Saves the dialogue `build` makes from the panel's lines as the store has them now. A `null` from `build` means the
   * line it was changing is no longer what it was: nothing is sent, and `conflict` is set until the next save.
   */
  save(build: (current: DialogueLine[]) => DialogueDraftLine[] | null): Promise<void>
  conflict: boolean
  /** The last save the service refused. */
  error: string | null
}

function findPanel(panelId: string): Panel | undefined {
  for (const panels of Object.values(usePanelsStore.getState().panelsByEpisode)) {
    const found = panels.find((p) => p.id === panelId)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * Saves a panel's dialogue as a whole array, built at send time (spec §6). Saves wait for the one before them, so each
 * is built from the lines the last one left: two quick edits never send the same stale array, and the second never
 * undoes the first. A panel that left the store (R2) saves nothing.
 */
export function useDialogueSaver(panelId: string): DialogueSaver {
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const last = useRef<Promise<void>>(Promise.resolve())

  const save = useCallback(
    (build: (current: DialogueLine[]) => DialogueDraftLine[] | null): Promise<void> => {
      const run = last.current.then(async () => {
        const panel = findPanel(panelId)
        if (panel === undefined) return
        const dialogue = build(panel.dialogue)
        if (dialogue === null) {
          setConflict(true)
          return
        }
        setConflict(false)
        setError(null)
        try {
          await usePanelsStore.getState().updatePanel(panelId, { dialogue })
        } catch (e) {
          setError(errorText(e))
        }
      })
      // A build that throws fails its own save only, not the ones queued after it.
      last.current = run.catch(() => undefined)
      return run
    },
    [panelId]
  )

  return { save, conflict, error }
}
