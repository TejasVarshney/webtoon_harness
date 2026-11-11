import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react'
import { ZoomIn, ZoomOut } from 'lucide-react'

/** Zoom is relative to the fit: 1 shows the whole panel. */
export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 4
const ZOOM_STEP = 1.25

export function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
}

/** The zoom one step in or out from `zoom`, within the limits; a step that lands near the fit lands on it. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const next = clampZoom(direction === 1 ? zoom * ZOOM_STEP : zoom / ZOOM_STEP)
  return Math.abs(next - 1) < 0.05 ? 1 : next
}

/** Where a zoom is anchored: a point of the panel (as fractions of it) that stays under a point of the screen. */
interface Anchor {
  fx: number
  fy: number
  clientX: number
  clientY: number
}

export interface StageZoom {
  /** Zooms to `next`, keeping the panel point under `at` (by default the viewport's centre) where it is. */
  zoomTo(next: number, at?: { clientX: number; clientY: number }): void
}

/**
 * Zoom for a stage: `zoom` is held by the caller (the workspace keeps one per panel, whichever stage shows it), and
 * `onZoom` asks for a new one. After a zoom the viewport scrolls so the anchored point of `target` stays put. Ctrl and
 * the wheel, and a trackpad pinch (which arrives as one), zoom at the pointer instead of zooming the window; React
 * listens to the wheel passively, so that listener is the viewport's own.
 */
export function useStageZoom(viewport: RefObject<HTMLElement | null>, target: RefObject<HTMLElement | null>, zoom: number, onZoom: (zoom: number) => void): StageZoom {
  const anchor = useRef<Anchor | null>(null)

  function zoomTo(next: number, at?: { clientX: number; clientY: number }): void {
    const t = target.current
    const v = viewport.current
    if (t !== null && v !== null) {
      const box = t.getBoundingClientRect()
      const view = v.getBoundingClientRect()
      const point = at ?? { clientX: view.left + view.width / 2, clientY: view.top + view.height / 2 }
      if (box.width > 0 && box.height > 0) anchor.current = { fx: (point.clientX - box.left) / box.width, fy: (point.clientY - box.top) / box.height, clientX: point.clientX, clientY: point.clientY }
    }
    onZoom(clampZoom(next))
  }

  useLayoutEffect(() => {
    const a = anchor.current
    const t = target.current
    const v = viewport.current
    anchor.current = null
    if (a === null || t === null || v === null) return
    const box = t.getBoundingClientRect()
    v.scrollLeft += box.left + a.fx * box.width - a.clientX
    v.scrollTop += box.top + a.fy * box.height - a.clientY
  }, [zoom, target, viewport])

  const latest = useRef({ zoomTo, zoom })
  useLayoutEffect(() => {
    latest.current = { zoomTo, zoom }
  })
  useEffect(() => {
    const v = viewport.current
    if (v === null) return
    function onWheel(e: WheelEvent): void {
      if (!e.ctrlKey) return
      e.preventDefault()
      latest.current.zoomTo(latest.current.zoom * Math.exp(-e.deltaY * 0.002), e)
    }
    v.addEventListener('wheel', onWheel, { passive: false })
    return () => v.removeEventListener('wheel', onWheel)
  }, [viewport])

  return { zoomTo }
}

export interface ZoomBarProps {
  zoom: number
  control: StageZoom
  /** Shown to the left of the controls, such as a save status. */
  children?: ReactNode
}

/** The zoom bar at a stage's bottom right: out, the zoom (a click goes back to the fit) and in. */
export function ZoomBar({ zoom, control, children }: ZoomBarProps) {
  const percent = `${Math.round(zoom * 100)}%`
  return (
    // A press here is not a press on the stage: it neither clears the selected bubble nor starts a stroke.
    <div className="stage-zoom" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {children}
      <div className="stage-zoom-controls" role="group" aria-label="Zoom">
        <button type="button" className="icon-button" aria-label="Zoom out" title="Zoom out (- or Ctrl + wheel)" disabled={zoom <= MIN_ZOOM} onClick={() => control.zoomTo(stepZoom(zoom, -1))}>
          <ZoomOut size={16} aria-hidden="true" />
        </button>
        <button type="button" className="stage-zoom-level" aria-label={`Zoom ${percent}, fit to the stage`} title={zoom === 1 ? 'Fit to the stage (0)' : 'Fit to the stage (0). Move around with a right-button drag, or hold Space and drag'} disabled={zoom === 1} onClick={() => control.zoomTo(1)}>
          {percent}
        </button>
        <button type="button" className="icon-button" aria-label="Zoom in" title="Zoom in (+ or Ctrl + wheel). Once zoomed, drag with the right button, or hold Space and drag, to move around" disabled={zoom >= MAX_ZOOM} onClick={() => control.zoomTo(stepZoom(zoom, 1))}>
          <ZoomIn size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
