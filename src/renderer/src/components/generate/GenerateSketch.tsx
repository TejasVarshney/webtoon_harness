import { useState, type CSSProperties } from 'react'
import { FilePlus2 } from 'lucide-react'
import { useGenerateStore } from '../../stores/generate-store'
import { SketchToolbar } from '../panel-editor/SketchToolbar'
import { useSketchCanvas } from '../panel-editor/use-sketch-pad'

/**
 * A scratch pad for the new panel's layout: the Generate page's own sketch, at the draft's aspect, drawn with the
 * same tools as a panel's. It is kept in the draft as ink on white paper, and the panel is made with it as its sketch.
 * The draft takes the sketch when a stroke ends, not on each move.
 */
export function GenerateSketch() {
  const aspect = useGenerateStore((s) => s.draft.aspect)
  // What the draft held when the page opened. Later strokes come from this canvas: loading them back would redraw it.
  const [initialPng] = useState(() => useGenerateStore.getState().draft.sketchPng)
  const pad = useSketchCanvas({ aspect, initialPng, onChange: (png) => useGenerateStore.getState().patch({ sketchPng: png }), changeOnResize: true })
  const [w, h] = aspect.split(':').map(Number)
  const paper = { aspectRatio: `${w} / ${h}`, '--paper-ratio': String(w / h) } as CSSProperties

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
      <div className="generate-sketch-paper" style={paper}>
        <canvas ref={pad.canvasRef} className="sketch-canvas" data-testid="generate-sketch-canvas" data-tool={pad.tool} aria-label="Sketch the panel" {...pad.handlers} />
      </div>
    </div>
  )
}
