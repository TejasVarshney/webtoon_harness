import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { assetUrl } from '@shared/asset-url'
import type { Panel } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { usePanelsStore } from '../../stores/panels-store'
import { errorText } from '../characters/controls'
import { DialogueOverlay } from './DialogueOverlay'
import { PanelEditorDialog } from './PanelEditorDialog'

export interface PanelCardProps {
  panel: Panel
  selected: boolean
}

/**
 * One panel of the strip: its current image with the dialogue drawn over it, a status when the newest attempt is
 * pending or failed (a failed regeneration keeps showing the image that was good), and a toolbar on hover.
 * Clicking the card selects the panel; the toolbar's buttons and the dialogs it opens do not.
 */
export function PanelCard({ panel, selected }: PanelCardProps) {
  const projectId = useAppStore((s) => s.projectId)
  const siblings = usePanelsStore((s) => s.panelsByEpisode[panel.episodeId])
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cardRef = useRef<HTMLElement>(null)

  // Selecting from elsewhere (a chat thumbnail) must bring the card into view. (jsdom has no scrollIntoView.)
  useEffect(() => {
    if (selected) cardRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [selected])

  const index = siblings?.findIndex((p) => p.id === panel.id) ?? -1
  const count = siblings?.length ?? 0
  // The image is the version the panel points at; the status is the newest attempt, which may not be ready yet.
  const current = panel.versions.find((v) => v.id === panel.currentVersionId)
  const imagePath = current?.status === 'ready' ? current.imagePath : null
  const latest = panel.versions.at(-1)
  const generating = latest?.status === 'pending'

  function run(task: Promise<unknown>): void {
    setBusy(true)
    setError(null)
    task.then(
      () => setBusy(false),
      (e: unknown) => {
        setError(errorText(e))
        setBusy(false)
      }
    )
  }

  const { generatePanel, movePanel, deletePanel } = usePanelsStore.getState()
  const select = (): void => useAppStore.getState().selectPanel(panel.id)

  function onKeyDown(e: KeyboardEvent<HTMLElement>): void {
    // Only the card itself: Enter on a toolbar button is that button's.
    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      select()
    }
  }

  return (
    <>
      <article
        ref={cardRef}
        className="panel-card"
        data-testid="panel-card"
        data-selected={String(selected)}
        aria-current={selected ? 'true' : undefined}
        tabIndex={0}
        onClick={select}
        onKeyDown={onKeyDown}
      >
        <div className="panel-media" style={{ aspectRatio: panel.aspect.replace(':', ' / ') }}>
          {imagePath !== null && projectId !== null && <img src={assetUrl(projectId, imagePath)} alt={panel.description} draggable={false} />}
          {panel.versions.length === 0 && <div className="panel-empty">No image yet</div>}
          <DialogueOverlay dialogue={panel.dialogue} />
          {generating && (
            <div className="panel-status" data-testid="panel-status" data-status="pending" role="status">
              Generating…
            </div>
          )}
          {latest?.status === 'failed' && (
            <div className="panel-status panel-status-failed" data-testid="panel-status" data-status="failed" role="status">
              <span>{`Failed: ${latest.error ?? 'Unknown error'}`}</span>
              {/* Retry is part of the status, but is its own control: a click on it must not select the panel. */}
              <button
                type="button"
                disabled={busy}
                onClick={(e) => {
                  e.stopPropagation()
                  run(generatePanel(panel.id))
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
        <div className="panel-toolbar" role="group" aria-label="Panel actions" onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button type="button" disabled={busy || generating} onClick={() => run(generatePanel(panel.id))}>
            Regenerate
          </button>
          <button type="button" disabled={busy || index <= 0} onClick={() => run(movePanel(panel.id, index - 1))}>
            Move up
          </button>
          <button type="button" disabled={busy || index < 0 || index >= count - 1} onClick={() => run(movePanel(panel.id, index + 1))}>
            Move down
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirming(true)}>
            Delete
          </button>
        </div>
      </article>

      {/* Siblings of the card, not children: a click in a dialog must not bubble up and select the panel. */}
      {editing && <PanelEditorDialog mode="edit" episodeId={panel.episodeId} panel={panel} onClose={() => setEditing(false)} />}

      {confirming && (
        <div className="modal-backdrop">
          <div className="modal" role="dialog" aria-label="Delete panel">
            <p>Delete this panel? It moves to the trash.</p>
            <div className="modal-actions">
              <button type="button" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false)
                  run(deletePanel(panel.id))
                }}
              >
                Delete panel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
