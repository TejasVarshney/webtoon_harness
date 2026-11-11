import type { ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { useGenerateStore } from '../../stores/generate-store'

export interface AddPanelButtonProps {
  episodeId: string
  /** Only one button on the screen carries the `add-panel` testid. */
  testId?: string
  className?: string
  /** What the button shows. Default is a "+". */
  children?: ReactNode
}

/**
 * Opens the Generate page for a new panel at the end of the episode, drawing from no other panel. The page makes
 * the panel: a drawn one, or a blank one the user fills in later.
 */
export function AddPanelButton({ episodeId, testId, className, children }: AddPanelButtonProps) {
  return (
    <div className="add-panel">
      <button type="button" className={className} data-testid={testId} aria-label="Add panel" title="Add a panel" onClick={() => useGenerateStore.getState().open({ episodeId, referencePanelIds: [] })}>
        {children ?? <Plus size={20} aria-hidden="true" />}
      </button>
    </div>
  )
}
