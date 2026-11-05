import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { ArrowDown, ArrowUp, Columns2, RefreshCw, Trash2 } from 'lucide-react'
import { isTallAspect } from '@shared/draw-aspect'
import type { Panel } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { usePanelsStore } from '../../stores/panels-store'
import { errorText } from '../characters/controls'
import { PanelArt } from './PanelArt'
import { aspectRatio } from '@shared/strip-layout'

export interface PanelCardProps {
  panel: Panel
  selected: boolean
  /** Which way a slanted panel leans, from the strip's layout. */
  slant?: 'left' | 'right'
  /** Its share of the row's width (see `rowShares`), which scales the lettering. A lone panel has the whole row. */
  share?: number
  /** `export` draws only the picture and lettering: no toolbar, handlers, focus or selection. Default `edit`. */
  mode?: 'edit' | 'export'
  /** Export mode: whether the dialogue is drawn. Default true. */
  lettering?: boolean
  /** Export mode: the panel's 1-based place in the whole episode, for naming it when its image fails to load. */
  position?: number
}

/**
 * One panel of the strip: its current image with the dialogue drawn over it, a status when the newest attempt is
 * pending or failed (a failed regeneration keeps showing the image that was good, until the user reverts), and a
 * toolbar on hover.
 * Clicking the card selects the panel, which opens it in the editing mode; the toolbar's buttons and the delete
 * confirmation it opens do not.
 * Its frame, slant and place in the strip are data attributes, for the stylesheet: a tall panel fades instead of a
 * frame, whatever its own frame says.
 */
export function PanelCard({ panel, selected, slant, share = 1, mode = 'edit', lettering = true, position }: PanelCardProps) {
  const siblings = usePanelsStore((s) => s.panelsByEpisode[panel.episodeId])
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
  // The newest attempt, which may not be ready yet (see PanelArt, which shows its status).
  const generating = panel.versions.at(-1)?.status === 'pending'

  // Its aspect ratio sizes it in the row (flex-grow), so the panels of a row are one height.
  const shape = { '--ar': String(aspectRatio(panel.aspect)), '--share': String(share) } as CSSProperties

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

  const { generatePanel, movePanel, deletePanel, updatePanel } = usePanelsStore.getState()
  const select = (): void => useAppStore.getState().selectPanel(panel.id)

  function onKeyDown(e: KeyboardEvent<HTMLElement>): void {
    // Only the card itself: Enter on a toolbar button is that button's.
    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      select()
    }
  }

  if (mode === 'export') {
    return (
      <article
        className="panel-card panel-shape"
        data-testid="panel-card"
        data-panel-id={panel.id}
        data-position={position}
        data-frame={isTallAspect(panel.aspect) ? 'fade' : panel.frame}
        data-beside={String(panel.beside)}
        data-gutter={panel.gutter}
        data-gap={panel.gapAfter}
        data-slant={slant}
        style={shape}
      >
        <PanelArt panel={panel} mode="export" lettering={lettering} />
      </article>
    )
  }

  return (
    <>
      <article
        ref={cardRef}
        className="panel-card panel-shape"
        data-testid="panel-card"
        data-panel-id={panel.id}
        data-selected={String(selected)}
        data-frame={isTallAspect(panel.aspect) ? 'fade' : panel.frame}
        data-beside={String(panel.beside)}
        data-gutter={panel.gutter}
        data-gap={panel.gapAfter}
        data-slant={slant}
        style={shape}
        aria-current={selected ? 'true' : undefined}
        tabIndex={0}
        onClick={select}
        onKeyDown={onKeyDown}
      >
        <PanelArt panel={panel} />
        {error !== null && (
          <p role="alert" className="error panel-error">
            {error}
          </p>
        )}
        <div className="panel-toolbar" role="group" aria-label="Panel actions" onClick={(e) => e.stopPropagation()}>
          <span className="panel-number">{index >= 0 ? `Panel ${index + 1}` : ''}</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Beside previous"
            title="Beside previous"
            aria-pressed={panel.beside}
            disabled={busy || index <= 0}
            onClick={() => run(updatePanel(panel.id, { beside: !panel.beside }))}
          >
            <Columns2 size={15} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" aria-label="Regenerate" title="Regenerate" disabled={busy || generating} onClick={() => run(generatePanel(panel.id))}>
            <RefreshCw size={15} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button" aria-label="Move up" title="Move up" disabled={busy || index <= 0} onClick={() => run(movePanel(panel.id, index - 1))}>
            <ArrowUp size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Move down"
            title="Move down"
            disabled={busy || index < 0 || index >= count - 1}
            onClick={() => run(movePanel(panel.id, index + 1))}
          >
            <ArrowDown size={15} aria-hidden="true" />
          </button>
          <button type="button" className="icon-button icon-button-danger" aria-label="Delete" title="Delete panel" disabled={busy} onClick={() => setConfirming(true)}>
            <Trash2 size={15} aria-hidden="true" />
          </button>
        </div>
      </article>

      {/* A sibling of the card, not a child: a click in the dialog must not bubble up and select the panel. */}
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
                className="btn-danger"
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
