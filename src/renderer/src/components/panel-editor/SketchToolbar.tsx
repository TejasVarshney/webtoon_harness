import type { ReactNode } from 'react'
import { Circle, Eraser, Keyboard, Pencil, Slash, Square, Undo2 } from 'lucide-react'
import type { SketchCanvas, SketchSize, SketchTool } from './use-sketch-pad'
import { SKETCH_SHORTCUTS, SKETCH_TOOL_KEYS } from './use-sketch-shortcuts'

const TOOLS: { id: SketchTool; label: string; icon: ReactNode }[] = [
  { id: 'pen', label: 'Pen', icon: <Pencil size={16} aria-hidden="true" /> },
  { id: 'eraser', label: 'Eraser', icon: <Eraser size={16} aria-hidden="true" /> },
  { id: 'line', label: 'Line', icon: <Slash size={16} aria-hidden="true" /> },
  { id: 'rect', label: 'Rectangle', icon: <Square size={16} aria-hidden="true" /> },
  { id: 'ellipse', label: 'Ellipse', icon: <Circle size={16} aria-hidden="true" /> }
]

const SIZES: { id: SketchSize; label: string; key: string }[] = [
  { id: 'fine', label: 'Fine', key: '1' },
  { id: 'medium', label: 'Medium', key: '2' },
  { id: 'bold', label: 'Bold', key: '3' }
]

export interface SketchToolbarProps {
  pad: Pick<SketchCanvas, 'tool' | 'setTool' | 'size' | 'setSize' | 'canUndo' | 'undo'>
  orientation?: 'vertical' | 'horizontal'
}

/**
 * The sketch's tools: pen, eraser, line, rectangle, ellipse, three widths and undo, each titled with its key, and a
 * keyboard hint that lists every shortcut (`useSketchShortcuts`). A rail on the stage, a row on the Generate page.
 */
export function SketchToolbar({ pad, orientation = 'vertical' }: SketchToolbarProps) {
  return (
    <div className="sketch-tools" data-orientation={orientation} role="toolbar" aria-label="Sketch tools" aria-orientation={orientation}>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          className="icon-button"
          aria-label={t.label}
          aria-keyshortcuts={SKETCH_TOOL_KEYS[t.id]}
          title={t.id === 'pen' || t.id === 'eraser' ? `${t.label} (${SKETCH_TOOL_KEYS[t.id]})` : `${t.label} (${SKETCH_TOOL_KEYS[t.id]}). Shift keeps it straight or even`}
          aria-pressed={pad.tool === t.id}
          onClick={() => pad.setTool(t.id)}
        >
          {t.icon}
        </button>
      ))}
      <span className="sketch-tools-gap" aria-hidden="true" />
      {SIZES.map((s) => (
        <button key={s.id} type="button" className="icon-button sketch-size" aria-label={`${s.label} brush`} aria-keyshortcuts={s.key} title={`${s.label} brush (${s.key})`} aria-pressed={pad.size === s.id} onClick={() => pad.setSize(s.id)}>
          <span className="sketch-dot" data-size={s.id} aria-hidden="true" />
        </button>
      ))}
      <span className="sketch-tools-gap" aria-hidden="true" />
      <button type="button" className="icon-button" aria-label="Undo stroke" aria-keyshortcuts="Control+Z" title="Undo stroke (Ctrl+Z)" disabled={!pad.canUndo} onClick={pad.undo}>
        <Undo2 size={16} aria-hidden="true" />
      </button>
      <span className="sketch-keys" role="note" aria-label={`Keyboard shortcuts: ${SKETCH_SHORTCUTS}`} title={SKETCH_SHORTCUTS}>
        <Keyboard size={16} aria-hidden="true" />
      </span>
    </div>
  )
}
