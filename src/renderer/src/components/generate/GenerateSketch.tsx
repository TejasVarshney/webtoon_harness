import { useRef, useState } from 'react'
import { FilePlus2 } from 'lucide-react'
import { useGenerateStore } from '../../stores/generate-store'
import { SketchToolbar } from '../panel-editor/SketchToolbar'
import { useSketchCanvas } from '../panel-editor/use-sketch-pad'
import { useSketchShortcuts } from '../panel-editor/use-sketch-shortcuts'
import { useStagePan } from '../panel-editor/use-stage-pan'
import { ZoomBar } from '../panel-editor/use-stage-zoom'
import { usePaperView } from '../panel-editor/use-paper-view'

/**
 * A scratch pad for the new panel's layout: the Generate page's own sketch, at the draft's aspect, drawn with the
 * same tools and keys as a panel's. The paper sits in a frame: the wheel zooms at the pointer (as do the bar and + and
 * -), and a right- or middle-button drag, or a drag with Space held, moves it any way, never out of sight (see
 * `usePaperView`). It is kept in the draft as ink on white paper, and the panel is made with it as its sketch. The
 * draft takes the sketch when a stroke ends, not on each move.
 */
export function GenerateSketch() {
  const aspect = useGenerateStore((s) => s.draft.aspect)
  // What the draft held when the page opened. Later strokes come from this canvas: loading them back would redraw it.
  const [initialPng] = useState(() => useGenerateStore.getState().draft.sketchPng)
  const pad = useSketchCanvas({ aspect, initialPng, onChange: (png) => useGenerateStore.getState().patch({ sketchPng: png }), changeOnResize: true })
  const [w, h] = aspect.split(':').map(Number)
  const frameRef = useRef<HTMLDivElement>(null)
  const view = usePaperView(frameRef, w / h)
  const pan = useStagePan(frameRef, view.move)
  useSketchShortcuts({ pad, zoom: { zoom: view.zoom, control: view.control } })

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
        <div ref={frameRef} className="generate-sketch-viewport" data-testid="generate-sketch-viewport" data-pan={pan ?? undefined} style={view.frameStyle}>
          <div className="generate-sketch-paper" data-testid="generate-sketch-paper" style={view.paperStyle}>
            <canvas ref={pad.canvasRef} className="sketch-canvas" data-testid="generate-sketch-canvas" data-tool={pad.tool} aria-label="Sketch the panel" {...pad.handlers} />
          </div>
        </div>
        <ZoomBar zoom={view.zoom} control={view.control} wheel="plain" />
      </div>
    </div>
  )
}
