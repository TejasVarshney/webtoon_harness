import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import { RefreshCw, Trash2 } from 'lucide-react'
import { isTallAspect } from '@shared/draw-aspect'
import type { Panel } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { usePanelsStore } from '../../stores/panels-store'
import { errorText } from '../characters/controls'
import { PanelArt } from './PanelArt'
import { PanelCheckBadge } from './PanelCheckBadge'
import { aspectRatio } from '@shared/strip-layout'

export interface PanelCardProps {
  panel: Panel
  selected: boolean
  /** Which way a slanted panel leans, from the strip's layout. */
  slant?: 'left' | 'right'
  /** Its share of the row's width (see `rowShares`), which scales the lettering. A lone panel has the whole row. */
  share?: number
  /** Where it sits on the strip canvas, in strip px (see `resolveStrip`). Without it the card flows in its row. */
  place?: { x: number; y: number; width: number }
  /** `export` draws only the picture and lettering: no toolbar, handlers, focus or selection. Default `edit`. */
  mode?: 'edit' | 'export'
  /** Export mode: whether the dialogue is drawn. Default true. */
  lettering?: boolean
  /** Export mode: the panel's 1-based place in the whole episode, for naming it when its image fails to load. */
  position?: number
}

/**
 * One panel of the strip: its current image with the dialogue drawn over it, a status when the newest attempt is
 * pending or failed (a failed regeneration keeps showing the image that was good, until the user reverts), a badge when
 * that image failed its consistency check or was not checked, and a toolbar on hover.
 * Clicking the card selects the panel (shift adds it to the selection) and double-clicking opens it in the editing
 * mode; the toolbar's buttons and the delete confirmation it opens do neither.
 * Its frame, slant and place in the strip are data attributes, for the stylesheet: a tall panel fades instead of a
 * frame, whatever its own frame says.
 */
export function PanelCard({ panel, selected, slant, share = 1, place, mode = 'edit', lettering = true, position }: PanelCardProps) {
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
  // The newest attempt, which may not be ready yet (see PanelArt, which shows its status).
  const generating = panel.versions.at(-1)?.status === 'pending'

  // Its aspect ratio sizes it in the row (flex-grow), so the panels of a row are one height. On the canvas it has a
  // box of its own, and the height follows its aspect.
  const shape = {
    '--ar': String(aspectRatio(panel.aspect)),
    '--share': String(share),
    ...(place === undefined ? {} : { position: 'absolute', left: `${place.x}px`, top: `${place.y}px`, width: `${place.width}px` })
  } as CSSProperties

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

  const { generatePanel, deletePanel } = usePanelsStore.getState()

  function onClick(e: MouseEvent<HTMLElement>): void {
    // The click that clears the selection on empty strip is not for a card.
    e.stopPropagation()
    if (e.shiftKey) useAppStore.getState().togglePanelSelection(panel.id)
    else useAppStore.getState().selectPanel(panel.id)
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>): void {
    // Only the card itself: Enter on a toolbar button is that button's.
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter') {
      e.preventDefault()
      useAppStore.getState().focusPanel(panel.id)
    } else if (e.key === ' ') {
      e.preventDefault()
      useAppStore.getState().selectPanel(panel.id)
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
        onClick={onClick}
        onDoubleClick={() => useAppStore.getState().focusPanel(panel.id)}
        onKeyDown={onKeyDown}
      >
        <PanelArt panel={panel} />
        {/* Outside PanelArt, whose export drawing must never show it. */}
        <PanelCheckBadge panel={panel} problemsOnly />
        {error !== null && (
          <p role="alert" className="error panel-error">
            {error}
          </p>
        )}
        <div className="panel-toolbar" role="group" aria-label="Panel actions" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <span className="panel-number">{index >= 0 ? `Panel ${index + 1}` : ''}</span>
          <button type="button" className="icon-button" aria-label="Regenerate" title="Regenerate" disabled={busy || generating} onClick={() => run(generatePanel(panel.id))}>
            <RefreshCw size={15} aria-hidden="true" />
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
