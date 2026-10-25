import { useState } from 'react'
import { Plus } from 'lucide-react'
import { PanelEditorDialog } from './PanelEditorDialog'

export interface InsertPanelButtonProps {
  episodeId: string
  /** The panel the new one goes right after. Absent appends to the episode. */
  afterPanelId?: string
}

/** Where an open editor inserts. Held in state so the insert point is the one that was clicked, whatever the props become. */
interface Target {
  afterPanelId: string | undefined
}

/** The "+" between two panels and at the end of the strip: opens the editor to create a panel there. */
export function InsertPanelButton({ episodeId, afterPanelId }: InsertPanelButtonProps) {
  const [target, setTarget] = useState<Target | null>(null)
  return (
    <div className="insert-panel">
      <button type="button" className="insert-panel-button" data-testid="add-panel" aria-label="Add panel" title="Add a panel here" onClick={() => setTarget({ afterPanelId })}>
        <Plus size={16} aria-hidden="true" />
      </button>
      {target !== null && <PanelEditorDialog mode="create" episodeId={episodeId} afterPanelId={target.afterPanelId} onClose={() => setTarget(null)} />}
    </div>
  )
}
