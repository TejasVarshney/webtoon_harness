import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { clampZoom, type StageZoom } from './use-stage-zoom'
import { centred, panBy, paperSize, zoomAt, type Frame, type PaperView } from './paper-view'

/** Without a height of its own, the frame is never taller than this share of the window. */
const FRAME_MAX_HEIGHT = 0.5

export interface PaperViewOptions {
  /** The frame's height: a number, or null while it is not known yet. Left out, the paper's height at the frame's width, within half the window. */
  height?: number | null
  /** A zoom held outside (the workspace keeps one per panel), and how to ask for a new one. Left out, the view keeps its own. */
  zoom?: number
  onZoom?(zoom: number): void
}

export interface PaperViewState {
  zoom: number
  /** For the zoom bar and the keys: zooms at a point of the screen, or the frame's middle. */
  control: StageZoom
  /** Moves the paper by a drag's travel, as far as it stays in sight (`useStagePan`'s `move`). */
  move(dx: number, dy: number): void
  /** The paper's place and size in the frame, in px. */
  paper: { x: number; y: number; width: number; height: number }
  /** The frame's height, once it is known. */
  frameStyle: CSSProperties
  /** The paper's place and size in the frame, with its zoom as `--zoom`. */
  paperStyle: CSSProperties
}

/**
 * A paper at `ratio` (width over height) in a frame as wide as `frame`'s element. The paper moves and zooms inside it,
 * always in sight: the wheel zooms at the pointer, with or without Ctrl, and a paper smaller than the frame stays
 * wholly inside while one larger always covers it (see `paper-view.ts`). A new frame size or aspect puts the paper
 * back in the middle at its zoom.
 */
export function usePaperView(frame: RefObject<HTMLElement | null>, ratio: number, options: PaperViewOptions = {}): PaperViewState {
  const { height, zoom: heldZoom, onZoom } = options
  const [width, setWidth] = useState(0)
  const [view, setView] = useState<PaperView>({ zoom: heldZoom ?? 1, x: 0, y: 0 })
  const [windowHeight, setWindowHeight] = useState(() => window.innerHeight)
  const ownHeight = ratio > 0 ? Math.min(windowHeight * FRAME_MAX_HEIGHT, width / ratio) : 0
  const frameHeight = height === undefined ? ownHeight : (height ?? 0)
  const size: Frame = { width, height: frameHeight }

  const latest = useRef({ size, ratio, onZoom })
  useLayoutEffect(() => {
    latest.current = { size, ratio, onZoom }
  })

  useLayoutEffect(() => {
    const el = frame.current
    if (el === null) return
    const target = el
    function measure(): void {
      setWidth(target.clientWidth)
      setWindowHeight(window.innerHeight)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(target)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [frame])

  useLayoutEffect(() => {
    setView((v) => centred(v.zoom, { width, height: frameHeight }, ratio))
  }, [width, frameHeight, ratio])

  /** Zooms to what `next` makes of the zoom at the time, at a point of the screen or the frame's middle. */
  function zoomWith(next: (zoom: number) => number, at?: { clientX: number; clientY: number }): void {
    const { size: s, ratio: r, onZoom: tell } = latest.current
    const box = frame.current?.getBoundingClientRect()
    const point = at && box ? { x: at.clientX - box.left, y: at.clientY - box.top } : { x: s.width / 2, y: s.height / 2 }
    setView((v) => {
      const zoomed = zoomAt(v, clampZoom(next(v.zoom)), point, s, r)
      if (tell !== undefined && zoomed.zoom !== v.zoom) queueMicrotask(() => tell(zoomed.zoom))
      return zoomed
    })
  }
  const control = useRef<StageZoom>({ zoomTo: () => undefined })
  control.current.zoomTo = (next, at) => zoomWith(() => next, at)
  const zoomWithRef = useRef(zoomWith)
  zoomWithRef.current = zoomWith

  // A zoom set outside (another stage of the same panel, or a new panel) is taken about the frame's middle.
  useLayoutEffect(() => {
    if (heldZoom === undefined) return
    const { size: s, ratio: r } = latest.current
    setView((v) => (v.zoom === heldZoom ? v : zoomAt(v, heldZoom, { x: s.width / 2, y: s.height / 2 }, s, r)))
  }, [heldZoom])

  // The wheel zooms at the pointer, with or without Ctrl, instead of scrolling the page; React's wheel is passive.
  useEffect(() => {
    const el = frame.current
    if (el === null) return
    function onWheel(e: WheelEvent): void {
      e.preventDefault()
      // Each step from the zoom as it stands, so a quick run of steps adds up.
      const factor = Math.exp(-e.deltaY * 0.002)
      zoomWithRef.current((zoom) => zoom * factor, e)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [frame])

  const move = (dx: number, dy: number): void => {
    const { size: s, ratio: r } = latest.current
    setView((v) => panBy(v, dx, dy, s, r))
  }

  const paper = paperSize(view.zoom, size, ratio)
  return {
    zoom: view.zoom,
    control: control.current,
    move,
    paper: { x: view.x, y: view.y, width: paper.width, height: paper.height },
    frameStyle: frameHeight > 0 ? { height: frameHeight } : {},
    paperStyle: { left: view.x, top: view.y, width: paper.width, height: paper.height, '--zoom': String(view.zoom) } as CSSProperties
  }
}
