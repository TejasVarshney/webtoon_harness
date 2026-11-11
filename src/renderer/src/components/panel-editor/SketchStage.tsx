import { useRef, useState, type CSSProperties } from 'react'
import { FilePlus2, Image as ImageIcon } from 'lucide-react'
import { assetUrl } from '@shared/asset-url'
import { isTallAspect } from '@shared/draw-aspect'
import type { Panel } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { STAGE_ROW_PX } from './bubble-placement'
import { useStageFit } from './PanelStage'
import { SketchToolbar } from './SketchToolbar'
import { useSketchPad } from './use-sketch-pad'
import { useStagePan } from './use-stage-pan'
import { useStageZoom, ZoomBar } from './use-stage-zoom'

export interface SketchStageProps {
  panel: Panel
  /** Its share of its strip row, as on the panel stage. */
  share: number
  slant?: 'left' | 'right'
  /** The zoom, relative to the fit, and how to change it: the workspace keeps one per panel, shared with the panel stage. */
  zoom?: number
  onZoom?(zoom: number): void
}

/**
 * The stage in sketch mode: the panel's shape, laid out and fitted as on the panel stage, holding a canvas the user
 * scribbles the scene on. Under the canvas is white paper, or the panel's picture, faint, to trace over (Picture hides
 * it). A rail of tools sits at the stage's left edge (pen, eraser, line, rectangle, ellipse, three widths, undo), New
 * sketch at its top right wipes the canvas, and the zoom bar is at its bottom right; Ctrl and the wheel (or a pinch)
 * zoom at the pointer, and a zoomed sketch scrolls, or moves with a middle-button drag or a drag with Space held
 * (`useStagePan`), which draws nothing. The sketch is stored as the user draws, always as ink on white
 * paper, never with the picture, and sent with the next generation as a layout reference.
 */
export function SketchStage({ panel, share, slant, zoom: heldZoom, onZoom }: SketchStageProps) {
  const projectId = useAppStore((s) => s.projectId)
  const stageRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const shapeRef = useRef<HTMLDivElement>(null)
  const fit = useStageFit(stageRef, shapeRef)
  const pad = useSketchPad(panel)
  const [ownZoom, setOwnZoom] = useState(1)
  const zoom = heldZoom ?? ownZoom
  const zoomControl = useStageZoom(viewportRef, shapeRef, zoom, onZoom ?? setOwnZoom)
  const pan = useStagePan(viewportRef)
  const [showPicture, setShowPicture] = useState(true)
  const shape = { width: share * STAGE_ROW_PX, '--share': String(share) } as CSSProperties
  const scale = fit === null ? null : fit.scale * zoom

  const current = panel.versions.find((v) => v.id === panel.currentVersionId)
  const picture = current?.status === 'ready' && current.imagePath && projectId !== null ? assetUrl(projectId, current.imagePath) : null

  return (
    <div ref={stageRef} className="panel-stage sketch-stage" data-testid="sketch-stage">
      <SketchToolbar pad={pad} />
      <div className="sketch-actions">
        {picture !== null && (
          <button type="button" aria-pressed={showPicture} title="Show the panel's picture under the sketch, to trace over" onClick={() => setShowPicture((v) => !v)}>
            <ImageIcon size={14} aria-hidden="true" />
            Picture
          </button>
        )}
        <button type="button" title="Wipe every stroke and start a new sketch (Undo brings it back)" disabled={pad.blank} onClick={pad.clear}>
          <FilePlus2 size={14} aria-hidden="true" />
          New sketch
        </button>
      </div>
      <div ref={viewportRef} className="stage-viewport" data-testid="sketch-viewport" data-pan={pan ?? undefined}>
        <div className="stage-fit" style={fit === null || scale === null ? undefined : { width: fit.width * scale, height: fit.height * scale }}>
          <div className="stage-row" style={{ width: STAGE_ROW_PX, transform: scale === null ? undefined : `scale(${scale})` }}>
            <div ref={shapeRef} className="panel-shape" data-frame={isTallAspect(panel.aspect) ? 'fade' : panel.frame} data-slant={slant} style={shape}>
              <div className="panel-media sketch-media" style={{ aspectRatio: panel.aspect.replace(':', ' / ') }}>
                {picture !== null && showPicture && <div className="sketch-underlay" data-testid="sketch-underlay" style={{ backgroundImage: `url("${picture}")` }} />}
                <canvas ref={pad.canvasRef} className="sketch-canvas" data-testid="sketch-canvas" data-tool={pad.tool} aria-label="Sketch the scene" {...pad.handlers} />
              </div>
            </div>
          </div>
        </div>
      </div>
      <ZoomBar zoom={zoom} control={zoomControl}>
        <p className="sketch-status" role="status">
          {pad.error !== null ? <span className="error">{`Sketch not saved: ${pad.error}`}</span> : pad.saving ? 'Saving sketch…' : null}
        </p>
      </ZoomBar>
    </div>
  )
}
