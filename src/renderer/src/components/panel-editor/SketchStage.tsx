import { useRef, useState, type CSSProperties } from 'react'
import { FilePlus2, Image as ImageIcon } from 'lucide-react'
import { assetUrl } from '@shared/asset-url'
import { isTallAspect } from '@shared/draw-aspect'
import type { Panel } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { STAGE_ROW_PX } from './bubble-placement'
import { useStageFit } from './PanelStage'
import { SketchToolbar } from './SketchToolbar'
import { usePaperView } from './use-paper-view'
import { useSketchPad } from './use-sketch-pad'
import { useSketchShortcuts } from './use-sketch-shortcuts'
import { useStagePan } from './use-stage-pan'
import { ZoomBar } from './use-stage-zoom'

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
 * The stage in sketch mode: the panel's shape, laid out as on the panel stage, holding a canvas the user scribbles the
 * scene on. Under the canvas is white paper, or the panel's picture, faint, to trace over (Picture hides it). A rail of
 * tools sits at the stage's left edge (pen, eraser, line, rectangle, ellipse, three widths, undo), New sketch at its
 * top right wipes the canvas, and the zoom bar is at its bottom right. The panel sits in a frame as high as it is at the
 * fit (`usePaperView`): the wheel zooms at the pointer, and a right- or middle-button drag, or a drag with Space held
 * (`useStagePan`), moves it any way, never out of sight, and draws nothing. The sketch is stored as the user draws,
 * always as ink on white paper, never with the picture, and sent with the next generation as a layout reference.
 */
export function SketchStage({ panel, share, slant, zoom: heldZoom, onZoom }: SketchStageProps) {
  const projectId = useAppStore((s) => s.projectId)
  const stageRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const shapeRef = useRef<HTMLDivElement>(null)
  // The panel's laid-out size, and the scale that fits it to the stage: the frame is as high as the fitted panel.
  const fit = useStageFit(stageRef, shapeRef)
  const pad = useSketchPad(panel)
  const view = usePaperView(viewportRef, fit === null ? 1 : fit.width / fit.height, { height: fit === null ? null : fit.height * fit.scale, zoom: heldZoom, onZoom })
  const pan = useStagePan(viewportRef, view.move)
  useSketchShortcuts({ pad, zoom: { zoom: view.zoom, control: view.control } })
  const [showPicture, setShowPicture] = useState(true)
  const shape = { width: share * STAGE_ROW_PX, '--share': String(share) } as CSSProperties
  const scale = fit === null || view.paper.width <= 0 ? null : view.paper.width / fit.width

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
      <div ref={viewportRef} className="stage-viewport paper-frame" data-testid="sketch-viewport" data-pan={pan ?? undefined} style={view.frameStyle}>
        <div className="stage-fit" style={scale === null ? undefined : { left: view.paper.x, top: view.paper.y, width: view.paper.width, height: view.paper.height }}>
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
      <ZoomBar zoom={view.zoom} control={view.control} wheel="plain">
        <p className="sketch-status" role="status">
          {pad.error !== null ? <span className="error">{`Sketch not saved: ${pad.error}`}</span> : pad.saving ? 'Saving sketch…' : null}
        </p>
      </ZoomBar>
    </div>
  )
}
