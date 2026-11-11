import { useCallback, useEffect, useRef, type CSSProperties, type HTMLAttributes, type MouseEvent, type PointerEvent, type RefObject } from 'react'
import { isTallAspect } from '@shared/draw-aspect'
import type { PlacedPanel } from '@shared/strip-canvas'
import { STRIP_CSS_WIDTH } from '@shared/strip-width'
import type { DialogueLine, Panel } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { boxOf, type Box } from '../panel-editor/bubble-placement'
import { useBubbleEditing } from '../panel-editor/use-bubble-editing'
import { DialogueOverlay } from './DialogueOverlay'
import { PanelTools } from './PanelTools'

export interface StripBubblesProps {
  /** The panels where they are drawn now (a panel being dragged is where it is dragged to). */
  placed: PlacedPanel[]
  /** The strip canvas, which a bubble is kept inside. */
  canvas: RefObject<HTMLElement | null>
  /** `export` draws the lettering only: no selection, tools or handlers. Default `edit`. */
  mode?: 'edit' | 'export'
}

/** The box a panel's bubbles are laid out in: where its card is, with the same frame, so a fraction means the same thing on both. */
function BubbleBox({ placed, children, ...rest }: { placed: PlacedPanel; ref?: RefObject<HTMLDivElement | null> } & HTMLAttributes<HTMLDivElement>) {
  const { panel } = placed
  const style = { '--share': String(placed.share), left: `${placed.x}px`, top: `${placed.y}px`, width: `${placed.width}px` } as CSSProperties
  return (
    <div
      className="strip-bubbles"
      data-testid="strip-bubbles"
      data-panel-id={panel.id}
      data-frame={isTallAspect(panel.aspect) ? 'fade' : panel.frame}
      data-slant={placed.slant}
      style={style}
      {...rest}
    >
      {children}
    </div>
  )
}

/**
 * The lines as they are drawn on the strip: a bubble's centre is held inside the strip's width. A placement is a
 * fraction of its panel, so widening or moving the panel carries an off-panel bubble with it, possibly past the edge;
 * the stored value is left alone, and the bubble is back where it was put if the panel comes back.
 */
function insideStrip(lines: DialogueLine[], placed: PlacedPanel): DialogueLine[] {
  if (placed.width <= 0) return lines
  const low = -placed.x / placed.width
  const high = (STRIP_CSS_WIDTH - placed.x) / placed.width
  return lines.map((line) => {
    const p = line.placement
    if (p === null || (p.x >= low && p.x <= high)) return line
    return { ...line, placement: { ...p, x: Math.round(Math.min(high, Math.max(low, p.x)) * 10000) / 10000 } }
  })
}

function EditableBubbles({ placed, canvas }: { placed: PlacedPanel; canvas: RefObject<HTMLElement | null> }) {
  const panel: Panel = placed.panel
  const box = useRef<HTMLDivElement>(null)
  const sole = useAppStore((s) => s.selectedPanelIds.length === 1 && s.selectedPanelIds[0] === panel.id)
  // Focus mode is the one editor of its panel: no popover of the strip may float over it with a second one.
  const focusing = useAppStore((s) => s.focusedPanelId !== null)
  const showTools = sole && !focusing
  // A bubble may go anywhere on the strip, but not off it.
  const bounds = useCallback((): Box | null => (canvas.current === null ? null : boxOf(canvas.current)), [canvas])
  const { editing, lines, select, selected, stage, add, adding, clicked } = useBubbleEditing(panel, box, bounds)

  // A press on another panel never reaches this one, so the bubble it had selected is let go when the selection moves.
  useEffect(() => {
    if (!sole) select(null)
  }, [sole, select])

  // Selecting from elsewhere must bring the tools, which hang below the panel, into view. (jsdom has no scrollIntoView.)
  useEffect(() => {
    if (showTools) box.current?.querySelector('.panel-tools')?.scrollIntoView?.({ block: 'nearest' })
  }, [showTools])

  return (
    <BubbleBox
      placed={placed}
      ref={box}
      data-tools={String(showTools)}
      tabIndex={-1}
      {...stage}
      onPointerDown={(e: PointerEvent<HTMLDivElement>) => {
        stage.onPointerDown?.(e)
        // Pressing a bubble makes its panel the selection, so its tools show. It never clears the selection or starts the card's drag.
        if (e.button === 0 && e.target instanceof Element && e.target.closest('.bubble') !== null) useAppStore.getState().selectPanel(panel.id)
      }}
      // The click that clears the selection on empty strip is not for a bubble, and the layer is inside the pane that takes it.
      onClick={(e: MouseEvent<HTMLDivElement>) => e.stopPropagation()}
    >
      <div className="panel-media" style={{ aspectRatio: panel.aspect.replace(':', ' / ') }}>
        <DialogueOverlay dialogue={insideStrip(lines, placed)} cast={panel.characters} editing={editing} />
      </div>
      {showTools && <PanelTools panel={panel} selectedLine={selected} onSelectLine={select} linesRequest={clicked} onAddBubble={add} addingBubble={adding} />}
    </BubbleBox>
  )
}

/**
 * The lettering of the strip, one layer for each panel, over all the cards. A layer sits exactly where its panel's card
 * is (and follows it while it is dragged or resized) and holds a transparent copy of the panel's media box, which is
 * what a bubble's placement is a fraction of. The layer takes no press: only the bubbles do, so a click on empty strip
 * or art reaches the card below. A bubble belongs to its panel and moves with it, but may be dragged anywhere on the
 * strip, so its placement can be past the panel's edge. A bubble can be pressed on any panel, selected or not, and the
 * press selects its panel; the panel's tools (`PanelTools`) are here, above the bubbles, because a bubble selected
 * opens Lines on its line.
 */
export function StripBubbles({ placed, canvas, mode = 'edit' }: StripBubblesProps) {
  if (mode === 'export') {
    return (
      <>
        {placed.map((p) => (
          <BubbleBox key={p.panel.id} placed={p}>
            <div className="panel-media" style={{ aspectRatio: p.panel.aspect.replace(':', ' / ') }}>
              <DialogueOverlay dialogue={p.panel.dialogue} cast={p.panel.characters} />
            </div>
          </BubbleBox>
        ))}
      </>
    )
  }
  return (
    <>
      {placed.map((p) => (
        <EditableBubbles key={p.panel.id} placed={p} canvas={canvas} />
      ))}
    </>
  )
}
