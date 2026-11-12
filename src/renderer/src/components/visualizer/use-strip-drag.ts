import { useCallback, useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { clampGroupDelta, clampPlacement, type PlacedPanel } from '@shared/strip-canvas'
import { STRIP_CSS_WIDTH } from '@shared/strip-width'
import type { PanelPlacement } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { usePanelsStore } from '../../stores/panels-store'
import { flushBeforeStep } from '../../stores/strip-history-store'
import { errorText } from '../characters/controls'
import { DRAG_THRESHOLD_PX, NUDGE_COMMIT_MS } from '../panel-editor/bubble-placement'

/** One arrow key press moves a panel this far, and one with Shift this far, in strip px. */
const NUDGE_PX = 1
const NUDGE_BIG_PX = 10

const ARROW_STEP: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 }
}

/** Presses that start on these belong to the control (the panel's tools, their popovers and the delete dialog, later a bubble), not to the card. */
const CONTROL_SELECTOR = 'button, a, input, textarea, select, [role="dialog"], .panel-tools'

type Previews = Record<string, PanelPlacement>

/** What every gesture knows: where the pointer went down and is now, and how far the pane had scrolled at the press. */
interface Pointing {
  id: string
  pointerId: number
  start: { x: number; y: number }
  /** The pointer's last position on the window, which a scroll without a move is applied at. */
  at: { x: number; y: number }
  scale: number
  /** The pane the strip scrolls in, and its `scrollTop` at the press: travel is the pointer's plus what the pane has scrolled since. */
  pane: HTMLElement | null
  scrollFrom: number
  moved: Previews
}

type Gesture = (Pointing & { kind: 'move'; ids: string[]; dragging: boolean }) | (Pointing & { kind: 'resize'; from: PanelPlacement })

/** Within this many px of the pane's top or bottom edge, a drag scrolls the pane. */
const EDGE_PX = 40
/** The fastest the pane scrolls while dragging, in px per tick of `SCROLL_TICK_MS`. */
const EDGE_MAX_STEP = 24
const SCROLL_TICK_MS = 16

/** How far the pane scrolls this tick for a pointer at `y`: negative up, positive down, 0 away from both edges. Faster the nearer the edge, and past it. */
function edgeStep(y: number, top: number, bottom: number): number {
  const up = EDGE_PX - (y - top)
  const down = EDGE_PX - (bottom - y)
  if (up > 0) return -Math.max(2, Math.round((Math.min(up, EDGE_PX) / EDGE_PX) * EDGE_MAX_STEP))
  if (down > 0) return Math.max(2, Math.round((Math.min(down, EDGE_PX) / EDGE_PX) * EDGE_MAX_STEP))
  return 0
}

/** The nearest ancestor that scrolls vertically: what the strip moves under while a panel is dragged. */
function scrollPaneOf(el: Element): HTMLElement | null {
  for (let node = el.parentElement; node !== null; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return node
  }
  return null
}

export interface StripDrag {
  /** Where the panels being moved or resized are drawn until their save lands, by panel id. */
  previews: Previews
  /** The text of the last save that failed, until the next gesture. */
  error: string | null
  bindCard(id: string): HTMLAttributes<HTMLElement>
  bindResize(id: string): HTMLAttributes<HTMLElement>
}

/** How many strip px one screen px is: the canvas may be scaled by the pane. */
function scaleOf(el: Element): number {
  const width = el.closest('.strip-canvas')?.getBoundingClientRect().width ?? 0
  return width > 0 ? width / STRIP_CSS_WIDTH : 1
}

/**
 * Moving, resizing and nudging the panels of the strip. A press on a card that travels past the drag threshold moves
 * it, or the whole selection when the card is part of one; a press on an unselected card selects it first. The handle
 * at a card's corner sets its width, and the height follows the aspect. Arrow keys on a focused card nudge it. Every
 * gesture ends in one save, and the preview stays until the strip has reloaded, so the panel never steps back.
 * `placed` is the strip as it is saved, which a gesture's moves are measured from.
 */
export function useStripDrag(placed: PlacedPanel[]): StripDrag {
  const [previews, setPreviewsState] = useState<Previews>({})
  const [error, setError] = useState<string | null>(null)
  const placedRef = useRef(placed)
  // What the gesture in hand shows, and what saves still in flight show. A save's landing only drops what it still owns,
  // so a gesture or a later save on the same panel keeps its preview.
  const drafts = useRef<Previews>({})
  const held = useRef<Previews>({})
  const holder = useRef<Record<string, number>>({})
  const saveCount = useRef(0)
  const gesture = useRef<Gesture | null>(null)
  // The pane scrolling under a drag near its edge, and the listener that follows a scroll the user makes with the wheel.
  const autoScroll = useRef<{ timer: ReturnType<typeof setInterval> | null; step: number }>({ timer: null, step: 0 })
  const unwatchScroll = useRef<(() => void) | null>(null)
  const nudge = useRef<{ ids: string[]; dx: number; dy: number } | null>(null)
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Set by a drag that just ended, so the click that follows it is not taken as a selection. It only lives until that
  // click would have been sent.
  const justDragged = useRef(false)

  const publish = useCallback(() => setPreviewsState({ ...held.current, ...drafts.current }), [])
  const setDrafts = useCallback(
    (next: Previews) => {
      drafts.current = next
      publish()
    },
    [publish]
  )

  useLayoutEffect(() => {
    placedRef.current = placed
    // A card that is gone cannot be dragged on, and what was shown for it is no longer wanted.
    const here = new Set(placed.map((p) => p.panel.id))
    const g = gesture.current
    if (g !== null && (!here.has(g.id) || (g.kind === 'move' && g.ids.some((id) => !here.has(id))))) {
      gesture.current = null
      drafts.current = {}
    }
    for (const id of Object.keys(held.current)) {
      if (!here.has(id)) {
        delete held.current[id]
        delete holder.current[id]
      }
    }
    for (const id of Object.keys(drafts.current)) if (!here.has(id)) delete drafts.current[id]
    publish()
  }, [placed, publish])

  const save = useCallback(
    (moves: Previews, label: 'move' | 'resize') => {
      const episodeId = placedRef.current[0]?.panel.episodeId
      if (episodeId === undefined || Object.keys(moves).length === 0) {
        setDrafts({})
        return
      }
      const mine = ++saveCount.current
      const ids = Object.keys(moves)
      for (const id of ids) {
        held.current[id] = moves[id]
        holder.current[id] = mine
      }
      setDrafts({})
      const done = (): void => {
        for (const id of ids) {
          if (holder.current[id] !== mine) continue
          delete held.current[id]
          delete holder.current[id]
        }
        publish()
      }
      const list = ids.map((panelId) => ({ panelId, placement: moves[panelId] }))
      usePanelsStore
        .getState()
        .placePanels(episodeId, list, label)
        .then(done, (e: unknown) => {
          done()
          setError(errorText(e))
        })
    },
    [publish, setDrafts]
  )

  /** The placements of `ids` after moving them by (dx, dy), the group held inside the strip. */
  const shifted = useCallback((ids: string[], dx: number, dy: number): { moves: Previews; dx: number; dy: number } => {
    // From where a panel is shown: a save still in flight has moved it already.
    const group = placedRef.current.filter((p) => ids.includes(p.panel.id)).map((p) => ({ ...p, ...held.current[p.panel.id] }))
    const delta = clampGroupDelta(group, dx, dy)
    const moves: Previews = {}
    for (const p of group) moves[p.panel.id] = clampPlacement({ x: Math.round(p.x + delta.dx), y: Math.round(p.y + delta.dy), width: Math.round(p.width) }, p.panel.aspect)
    return { moves, ...delta }
  }, [])

  const flushNudge = useCallback(() => {
    if (nudgeTimer.current !== null) clearTimeout(nudgeTimer.current)
    nudgeTimer.current = null
    const pending = nudge.current
    nudge.current = null
    if (pending !== null) save(shifted(pending.ids, pending.dx, pending.dy).moves, 'move')
  }, [save, shifted])

  // A run of nudges still waiting must not be lost when the strip goes away, and is saved before an undo starts.
  useEffect(() => flushNudge, [flushNudge])
  useEffect(() => flushBeforeStep(flushNudge), [flushNudge])

  const stopScrolling = useCallback(() => {
    if (autoScroll.current.timer !== null) clearInterval(autoScroll.current.timer)
    autoScroll.current = { timer: null, step: 0 }
    unwatchScroll.current?.()
    unwatchScroll.current = null
  }, [])

  // The pane must not keep scrolling, or listening, once the strip is gone.
  useEffect(() => stopScrolling, [stopScrolling])

  const endGesture = useCallback(
    (e: PointerEvent<HTMLElement>, commit: boolean) => {
      const g = gesture.current
      if (g === null || e.pointerId !== g.pointerId) return
      gesture.current = null
      stopScrolling()
      const dragged = g.kind === 'resize' || g.dragging
      if (!dragged) return
      // Only a drag that ends in a release is followed by a click.
      if (g.kind === 'move' && commit) {
        justDragged.current = true
        setTimeout(() => (justDragged.current = false), 0)
      }
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      if (commit) save(g.moved, g.kind === 'resize' ? 'resize' : 'move')
      else setDrafts({})
    },
    [save, setDrafts, stopScrolling]
  )

  /** Shows the gesture with the pointer at (x, y) on the window and the pane as scrolled now. */
  const follow = useCallback(
    (g: Gesture, x: number, y: number) => {
      g.at = { x, y }
      const dx = (x - g.start.x) / g.scale
      // The strip moves under a pointer that holds still while the pane scrolls, so the panel goes with it.
      const dy = (y - g.start.y + (g.pane === null ? 0 : g.pane.scrollTop - g.scrollFrom)) / g.scale
      if (g.kind === 'resize') {
        // The height follows the aspect, so only the width is set; the panel keeps its corner and stays inside the strip.
        const width = Math.min(g.from.width + dx, STRIP_CSS_WIDTH - g.from.x)
        const aspect = placedRef.current.find((p) => p.panel.id === g.id)?.panel.aspect
        if (aspect === undefined) return
        const next = clampPlacement({ ...g.from, width: Math.round(width) }, aspect)
        g.moved = next.width === g.from.width ? {} : { [g.id]: next }
        setDrafts(g.moved)
        return
      }
      if (!g.dragging) {
        // Only the pointer's own travel starts a drag, so a scroll alone never moves a panel.
        if (Math.hypot(x - g.start.x, y - g.start.y) < DRAG_THRESHOLD_PX) return
        g.dragging = true
        if (!useAppStore.getState().selectedPanelIds.includes(g.id)) useAppStore.getState().selectPanel(g.id)
      }
      g.moved = shifted(g.ids, dx, dy).moves
      setDrafts(g.moved)
    },
    [setDrafts, shifted]
  )

  /** While a panel is dragged near the top or bottom of its pane, the pane scrolls so it can go further than one screen. */
  const edgeScroll = useCallback(
    (g: Gesture) => {
      const pane = g.pane
      const rect = pane?.getBoundingClientRect()
      const step = g.kind === 'move' && g.dragging && pane !== null && rect !== undefined ? edgeStep(g.at.y, rect.top, rect.bottom) : 0
      autoScroll.current.step = step
      if (step === 0) {
        if (autoScroll.current.timer !== null) clearInterval(autoScroll.current.timer)
        autoScroll.current.timer = null
        return
      }
      if (autoScroll.current.timer !== null) return
      autoScroll.current.timer = setInterval(() => {
        const now = gesture.current
        if (now === null || now.pane === null) return stopScrolling()
        now.pane.scrollTop += autoScroll.current.step
        follow(now, now.at.x, now.at.y)
      }, SCROLL_TICK_MS)
    },
    [follow, stopScrolling]
  )

  const onMove = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const g = gesture.current
      if (g === null || e.pointerId !== g.pointerId) return
      // No button is down: the release happened where the card could not see it, so the gesture is over.
      if ((e.buttons & 1) === 0) {
        endGesture(e, false)
        return
      }
      follow(g, e.clientX, e.clientY)
      edgeScroll(g)
    },
    [edgeScroll, endGesture, follow]
  )

  /** Starts a gesture's bookkeeping: the pane it scrolls in, listened to so a wheel scroll during it moves the panel too. */
  const point = useCallback(
    (el: HTMLElement, e: PointerEvent<HTMLElement>, id: string): Pointing => {
      stopScrolling()
      const pane = scrollPaneOf(el)
      if (pane !== null) {
        const onScroll = (): void => {
          const g = gesture.current
          if (g !== null) follow(g, g.at.x, g.at.y)
        }
        pane.addEventListener('scroll', onScroll)
        unwatchScroll.current = () => pane.removeEventListener('scroll', onScroll)
      }
      return { id, pointerId: e.pointerId, start: { x: e.clientX, y: e.clientY }, at: { x: e.clientX, y: e.clientY }, scale: scaleOf(el), pane, scrollFrom: pane?.scrollTop ?? 0, moved: {} }
    },
    [follow, stopScrolling]
  )

  const bindCard = useCallback(
    (id: string): HTMLAttributes<HTMLElement> => ({
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        if (e.button !== 0 || e.shiftKey) return
        if (e.target instanceof Element && e.target.closest(CONTROL_SELECTOR) !== null) return
        flushNudge()
        justDragged.current = false
        setError(null)
        // Taken now, so a move that leaves the card (a press at its edge, a fast move) still reaches it.
        e.currentTarget.setPointerCapture?.(e.pointerId)
        const selected = useAppStore.getState().selectedPanelIds
        gesture.current = { ...point(e.currentTarget, e, id), kind: 'move', ids: selected.includes(id) ? selected : [id], dragging: false }
      },
      onPointerMove: onMove,
      onPointerUp: (e: PointerEvent<HTMLElement>) => endGesture(e, true),
      onPointerCancel: (e: PointerEvent<HTMLElement>) => endGesture(e, false),
      onLostPointerCapture: (e: PointerEvent<HTMLElement>) => endGesture(e, false),
      onClickCapture: (e: MouseEvent<HTMLElement>) => {
        if (!justDragged.current) return
        justDragged.current = false
        e.stopPropagation()
      },
      onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
        // Only the card itself: an arrow in a toolbar button is that button's.
        const step = ARROW_STEP[e.key]
        if (e.target !== e.currentTarget || step === undefined || e.ctrlKey || e.altKey || e.metaKey) return
        e.preventDefault()
        const selected = useAppStore.getState().selectedPanelIds
        const ids = selected.includes(id) ? selected : [id]
        if (nudge.current !== null && nudge.current.ids.join() !== ids.join()) flushNudge()
        const by = e.shiftKey ? NUDGE_BIG_PX : NUDGE_PX
        const held = nudge.current ?? { ids, dx: 0, dy: 0 }
        const next = shifted(ids, held.dx + step.x * by, held.dy + step.y * by)
        nudge.current = { ids, dx: next.dx, dy: next.dy }
        setDrafts(next.moves)
        if (nudgeTimer.current !== null) clearTimeout(nudgeTimer.current)
        nudgeTimer.current = setTimeout(flushNudge, NUDGE_COMMIT_MS)
      }
    }),
    [endGesture, flushNudge, onMove, point, setDrafts, shifted]
  )

  const bindResize = useCallback(
    (id: string): HTMLAttributes<HTMLElement> => ({
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        // The handle is not a press on the card: it neither selects nor drags it.
        e.stopPropagation()
        if (e.button !== 0) return
        const found = placedRef.current.find((q) => q.panel.id === id)
        if (found === undefined) return
        const p = { ...found, ...held.current[id] }
        flushNudge()
        setError(null)
        e.currentTarget.setPointerCapture?.(e.pointerId)
        gesture.current = { ...point(e.currentTarget, e, id), kind: 'resize', from: { x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width) } }
      },
      onPointerMove: onMove,
      onPointerUp: (e: PointerEvent<HTMLElement>) => endGesture(e, true),
      onPointerCancel: (e: PointerEvent<HTMLElement>) => endGesture(e, false),
      onLostPointerCapture: (e: PointerEvent<HTMLElement>) => endGesture(e, false),
      onClick: (e: MouseEvent<HTMLElement>) => e.stopPropagation(),
      onDoubleClick: (e: MouseEvent<HTMLElement>) => e.stopPropagation()
    }),
    [endGesture, flushNudge, onMove, point]
  )

  return { previews, error, bindCard, bindResize }
}
