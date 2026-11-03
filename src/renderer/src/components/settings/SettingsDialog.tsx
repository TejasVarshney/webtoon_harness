import { useEffect, useState } from 'react'
import { ModelsTab } from './ModelsTab'
import { PluginsTab } from './PluginsTab'
import { WorkflowDocsTab } from './WorkflowDocsTab'

export interface SettingsDialogProps {
  onClose(): void
}

type SettingsTab = 'models' | 'docs' | 'plugins'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'models', label: 'Models' },
  { id: 'docs', label: 'Workflow docs' },
  { id: 'plugins', label: 'Plugins' }
]

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>('models')

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
        <div className="tab-bar" role="tablist" aria-label="Settings sections">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        {/* Only the active tab is mounted: each loads its own data when shown. */}
        {tab === 'models' ? <ModelsTab /> : tab === 'docs' ? <WorkflowDocsTab /> : <PluginsTab />}
      </div>
    </div>
  )
}
