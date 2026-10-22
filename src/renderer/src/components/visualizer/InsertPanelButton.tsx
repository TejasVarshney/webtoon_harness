import { useState } from 'react'
import { PanelEditorDialog } from './PanelEditorDialog'

export interface InsertPanelButtonProps {
  episodeId: string
  /** The panel the new one goes right after. Absent appends to the episode. */
  afterPanelId?: string
}

/** The "+" between two panels and at the end of the strip: opens the editor to create a panel there. */
export function InsertPanelButton({ episodeId, afterPanelId }: InsertPanelButtonProps) {
  const [open, setOpen] = useState(false)
  return (
    <div className="insert-panel">
      <button type="button" className="insert-panel-button" data-testid="add-panel" aria-label="Add panel" title="Add a panel here" onClick={() => setOpen(true)}>
        +
      </button>
      {open && <PanelEditorDialog mode="create" episodeId={episodeId} afterPanelId={afterPanelId} onClose={() => setOpen(false)} />}
    </div>
  )
}
