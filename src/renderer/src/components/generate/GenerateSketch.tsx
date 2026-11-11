import { useRef, useState, type CSSProperties } from 'react'
import { FilePlus2 } from 'lucide-react'
import { useGenerateStore } from '../../stores/generate-store'
import { SketchToolbar } from '../panel-editor/SketchToolbar'
import { useSketchCanvas } from '../panel-editor/use-sketch-pad'
import { useSketchShortcuts } from '../panel-editor/use-sketch-shortcuts'
import { useStagePan } from '../panel-editor/use-stage-pan'
import { useStageZoom, ZoomBar } from '../panel-editor/use-stage-zoom'

/**
 * A scratch pad for the new panel's layout: the Generate page's own sketch, at the draft's aspect, drawn with the
 * same tools and keys as a panel's. It zooms (the bar, + and -, or Ctrl and the wheel at the pointer) and, once zoomed,
 * moves with a right- or middle-button drag or a drag with Space held. It is kept in the draft as ink on white paper,
 * and the panel is made with it as its sketch. The draft takes the sketch when a stroke ends, not on each move.
 */
export function GenerateSketch() {
  const aspect = useGenerateStore((s) => s.draft.aspect)
  // What the draft held when the page opened. Later strokes come from this canvas: loading them back would redraw it.
  const [initialPng] = useState(() => useGenerateStore.getState().draft.sketchPng)
  const pad = useSketchCanvas({ aspect, initialPng, onChange: (png) => useGenerateStore.getState().patch({ sketchPng: png }), changeOnResize: true })
  const viewportRef = useRef<HTMLDivElement>(null)
  const paperRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const zoomControl = useStageZoom(viewportRef, paperRef, zoom, setZoom)
  const pan = useStagePan(viewportRef)
  useSketchShortcuts({ pad, zoom: { zoom, control: zoomControl } })
  const [w, h] = aspect.split(':').map(Number)
  const paper = { aspectRatio: `${w} / ${h}`, '--paper-ratio': String(w / h), '--zoom': String(zoom) } as CSSProperties

  return (
    <div className="generate-sketch" data-testid="generate-sketch">
      <div className="generate-sketch-head">
        <h3>Sketch</h3>
        <button type="button" title="Wipe every stroke and start a new sketch (Undo brings it back)" disabled={pad.blank} onClick={pad.clear}>
          <FilePlus2 size={14} aria-hidden="true" />
          New sketch
        </button>
      </div>
      <SketchToolbar pad={pad} orientation="horizontal" />
      <div className="generate-sketch-stage">
        <div ref={viewportRef} className="generate-sketch-viewport" data-testid="generate-sketch-viewport" data-pan={pan ?? undefined}>
          <div ref={paperRef} className="generate-sketch-paper" style={paper}>
            <canvas ref={pad.canvasRef} className="sketch-canvas" data-testid="generate-sketch-canvas" data-tool={pad.tool} aria-label="Sketch the panel" {...pad.handlers} />
          </div>
        </div>
        <ZoomBar zoom={zoom} control={zoomControl} />
      </div>
    </div>
  )
}
