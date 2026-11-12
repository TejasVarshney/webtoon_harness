import { Redo2, Undo2 } from 'lucide-react'
import { nextStep, useStripHistoryStore } from '../../stores/strip-history-store'
import { stepStrip } from './strip-undo'

/** The modifier the undo keys use here, as a title names it. */
const MOD = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? 'Cmd' : 'Ctrl'

export interface StripUndoButtonsProps {
  episodeId: string | null
  /** Something else has the strip for now (the Background editor is open): both buttons wait. */
  held?: boolean
}

/**
 * The episode bar's Undo and Redo. Each names the step it would take back or put back, and is off when there is none or
 * one is running. Why the last one did nothing (the strip changed since, or the service refused) shows beside them.
 */
export function StripUndoButtons({ episodeId, held = false }: StripUndoButtonsProps) {
  const undo = useStripHistoryStore((s) => nextStep(s, 'undo', episodeId))
  const redo = useStripHistoryStore((s) => nextStep(s, 'redo', episodeId))
  const busy = useStripHistoryStore((s) => s.busy)
  const notice = useStripHistoryStore((s) => (s.notice !== null && s.notice.episodeId === episodeId ? s.notice.text : null))

  return (
    <>
      <span className="strip-undo" role="group" aria-label="Undo and redo">
        <button
          type="button"
          className="icon-button"
          aria-label="Undo"
          title={undo === null ? 'Nothing to undo' : `Undo ${undo.label} (${MOD}+Z)`}
          disabled={undo === null || busy || held || episodeId === null}
          onClick={() => episodeId !== null && void stepStrip('undo', episodeId)}
        >
          <Undo2 size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Redo"
          title={redo === null ? 'Nothing to redo' : `Redo ${redo.label} (${MOD}+Shift+Z)`}
          disabled={redo === null || busy || held || episodeId === null}
          onClick={() => episodeId !== null && void stepStrip('redo', episodeId)}
        >
          <Redo2 size={16} aria-hidden="true" />
        </button>
      </span>
      {notice !== null && (
        <p role="status" className="hint strip-undo-notice">
          {notice}
        </p>
      )}
    </>
  )
}
