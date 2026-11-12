import { X } from 'lucide-react'
import { assetUrl } from '@shared/asset-url'
import type { Panel } from '@shared/types'
import { useAppStore } from '../../stores/app-store'

export interface ReferenceRowProps {
  panel: Panel
  /** Its place in the episode. */
  number: number
  onRemove(): void
}

/** One chosen panel: its picture, its number in the episode, and a way to leave it out. */
export function ReferenceRow({ panel, number, onRemove }: ReferenceRowProps) {
  const projectId = useAppStore((s) => s.projectId)
  const current = panel.versions.find((v) => v.id === panel.currentVersionId)
  const imagePath = current?.status === 'ready' ? current.imagePath : null
  return (
    <li className="reference-row" data-testid="reference-row" data-panel-id={panel.id}>
      {imagePath !== null && projectId !== null ? <img src={assetUrl(projectId, imagePath)} alt={`Panel ${number}`} draggable={false} /> : <span className="library-tile-blank" aria-hidden="true" />}
      <span className="reference-row-label">{`Panel ${number}`}</span>
      <button type="button" className="icon-button" aria-label="Remove reference" title="Leave this panel out" onClick={onRemove}>
        <X size={16} aria-hidden="true" />
      </button>
    </li>
  )
}
