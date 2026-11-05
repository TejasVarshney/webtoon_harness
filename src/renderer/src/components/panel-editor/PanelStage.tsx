import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { isTallAspect } from '@shared/draw-aspect'
import type { Panel } from '@shared/types'
import { PanelArt } from '../visualizer/PanelArt'
import { STAGE_ROW_PX, fitScale } from './bubble-placement'
import { useBubbleEditing } from './use-bubble-editing'
import { useStagePan } from './use-stage-pan'
import { useStageZoom, ZoomBar } from './use-stage-zoom'

/**
 * The most of the window's height the stage takes. The stylesheet's cap on `.panel-stage` is this 62vh, or less when
 * the column must keep room for the tabs; the fit reads that cap, and falls back to this when there is none to read.
 */
const STAGE_MAX_HEIGHT = 0.62

export interface PanelStageProps {
  panel: Panel
  /** Its share of its strip row (see `rowShares`): the stage lays it out at that share of the reference row. */
  share: number
  /** Which way a slanted panel leans in the strip. */
  slant?: 'left' | 'right'
  /** The line selected in the workspace (a row of the Lines tab, or this stage): its bubble shows as selected. */
  selectedLine?: number | null
  /** The selected bubble's line index, for the Lines tab to follow. */
  onSelectLine(i: number | null): void
  /** The zoom, relative to the fit, and how to change it. The workspace keeps one per panel; without them the stage keeps its own. */
  zoom?: number
  onZoom?(zoom: number): void
}

export interface Fit {
  scale: number
  /** The panel's size at the reference row, before it is scaled. */
  width: number
  height: number
}

/**
 * The scale that fits the panel into its slot's width and the stage's height cap. Measured from the slot's width (a
 * ResizeObserver), the panel's laid-out size and the cap the stylesheet gives the stage. Until all of them have a
 * size it is `null`, and a measure that finds no room keeps the last fit, so the panel never collapses to nothing.
 */
export function useStageFit(slot: RefObject<HTMLElement | null>, shape: RefObject<HTMLElement | null>): Fit | null {
  const [fit, setFit] = useState<Fit | null>(null)
  useLayoutEffect(() => {
    const s = slot.current
    const p = shape.current
    if (s === null || p === null) return
    function measure(): void {
      if (s === null || p === null) return
      const style = getComputedStyle(s)
      const px = (v: string): number => parseFloat(v) || 0
      const natural = { width: p.offsetWidth, height: p.offsetHeight }
      const cap = parseFloat(style.maxHeight)
      const avail = {
        width: s.clientWidth - px(style.paddingLeft) - px(style.paddingRight),
        height: (Number.isFinite(cap) ? cap : window.innerHeight * STAGE_MAX_HEIGHT) - px(style.paddingTop) - px(style.paddingBottom)
      }
      if (natural.width <= 0 || natural.height <= 0) return
      const scale = fitScale(avail, natural)
      if (!(scale > 0) || !Number.isFinite(scale)) return
      setFit((f) => (f !== null && f.scale === scale && f.width === natural.width && f.height === natural.height ? f : { scale, ...natural }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(s)
    observer.observe(p)
    // The cap follows the column's height, which a notice above it or a resize changes without changing the stage.
    if (s.parentElement !== null) observer.observe(s.parentElement)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [slot, shape])
  return fit
}

/**
 * The open panel on a field of its own gutter colour, zoomable (the bar at its bottom right, or Ctrl and the wheel) and,
 * once zoomed, moved with a middle-button drag or a drag with Space held (`useStagePan`), drawn by the card's own `PanelArt` and lettered as on the strip:
 * it is laid out at its share of the strip's reference row (`STAGE_ROW_PX`, the lettering's container) and scaled up
 * or down with a transform to fit, so the bubbles' placement fractions are exact at every size. Its bubbles can be
 * selected, retyped, dragged, nudged, added and deleted (`useBubbleEditing`); each change saves the dialogue alone,
 * and a line that changed under an edit, or a refused save, is said in the Lines tab.
 */
export function PanelStage({ panel, share, slant, selectedLine, onSelectLine, zoom: heldZoom, onZoom }: PanelStageProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const shapeRef = useRef<HTMLDivElement>(null)
  const [ownZoom, setOwnZoom] = useState(1)
  const zoom = heldZoom ?? ownZoom
  const zoomControl = useStageZoom(viewportRef, shapeRef, zoom, onZoom ?? setOwnZoom)
  const pan = useStagePan(viewportRef)
  const { editing, selected, select, lines, stage } = useBubbleEditing(panel, stageRef)
  const fit = useStageFit(stageRef, shapeRef)

  // The workspace keeps the selected line, so the Lines tab can follow it, and a row selected there selects its bubble.
  const report = useRef(onSelectLine)
  useLayoutEffect(() => {
    report.current = onSelectLine
  })
  useEffect(() => report.current(selected), [selected])
  useEffect(() => {
    if (selectedLine !== undefined) select(selectedLine)
  }, [selectedLine, select])

  const shape = { width: share * STAGE_ROW_PX, '--share': String(share) } as CSSProperties
  const drawn = lines === panel.dialogue ? panel : { ...panel, dialogue: lines }

  const scale = fit === null ? null : fit.scale * zoom

  return (
    <div ref={stageRef} className="panel-stage" data-testid="panel-stage" data-gutter={panel.gutter} tabIndex={-1} {...stage}>
      <div ref={viewportRef} className="stage-viewport" data-testid="stage-viewport" data-pan={pan ?? undefined}>
        <div className="stage-fit" style={fit === null || scale === null ? undefined : { width: fit.width * scale, height: fit.height * scale }}>
          <div className="stage-row" style={{ width: STAGE_ROW_PX, transform: scale === null ? undefined : `scale(${scale})` }}>
            <div ref={shapeRef} className="panel-shape" data-frame={isTallAspect(panel.aspect) ? 'fade' : panel.frame} data-slant={slant} style={shape}>
              <PanelArt panel={drawn} editing={editing} />
            </div>
          </div>
        </div>
      </div>
      <ZoomBar zoom={zoom} control={zoomControl} />
    </div>
  )
}
