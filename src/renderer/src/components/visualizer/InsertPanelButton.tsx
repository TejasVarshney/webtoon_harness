import { useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { useAppStore } from '../../stores/app-store'
import { usePanelsStore } from '../../stores/panels-store'
import { errorText } from '../characters/controls'

export interface InsertPanelButtonProps {
  episodeId: string
  /** The panel the new one goes right after. Absent appends to the episode. */
  afterPanelId?: string
}

/**
 * The "+" between two panels and at the end of the strip: makes a blank panel there, with no image, and opens it in
 * editing mode, where the user sketches the scene, fills in its details and generates it. One click makes one panel.
 */
export function InsertPanelButton({ episodeId, afterPanelId }: InsertPanelButtonProps) {
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [error, setError] = useState<string | null>(null)

  async function add(): Promise<void> {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      const { panel } = await usePanelsStore.getState().createPanel(
        { episodeId, ...(afterPanelId !== undefined ? { afterPanelId } : {}), description: '', setting: '', shot: 'medium', characters: [], dialogue: [] },
        false
      )
      useAppStore.getState().selectPanel(panel.id)
    } catch (e) {
      setError(errorText(e))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <div className="insert-panel">
      <button type="button" className="insert-panel-button" data-testid="add-panel" aria-label="Add panel" title="Add a panel here" disabled={busy} onClick={() => void add()}>
        <Plus size={16} aria-hidden="true" />
      </button>
      {error !== null && (
        <p role="alert" className="error insert-panel-error">
          {error}
        </p>
      )}
    </div>
  )
}
