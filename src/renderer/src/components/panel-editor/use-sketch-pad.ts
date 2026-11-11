import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import type { Panel } from '@shared/types'
import { usePanelsStore } from '../../stores/panels-store'
import { errorText } from '../characters/controls'
import { queueSketchSave } from './panel-save-queue'

export type SketchShape = 'line' | 'rect' | 'ellipse'
export type SketchTool = 'pen' | 'eraser' | SketchShape
export type SketchSize = 'fine' | 'medium' | 'bold'

interface Point {
  x: number
  y: number
}

/** The sketch's longer edge in canvas pixels: plenty for a layout guide, small enough to send as a reference. */
const SKETCH_LONG_EDGE = 1024
/** Brush widths in canvas pixels. The eraser is wider, as erasing is coarser work; shapes draw with the pen's. */
const PEN_WIDTHS: Record<SketchSize, number> = { fine: 3, medium: 8, bold: 18 }
const ERASER_WIDTHS: Record<SketchSize, number> = { fine: 12, medium: 32, bold: 72 }

export function isShape(tool: SketchTool): tool is SketchShape {
  return tool === 'line' || tool === 'rect' || tool === 'ellipse'
}

/**
 * Where a shape's drag really ends. With `constrain` (Shift), a line snaps to the nearest 45 degrees and a rectangle or
 * an ellipse becomes a square or a circle, as wide as the drag's longer side.
 */
export function shapeEnd(shape: SketchShape, start: Point, end: Point, constrain: boolean): Point {
  if (!constrain) return end
  const dx = end.x - start.x
  const dy = end.y - start.y
  if (shape === 'line') {
    const step = Math.PI / 4
    const angle = Math.round(Math.atan2(dy, dx) / step) * step
    const length = Math.hypot(dx, dy)
    return { x: start.x + Math.cos(angle) * length, y: start.y + Math.sin(angle) * length }
  }
  const side = Math.max(Math.abs(dx), Math.abs(dy))
  return { x: start.x + Math.sign(dx || 1) * side, y: start.y + Math.sign(dy || 1) * side }
}

/** Outlines `shape` from `start` to `end` in the current stroke style. */
function drawShape(ctx: CanvasRenderingContext2D, shape: SketchShape, start: Point, end: Point): void {
  ctx.beginPath()
  if (shape === 'line') {
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
  } else if (shape === 'rect') {
    ctx.rect(Math.min(start.x, end.x), Math.min(start.y, end.y), Math.abs(end.x - start.x), Math.abs(end.y - start.y))
  } else {
    ctx.ellipse((start.x + end.x) / 2, (start.y + end.y) / 2, Math.abs(end.x - start.x) / 2, Math.abs(end.y - start.y) / 2, 0, 0, Math.PI * 2)
  }
  ctx.stroke()
}
const INK_RGB = 0x1a
const INK = '#1a1a1a'
const PAPER = '#ffffff'
/** Each step is a full-canvas snapshot (about 3 to 4 MB), so the history stays short. */
const UNDO_LIMIT = 10

/** The canvas size for a panel aspect such as `2:3`: its longer edge is `SKETCH_LONG_EDGE`. */
export function sketchSize(aspect: Panel['aspect']): { width: number; height: number } {
  const [w, h] = aspect.split(':').map(Number)
  return w >= h ? { width: SKETCH_LONG_EDGE, height: Math.round((SKETCH_LONG_EDGE * h) / w) } : { width: Math.round((SKETCH_LONG_EDGE * w) / h), height: SKETCH_LONG_EDGE }
}

// The canvas holds the ink alone, on transparent pixels, so a panel's picture can show through it to trace over. The
// stored sketch is that ink on white paper (`paperPng`), as the image model reads it best.

/** True when no pixel holds ink: such a sketch says nothing, so it is forgotten rather than stored. */
function isBlank(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const data = ctx.getImageData(0, 0, width, height).data
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return false
  return true
}

/** Clears the canvas and draws `image` centred in it, as large as fits. */
function paint(ctx: CanvasRenderingContext2D, width: number, height: number, image?: CanvasImageSource & { width: number; height: number }): void {
  ctx.globalCompositeOperation = 'source-over'
  ctx.clearRect(0, 0, width, height)
  if (image === undefined || image.width <= 0 || image.height <= 0) return
  const scale = Math.min(width / image.width, height / image.height)
  const w = image.width * scale
  const h = image.height * scale
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h)
}

/** Turns a stored sketch's white paper transparent: each pixel keeps as much ink as it is dark. */
function liftPaper(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const image = ctx.getImageData(0, 0, width, height)
  const d = image.data
  for (let i = 0; i < d.length; i += 4) {
    const ink = ((255 - Math.min(d[i], d[i + 1], d[i + 2])) * d[i + 3]) / 255
    d[i] = INK_RGB
    d[i + 1] = INK_RGB
    d[i + 2] = INK_RGB
    d[i + 3] = Math.round(ink)
  }
  ctx.putImageData(image, 0, 0)
}

/** The sketch as it is stored: its ink on white paper, as a PNG data URL. */
function paperPng(canvas: HTMLCanvasElement): string {
  const paper = document.createElement('canvas')
  paper.width = canvas.width
  paper.height = canvas.height
  const ctx = paper.getContext('2d')
  if (ctx === null) return canvas.toDataURL('image/png')
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, paper.width, paper.height)
  ctx.drawImage(canvas, 0, 0)
  return paper.toDataURL('image/png')
}

/** The drawing, with no say in where it is kept. */
export interface SketchCanvas {
  canvasRef: RefObject<HTMLCanvasElement | null>
  /** Spread on the canvas. */
  handlers: {
    onPointerDown(e: PointerEvent<HTMLCanvasElement>): void
    onPointerMove(e: PointerEvent<HTMLCanvasElement>): void
    onPointerUp(e: PointerEvent<HTMLCanvasElement>): void
    onPointerCancel(e: PointerEvent<HTMLCanvasElement>): void
  }
  tool: SketchTool
  setTool(tool: SketchTool): void
  size: SketchSize
  setSize(size: SketchSize): void
  canUndo: boolean
  undo(): void
  /** Wipes every stroke and forgets the stored sketch, to start a new one. Undo brings it back. */
  clear(): void
  /** The canvas holds no ink. */
  blank: boolean
}

export interface SketchPad extends SketchCanvas {
  /** A save of the sketch is on its way. */
  saving: boolean
  /** The last save's failure, or `null`. */
  error: string | null
}

export interface SketchCanvasOptions {
  aspect: Panel['aspect']
  /** A stored sketch (ink on white paper, as a data URL) to load onto the canvas, unless something was drawn first. */
  initialPng: string | null
  /** Called with the sketch (ink on white paper, as a PNG data URL, or `null` when it is blank) each time it changes. */
  onChange(png: string | null): void
  /** Also call `onChange` when a new aspect refits the ink, for a keeper whose copy would otherwise be the wrong shape. */
  changeOnResize?: boolean
}

/**
 * The drawing behind a sketch: a transparent canvas at the aspect (the page puts white paper, or a picture, under it),
 * loaded with the stored sketch, a pen, an eraser and shapes in three widths, undo and a clear for a new sketch. Each
 * finished stroke (and each undo or clear) is handed to `onChange` at once, and a sketch left blank is `null`. Where
 * the sketch is kept is the caller's business.
 */
export function useSketchCanvas({ aspect, initialPng, onChange, changeOnResize = false }: SketchCanvasOptions): SketchCanvas {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tool, setTool] = useState<SketchTool>('pen')
  const [size, setSize] = useState<SketchSize>('medium')
  const [canUndo, setCanUndo] = useState(false)
  const [blank, setBlank] = useState(true)
  const history = useRef<ImageData[]>([])
  // The stroke under way. A shape keeps where it started and the canvas from before it, which each move redraws over.
  const stroke = useRef<{ pointerId: number; x: number; y: number; start: Point; before: ImageData | null } | null>(null)
  // The canvas holds something: a stroke, a clear or the stored sketch. Anything drawn first wins over the stored sketch.
  const touched = useRef(false)
  const { width, height } = sketchSize(aspect)
  // The latest callback, so a stroke that ends after a render still reaches the current keeper.
  const changed = useRef(onChange)
  useLayoutEffect(() => {
    changed.current = onChange
  })

  const context = useCallback((): CanvasRenderingContext2D | null => canvasRef.current?.getContext('2d') ?? null, [])

  const save = useCallback((): void => {
    const canvas = canvasRef.current
    const ctx = context()
    if (canvas === null || ctx === null) return
    const empty = isBlank(ctx, canvas.width, canvas.height)
    setBlank(empty)
    changed.current(empty ? null : paperPng(canvas))
  }, [context])

  // The canvas is sized here, not by attributes: React would clear it on every render that set them. A new aspect keeps
  // what was drawn, fitted into the new shape.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    const ctx = context()
    if (canvas === null || ctx === null || (canvas.width === width && canvas.height === height)) return
    let copy: HTMLCanvasElement | undefined
    if (canvas.width > 0 && canvas.height > 0 && touched.current) {
      copy = document.createElement('canvas')
      copy.width = canvas.width
      copy.height = canvas.height
      copy.getContext('2d')?.drawImage(canvas, 0, 0)
    }
    canvas.width = width
    canvas.height = height
    paint(ctx, width, height, copy)
    history.current = []
    setCanUndo(false)
    if (copy !== undefined && changeOnResize) save()
  }, [width, height, context, changeOnResize, save])

  // The stored sketch arrives as a data URL: an asset URL is another origin and would taint the canvas.
  useEffect(() => {
    if (initialPng === null) return
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      const canvas = canvasRef.current
      const ctx = context()
      if (cancelled || touched.current || canvas === null || ctx === null) return
      paint(ctx, canvas.width, canvas.height, image)
      liftPaper(ctx, canvas.width, canvas.height)
      setBlank(false)
      // The canvas holds the sketch now: a new aspect must carry it over, not start on blank paper.
      touched.current = true
    }
    image.src = initialPng
    return () => {
      cancelled = true
    }
  }, [initialPng, context])

  /** Keeps the canvas as it is now, for undo, and returns it. */
  const remember = useCallback((): ImageData | null => {
    const canvas = canvasRef.current
    const ctx = context()
    if (canvas === null || ctx === null) return null
    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height)
    history.current.push(snapshot)
    if (history.current.length > UNDO_LIMIT) history.current.shift()
    setCanUndo(true)
    return snapshot
  }, [context])

  /** The canvas point under the pointer: the stage scales the canvas, so the client box is measured each time. */
  function point(canvas: HTMLCanvasElement, at: { clientX: number; clientY: number }): { x: number; y: number } {
    const box = canvas.getBoundingClientRect()
    return { x: ((at.clientX - box.left) * canvas.width) / (box.width || 1), y: ((at.clientY - box.top) * canvas.height) / (box.height || 1) }
  }

  function brush(ctx: CanvasRenderingContext2D): void {
    // The eraser takes ink away, back to transparent, whatever shows under the canvas.
    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = INK
    ctx.fillStyle = INK
    ctx.lineWidth = (tool === 'eraser' ? ERASER_WIDTHS : PEN_WIDTHS)[size]
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }

  const handlers: SketchPad['handlers'] = {
    onPointerDown(e) {
      if (e.button !== 0 || stroke.current !== null) return
      const ctx = context()
      if (ctx === null) return
      e.preventDefault()
      e.currentTarget.setPointerCapture?.(e.pointerId)
      const before = remember()
      touched.current = true
      const p = point(e.currentTarget, e)
      stroke.current = { pointerId: e.pointerId, ...p, start: p, before: isShape(tool) ? before : null }
      if (isShape(tool)) return
      brush(ctx)
      // A tap leaves a dot.
      ctx.beginPath()
      ctx.arc(p.x, p.y, ctx.lineWidth / 2, 0, Math.PI * 2)
      ctx.fill()
    },
    onPointerMove(e) {
      const s = stroke.current
      const ctx = context()
      if (s === null || ctx === null || e.pointerId !== s.pointerId) return
      brush(ctx)
      if (isShape(tool)) {
        // The shape so far: the canvas from before it, with the shape drawn to the pointer.
        const end = shapeEnd(tool, s.start, point(e.currentTarget, e), e.shiftKey)
        if (s.before !== null) ctx.putImageData(s.before, 0, 0)
        drawShape(ctx, tool, s.start, end)
        stroke.current = { ...s, ...end }
        return
      }
      // A fast stroke comes in several events per frame; drawing them all keeps its curves.
      const events = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : []
      const points = (events.length > 0 ? events : [e]).map((at) => point(e.currentTarget, at))
      ctx.beginPath()
      ctx.moveTo(s.x, s.y)
      for (const p of points) ctx.lineTo(p.x, p.y)
      ctx.stroke()
      const last = points[points.length - 1]
      stroke.current = { ...s, x: last.x, y: last.y }
    },
    onPointerUp(e) {
      finish(e.pointerId)
    },
    onPointerCancel(e) {
      finish(e.pointerId)
    }
  }

  /** Ends the stroke and stores it. A shape that never got a size (a click) leaves nothing, not even an undo step. */
  function finish(pointerId: number): void {
    const s = stroke.current
    if (s === null || pointerId !== s.pointerId) return
    stroke.current = null
    if (isShape(tool) && s.x === s.start.x && s.y === s.start.y) {
      history.current.pop()
      setCanUndo(history.current.length > 0)
      return
    }
    save()
  }

  function undo(): void {
    const canvas = canvasRef.current
    const ctx = context()
    const last = history.current.pop()
    setCanUndo(history.current.length > 0)
    if (canvas === null || ctx === null || last === undefined) return
    ctx.putImageData(last, 0, 0)
    save()
  }

  function clear(): void {
    const canvas = canvasRef.current
    const ctx = context()
    if (canvas === null || ctx === null) return
    remember()
    touched.current = true
    paint(ctx, canvas.width, canvas.height)
    save()
  }

  return { canvasRef, handlers, tool, setTool, size, setSize, canUndo, undo, clear, blank }
}

/**
 * The sketch of a panel: the canvas above, loaded with the panel's stored sketch. Each change is stored as the panel's
 * sketch, in turn with the panel's other saves, so Generate draws from the last stroke.
 */
export function useSketchPad(panel: Pick<Panel, 'id' | 'aspect'>): SketchPad {
  const panelId = panel.id
  const [stored, setStored] = useState<string | null>(null)
  const [pending, setPending] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    usePanelsStore
      .getState()
      .readSketch(panelId)
      .then((url) => {
        if (!cancelled) setStored(url)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorText(e))
      })
    return () => {
      cancelled = true
    }
  }, [panelId])

  const store = useCallback(
    (png: string | null): void => {
      setPending((n) => n + 1)
      setError(null)
      queueSketchSave(panelId, png).then(
        () => alive.current && setPending((n) => n - 1),
        (e: unknown) => {
          if (!alive.current) return
          setPending((n) => n - 1)
          setError(errorText(e))
        }
      )
    },
    [panelId]
  )

  const canvas = useSketchCanvas({ aspect: panel.aspect, initialPng: stored, onChange: store })
  return { ...canvas, saving: pending > 0, error }
}

