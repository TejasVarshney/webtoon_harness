import { useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { assetUrl } from '@shared/asset-url'
import type { Panel } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { usePanelsStore } from '../../stores/panels-store'
import { errorText } from '../characters/controls'
import { DialogueOverlay, type OverlayEditing } from './DialogueOverlay'

export interface PanelArtProps {
  panel: Panel
  /** Given on the editing stage, where the lettering can be selected and dragged. */
  editing?: OverlayEditing
}

/**
 * A panel's picture with its dialogue drawn over it: the current image, "No image yet" for a panel without one, and
 * a status when the newest attempt is pending or failed. A failed regeneration keeps showing the image that was good,
 * until the user reverts. The strip's card and the editing stage both draw the panel with this.
 */
export function PanelArt({ panel, editing }: PanelArtProps) {
  const projectId = useAppStore((s) => s.projectId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The image is the version the panel points at; the status is the newest attempt, which may not be ready yet.
  const current = panel.versions.find((v) => v.id === panel.currentVersionId)
  const imagePath = current?.status === 'ready' ? current.imagePath : null
  const latest = panel.versions.at(-1)
  const generating = latest?.status === 'pending'

  // A revert (from the version switcher, or by the agent) moves the current version while the newest attempt stays
  // the same failed one: the user chose an image, so that old failure is no longer shown. A later attempt that fails
  // is new, and shows again. Kept per card, from the data alone: nothing is stored.
  const [seen, setSeen] = useState({ current: panel.currentVersionId, latest: latest?.id ?? null })
  const [dismissedFailure, setDismissedFailure] = useState<string | null>(null)
  if (seen.current !== panel.currentVersionId || seen.latest !== (latest?.id ?? null)) {
    if (seen.current !== panel.currentVersionId && seen.latest === latest?.id && latest?.status === 'failed') setDismissedFailure(latest.id)
    setSeen({ current: panel.currentVersionId, latest: latest?.id ?? null })
  }
  const failed = latest?.status === 'failed' && latest.id !== dismissedFailure ? latest : null

  function retry(): void {
    setBusy(true)
    setError(null)
    usePanelsStore.getState().generatePanel(panel.id).then(
      () => setBusy(false),
      (e: unknown) => {
        setError(errorText(e))
        setBusy(false)
      }
    )
  }

  return (
    <>
      <div className="panel-media" style={{ aspectRatio: panel.aspect.replace(':', ' / ') }}>
        {imagePath !== null && projectId !== null && <img src={assetUrl(projectId, imagePath)} alt={panel.description} draggable={false} />}
        {panel.versions.length === 0 && <div className="panel-empty">No image yet</div>}
        <DialogueOverlay dialogue={panel.dialogue} cast={panel.characters} editing={editing} />
        {generating && (
          <div className="panel-status" data-testid="panel-status" data-status="pending" role="status">
            <LoaderCircle size={14} className="spin" aria-hidden="true" />
            Generating…
          </div>
        )}
        {failed !== null && (
          <div className="panel-status panel-status-failed" data-testid="panel-status" data-status="failed" role="status">
            <span>{`Failed: ${failed.error ?? 'Unknown error'}`}</span>
            {/* Retry is part of the status, but is its own control: a click on it must not select the panel. */}
            <button
              type="button"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation()
                retry()
              }}
            >
              Retry
            </button>
          </div>
        )}
      </div>
      {error !== null && (
        <p role="alert" className="error panel-error">
          {error}
        </p>
      )}
    </>
  )
}
