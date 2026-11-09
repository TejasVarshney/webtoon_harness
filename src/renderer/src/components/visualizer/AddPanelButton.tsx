import { useRef, useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { useAppStore } from '../../stores/app-store'
import { usePanelsStore } from '../../stores/panels-store'
import { errorText } from '../characters/controls'

export interface AddPanelButtonProps {
  episodeId: string
  /** Only one button on the screen carries the `add-panel` testid. */
  testId?: string
  className?: string
  /** What the button shows. Default is a "+". */
  children?: ReactNode
}

/**
 * Appends a blank panel to the episode, with no image, and opens it in editing mode, where the user sketches the scene,
 * fills in its details and generates it. One click makes one panel.
 */
export function AddPanelButton({ episodeId, testId, className, children }: AddPanelButtonProps) {
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [error, setError] = useState<string | null>(null)

  async function add(): Promise<void> {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      const { panel } = await usePanelsStore.getState().createPanel({ episodeId, description: '', setting: '', shot: 'medium', characters: [], dialogue: [] }, false)
      useAppStore.getState().focusPanel(panel.id)
    } catch (e) {
      setError(errorText(e))
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <div className="add-panel">
      <button type="button" className={className} data-testid={testId} aria-label="Add panel" title="Add a panel" disabled={busy} onClick={() => void add()}>
        {children ?? <Plus size={20} aria-hidden="true" />}
      </button>
      {error !== null && (
        <p role="alert" className="error add-panel-error">
          {error}
        </p>
      )}
    </div>
  )
}
