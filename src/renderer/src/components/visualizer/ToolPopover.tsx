import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { GripHorizontal } from 'lucide-react'

export type Rect = { left: number; right: number; top: number; bottom: number }

const POPOVER_WIDTH = 340
const POPOVER_MARGIN = 8
/** The room under or over a button that is enough to open there, before the side with more room is taken. */
const POPOVER_COMFORT = 280
const MIN_POPOVER_HEIGHT = 120
/** How much of a moved popover's head stays in the window, so it can always be dragged back. */
const KEEP_HEAD_PX = 40
/** How far an arrow on the head moves it; with Shift, five times as far. */
const KEY_STEP_PX = 10

/**
 * Where the user put each popover, by its label (Lines, Layout, Versions, Background): a moved popover opens there
 * again, until it is put back by its button. For this run of the app only.
 */
const moved = new Map<string, { left: number; top: number }>()

/** Where a popover sits for the button it opens from: fixed to the window, so neither the strip nor the pane can clip it. */
function spotFor(button: Element, avoid: Rect | null, height: number): { left: number; top?: number; bottom?: number; maxHeight: number; width: number } {
  const rect = button.getBoundingClientRect()
  const width = Math.min(POPOVER_WIDTH, window.innerWidth - 2 * POPOVER_MARGIN)
  const left = Math.max(POPOVER_MARGIN, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - POPOVER_MARGIN))
  const below = window.innerHeight - rect.bottom - POPOVER_MARGIN - 4
  const above = rect.top - POPOVER_MARGIN - 4
  // A button scrolled out of the window keeps the popover inside it, at the edge it left by.
  const room = (edge: number): number => Math.max(POPOVER_MARGIN, Math.min(edge, window.innerHeight - MIN_POPOVER_HEIGHT - POPOVER_MARGIN))
  const topEdge = room(rect.bottom + 4)
  const bottomEdge = room(window.innerHeight - rect.top + 4)
  // Where it would open over the bubble the user is working on, it goes below that bubble, or above it with no room below.
  if (avoid !== null && below >= POPOVER_COMFORT && avoid.right > left && avoid.left < left + width && avoid.bottom > topEdge && avoid.top < topEdge + height) {
    const under = room(avoid.bottom + POPOVER_MARGIN)
    if (window.innerHeight - under - POPOVER_MARGIN >= POPOVER_COMFORT) return { left, width, top: under, maxHeight: window.innerHeight - under - POPOVER_MARGIN }
    const over = room(window.innerHeight - avoid.top + POPOVER_MARGIN)
    return { left, width, bottom: over, maxHeight: Math.max(window.innerHeight - over - POPOVER_MARGIN, MIN_POPOVER_HEIGHT) }
  }
  return below >= POPOVER_COMFORT || below >= above
    ? { left, width, top: topEdge, maxHeight: Math.max(window.innerHeight - topEdge - POPOVER_MARGIN, MIN_POPOVER_HEIGHT) }
    : { left, width, bottom: bottomEdge, maxHeight: Math.max(window.innerHeight - bottomEdge - POPOVER_MARGIN, MIN_POPOVER_HEIGHT) }
}

/** A moved popover's corner, kept so its head stays in the window. */
function keepInWindow(at: { left: number; top: number }, width: number): { left: number; top: number } {
  return {
    left: Math.min(window.innerWidth - KEEP_HEAD_PX, Math.max(KEEP_HEAD_PX - width, at.left)),
    top: Math.min(window.innerHeight - KEEP_HEAD_PX, Math.max(0, at.top))
  }
}

export interface ToolPopoverProps {
  label: string
  anchor: Element
  /** Closes it, and `focusBack` says the focus should return to the button that opened it. */
  onClose(focusBack: boolean): void
  /** Opened by clicking a bubble, which keeps the focus for its keys: the popover does not take it. */
  quiet?: boolean
  /** The box of the bubble being worked on, which the popover keeps clear of. */
  avoid?(): Rect | null
  children: ReactNode
}

/**
 * A panel of controls beside a tool's button, in the window's own layer. A press elsewhere or Escape closes it. Its head
 * moves it anywhere in the window: by dragging, or by the arrow keys once it has the focus. A moved popover stays where
 * it was put, rather than following its button, and opens there again; a double-click on the head puts it back by its
 * button.
 */
export function ToolPopover({ label, anchor, onClose, quiet = false, avoid, children }: ToolPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const place = (): ReturnType<typeof spotFor> => {
    const height = ref.current?.getBoundingClientRect().height
    return spotFor(anchor, avoid?.() ?? null, height !== undefined && height > 0 ? height : POPOVER_COMFORT)
  }
  const [spot, setSpot] = useState(place)
  const [at, setAt] = useState<{ left: number; top: number } | null>(() => moved.get(label) ?? null)
  const drag = useRef<{ pointerId: number; dx: number; dy: number } | null>(null)

  /** Puts the popover at `next`, kept in the window, and remembers it for the next time it opens. */
  function moveTo(next: { left: number; top: number }): void {
    const kept = keepInWindow(next, spot.width)
    moved.set(label, kept)
    setAt(kept)
  }

  function putBack(): void {
    moved.delete(label)
    setAt(null)
  }

  // The first focus goes in, so the next Tab is in the controls: the popover is at the end of the page, not by its button.
  useEffect(() => {
    if (!quiet) ref.current?.focus({ preventScroll: true })
  }, [quiet])
  // The bar slides along the card when the card is moved or the strip is resized: the button is somewhere else now.
  // Also when the bubble moves: it is read on every render, and the spot only changes when it moves.
  useLayoutEffect(() => {
    const next = place()
    setSpot((now) => (now.left === next.left && now.top === next.top && now.bottom === next.bottom && now.maxHeight === next.maxHeight && now.width === next.width ? now : next))
  })

  useEffect(() => {
    function onPress(e: PointerEvent): void {
      const target = e.target
      // The panel's own bubbles are not outside it: pressing one is choosing the line it shows.
      if (target instanceof Node && (ref.current?.contains(target) || anchor.closest('.strip-bubbles')?.contains(target))) return
      onClose(false)
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && !e.defaultPrevented && !e.isComposing) onClose(true)
    }
    // It follows its button when the strip scrolls or the window is resized. Its own list scrolling is not the strip's.
    const follow = (e: Event): void => {
      if (e.target instanceof Node && ref.current?.contains(e.target)) return
      setSpot(place())
      // A moved one stays put, but not out of a window made smaller.
      setAt((now) => (now === null ? now : keepInWindow(now, ref.current?.getBoundingClientRect().width ?? POPOVER_WIDTH)))
    }
    document.addEventListener('pointerdown', onPress, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', follow, true)
    window.addEventListener('resize', follow)
    return () => {
      document.removeEventListener('pointerdown', onPress, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('resize', follow)
    }
  }, [anchor, onClose])

  function startDrag(e: ReactPointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    e.preventDefault()
    const box = ref.current?.getBoundingClientRect()
    const corner = at ?? { left: box?.left ?? spot.left, top: box?.top ?? spot.top ?? 0 }
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { pointerId: e.pointerId, dx: e.clientX - corner.left, dy: e.clientY - corner.top }
  }

  function followDrag(e: ReactPointerEvent<HTMLDivElement>): void {
    const d = drag.current
    if (d === null || d.pointerId !== e.pointerId) return
    moveTo({ left: e.clientX - d.dx, top: e.clientY - d.dy })
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>): void {
    if (drag.current?.pointerId === e.pointerId) drag.current = null
  }

  function onHeadKey(e: ReactKeyboardEvent<HTMLDivElement>): void {
    const way = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
    if (way === undefined) return
    e.preventDefault()
    e.stopPropagation()
    const box = ref.current?.getBoundingClientRect()
    const corner = at ?? { left: box?.left ?? spot.left, top: box?.top ?? spot.top ?? 0 }
    const step = (e.shiftKey ? 5 : 1) * KEY_STEP_PX
    moveTo({ left: corner.left + way[0] * step, top: corner.top + way[1] * step })
  }

  const style =
    at === null
      ? { left: spot.left, top: spot.top, bottom: spot.bottom, width: spot.width, maxHeight: spot.maxHeight }
      : { left: at.left, top: at.top, width: spot.width, maxHeight: Math.max(MIN_POPOVER_HEIGHT, window.innerHeight - at.top - POPOVER_MARGIN) }
  return createPortal(
    // Clicks stop here, in the React tree the portal shares with whatever opened it, so one never reaches a strip behind it.
    <div ref={ref} className="tool-popover" role="dialog" aria-label={label} tabIndex={-1} data-moved={at !== null || undefined} style={style} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div
        className="tool-popover-head"
        role="button"
        tabIndex={0}
        aria-label={`Move ${label}`}
        title="Drag to move it anywhere (or use the arrow keys). Double-click to put it back by its button."
        onPointerDown={startDrag}
        onPointerMove={followDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onDoubleClick={putBack}
        onKeyDown={onHeadKey}
      >
        <GripHorizontal size={14} aria-hidden="true" />
        <span>{label}</span>
      </div>
      {children}
    </div>,
    document.body
  )
}
