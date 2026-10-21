import { useEffect } from 'react'
import { ModelsTab } from './ModelsTab'

export interface SettingsDialogProps {
  onClose(): void
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop">
      <div className="modal settings-dialog" role="dialog" aria-label="Settings">
        <div className="section-header">
          <h2>Settings</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div role="tablist">
          <button type="button" role="tab" aria-selected="true">
            Models
          </button>
        </div>
        <ModelsTab />
      </div>
    </div>
  )
}
