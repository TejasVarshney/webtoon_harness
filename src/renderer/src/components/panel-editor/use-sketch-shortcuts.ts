import { useEffect, useLayoutEffect, useRef } from 'react'
import type { SketchCanvas, SketchSize, SketchTool } from './use-sketch-pad'
import { stepZoom, type StageZoom } from './use-stage-zoom'

/** The key that picks each tool, as the toolbar shows it. */
export const SKETCH_TOOL_KEYS: Record<SketchTool, string> = { pen: 'B', eraser: 'E', line: 'L', rect: 'R', ellipse: 'O' }

const SIZES: SketchSize[] = ['fine', 'medium', 'bold']

/** Every shortcut of a sketch, in one line, for the toolbar's keyboard hint. */
export const SKETCH_SHORTCUTS =
  'B or P pen, E eraser, L line, R rectangle, O ellipse. [ and ] or 1, 2, 3 brush size. Ctrl+Z undo. + and - zoom, 0 fits. Hold Shift to keep a shape straight or even. Drag with the right button, or hold Space and drag, to move around.'

const TOOL_BY_KEY: Record<string, SketchTool> = { b: 'pen', p: 'pen', e: 'eraser', l: 'line', r: 'rect', o: 'ellipse' }

/** Keys typed here are text. The strip's undo keys use it too. */
export function typingIn(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('textarea, input, select, [contenteditable]:not([contenteditable="false"])') !== null
}

/** Keys typed here are text, and an open dialog has the keyboard. */
function notForUs(target: EventTarget | null): boolean {
  return document.querySelector('[role="dialog"]') !== null || typingIn(target)
}

export interface SketchShortcutsOptions {
  pad: Pick<SketchCanvas, 'setTool' | 'size' | 'setSize' | 'canUndo' | 'undo'>
  /** The stage's zoom, for + - and 0. */
  zoom?: { zoom: number; control: StageZoom }
}

/**
 * The keyboard of a sketch on screen, as in drawing apps: a letter picks a tool (B or P pen, E eraser, L line,
 * R rectangle, O ellipse), [ and ] or 1, 2, 3 set the brush, Ctrl+Z undoes a stroke, and + - and 0 zoom in, out and
 * back to the fit. Typing in a field, and an open dialog, keep their keys. Space and the right button move the stage
 * (`useStagePan`).
 */
export function useSketchShortcuts({ pad, zoom }: SketchShortcutsOptions): void {
  const latest = useRef({ pad, zoom })
  useLayoutEffect(() => {
    latest.current = { pad, zoom }
  })

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (e.defaultPrevented || e.isComposing || notForUs(e.target)) return
      const { pad: p, zoom: z } = latest.current
      const key = e.key.toLowerCase()
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && key === 'z') {
        e.preventDefault()
        if (p.canUndo) p.undo()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const tool = TOOL_BY_KEY[key]
      if (tool !== undefined) {
        p.setTool(tool)
      } else if (key === '[' || key === ']') {
        const i = SIZES.indexOf(p.size) + (key === ']' ? 1 : -1)
        p.setSize(SIZES[Math.max(0, Math.min(SIZES.length - 1, i))])
      } else if (key === '1' || key === '2' || key === '3') {
        p.setSize(SIZES[Number(key) - 1])
      } else if (z !== undefined && (key === '+' || key === '=')) {
        z.control.zoomTo(stepZoom(z.zoom, 1))
      } else if (z !== undefined && (key === '-' || key === '_')) {
        z.control.zoomTo(stepZoom(z.zoom, -1))
      } else if (z !== undefined && key === '0') {
        z.control.zoomTo(1)
      } else {
        return
      }
      e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
