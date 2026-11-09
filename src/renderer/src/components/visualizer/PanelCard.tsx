import { useEffect, useRef, type CSSProperties, type HTMLAttributes, type KeyboardEvent, type MouseEvent } from 'react'
import { isTallAspect } from '@shared/draw-aspect'
import type { Panel } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { PanelArt } from './PanelArt'
import { PanelCheckBadge } from './PanelCheckBadge'
import { PanelTools } from './PanelTools'
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
  /** Handlers that move the card on the strip (see `useStripDrag`). Presses on its tools and their popovers are left to them. */
  bind?: HTMLAttributes<HTMLElement>
  /** Handlers of the corner handle that resizes the card. Without them there is no handle. */
  bindResize?: HTMLAttributes<HTMLElement>
}

/**
 * One panel of the strip: its current image with the dialogue drawn over it, a status when the newest attempt is
 * pending or failed (a failed regeneration keeps showing the image that was good, until the user reverts), a badge when
 * that image failed its consistency check or was not checked, and the panel's tools (`PanelTools`) while it is the only
 * panel selected.
 * Clicking the card selects the panel (shift adds it to the selection) and double-clicking opens it in focus mode; the
 * tools and what they open do neither.
 * Its frame, slant and place in the strip are data attributes, for the stylesheet: a tall panel fades instead of a
 * frame, whatever its own frame says.
 */
export function PanelCard({ panel, selected, slant, share = 1, place, mode = 'edit', lettering = true, position, bind, bindResize }: PanelCardProps) {
  // The tools are for one panel at a time: with several selected, the selection bar acts on them.
  const alone = useAppStore((s) => s.selectedPanelIds.length <= 1)
  // Focus mode is the one editor of its panel: no popover of the strip may float over it with a second one.
  const focusing = useAppStore((s) => s.focusedPanelId !== null)
  const showTools = selected && alone && !focusing
  const cardRef = useRef<HTMLElement>(null)

  // Selecting from elsewhere (a chat thumbnail) must bring the card into view, and its tools, which hang below it.
  // (jsdom has no scrollIntoView.)
  useEffect(() => {
    if (!selected) return
    cardRef.current?.scrollIntoView?.({ block: 'nearest' })
    cardRef.current?.querySelector('.panel-tools')?.scrollIntoView?.({ block: 'nearest' })
  }, [selected, showTools])

  // Its aspect ratio sizes it in the row (flex-grow), so the panels of a row are one height. On the canvas it has a
  // box of its own, and the height follows its aspect.
  const shape = {
    '--ar': String(aspectRatio(panel.aspect)),
    '--share': String(share),
    ...(place === undefined ? {} : { position: 'absolute', left: `${place.x}px`, top: `${place.y}px`, width: `${place.width}px` })
  } as CSSProperties

  function onClick(e: MouseEvent<HTMLElement>): void {
    // The click that clears the selection on empty strip is not for a card.
    e.stopPropagation()
    if (e.shiftKey) useAppStore.getState().togglePanelSelection(panel.id)
    else useAppStore.getState().selectPanel(panel.id)
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>): void {
    bind?.onKeyDown?.(e)
    // Only the card itself: Enter on a tool's button is that button's.
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
    <article
      ref={cardRef}
      className="panel-card panel-shape"
      data-testid="panel-card"
      data-panel-id={panel.id}
      data-selected={String(selected)}
      data-tools={String(showTools)}
      data-frame={isTallAspect(panel.aspect) ? 'fade' : panel.frame}
      data-beside={String(panel.beside)}
      data-gap={panel.gapAfter}
      data-slant={slant}
      style={shape}
      aria-current={selected ? 'true' : undefined}
      tabIndex={0}
      {...bind}
      onClick={onClick}
      onDoubleClick={() => useAppStore.getState().focusPanel(panel.id)}
      onKeyDown={onKeyDown}
    >
      <PanelArt panel={panel} />
      {/* Outside PanelArt, whose export drawing must never show it. */}
      <PanelCheckBadge panel={panel} problemsOnly />
      {showTools && <PanelTools panel={panel} />}
      {bindResize !== undefined && <div className="panel-resize" data-testid="panel-resize" aria-hidden="true" {...bindResize} />}
    </article>
  )
}
