import { useCallback, useEffect, useRef, useState, type HTMLAttributes, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { clampGroupDelta, clampPlacement, type PlacedPanel } from '@shared/strip-canvas'
import { STRIP_CSS_WIDTH } from '@shared/strip-width'
import type { PanelPlacement } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { usePanelsStore } from '../../stores/panels-store'
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

/** Presses that start on these belong to the control (the toolbar, the delete dialog, later a bubble), not to the card. */
const CONTROL_SELECTOR = 'button, a, input, textarea, select, [role="dialog"]'

type Previews = Record<string, PanelPlacement>

type Gesture =
  | { kind: 'move'; id: string; pointerId: number; start: { x: number; y: number }; scale: number; ids: string[]; dragging: boolean; moved: Previews }
  | { kind: 'resize'; id: string; pointerId: number; start: { x: number; y: number }; scale: number; from: PanelPlacement; moved: Previews }

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
  const previewsRef = useRef<Previews>({})
  const gesture = useRef<Gesture | null>(null)
  const nudge = useRef<{ ids: string[]; dx: number; dy: number } | null>(null)
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Set by a drag that just ended, so the click that follows it is not taken as a selection.
  const justDragged = useRef(false)

  useEffect(() => {
    placedRef.current = placed
  }, [placed])

  const setPreviews = useCallback((next: Previews) => {
    previewsRef.current = next
    setPreviewsState(next)
  }, [])

  const save = useCallback(
    (moves: Previews) => {
      const episodeId = placedRef.current[0]?.panel.episodeId
      if (episodeId === undefined || Object.keys(moves).length === 0) return
      setPreviews(moves)
      const list = Object.entries(moves).map(([panelId, placement]) => ({ panelId, placement }))
      usePanelsStore
        .getState()
        .placePanels(episodeId, list)
        .then(
          () => setPreviews({}),
          (e: unknown) => {
            setPreviews({})
            setError(errorText(e))
          }
        )
    },
    [setPreviews]
  )

  /** The placements of `ids` after moving them by (dx, dy), the group held inside the strip. */
  const shifted = useCallback((ids: string[], dx: number, dy: number): { moves: Previews; dx: number; dy: number } => {
    const group = placedRef.current.filter((p) => ids.includes(p.panel.id))
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
    if (pending !== null) save(shifted(pending.ids, pending.dx, pending.dy).moves)
  }, [save, shifted])

  // A run of nudges still waiting must not be lost when the strip goes away.
  useEffect(() => flushNudge, [flushNudge])

  const endGesture = useCallback(
    (e: PointerEvent<HTMLElement>, commit: boolean) => {
      const g = gesture.current
      if (g === null || e.pointerId !== g.pointerId) return
      gesture.current = null
      const dragged = g.kind === 'resize' || g.dragging
      if (!dragged) return
      if (g.kind === 'move') justDragged.current = true
      if (commit && Object.keys(g.moved).length > 0) save(g.moved)
      else setPreviews({})
    },
    [save, setPreviews]
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
      const dx = (e.clientX - g.start.x) / g.scale
      const dy = (e.clientY - g.start.y) / g.scale
      if (g.kind === 'resize') {
        // The height follows the aspect, so only the width is set; the panel keeps its corner and stays inside the strip.
        const width = Math.min(g.from.width + dx, STRIP_CSS_WIDTH - g.from.x)
        const aspect = placedRef.current.find((p) => p.panel.id === g.id)?.panel.aspect
        if (aspect === undefined) return
        const next = clampPlacement({ ...g.from, width: Math.round(width) }, aspect)
        g.moved = next.width === g.from.width ? {} : { [g.id]: next }
        setPreviews(g.moved)
        return
      }
      if (!g.dragging) {
        if (Math.hypot(e.clientX - g.start.x, e.clientY - g.start.y) < DRAG_THRESHOLD_PX) return
        g.dragging = true
        e.currentTarget.setPointerCapture?.(e.pointerId)
        if (!useAppStore.getState().selectedPanelIds.includes(g.id)) useAppStore.getState().selectPanel(g.id)
      }
      g.moved = shifted(g.ids, dx, dy).moves
      setPreviews(g.moved)
    },
    [endGesture, setPreviews, shifted]
  )

  const bindCard = useCallback(
    (id: string): HTMLAttributes<HTMLElement> => ({
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        if (e.button !== 0 || e.shiftKey) return
        if (e.target instanceof Element && e.target.closest(CONTROL_SELECTOR) !== null) return
        flushNudge()
        justDragged.current = false
        setError(null)
        const selected = useAppStore.getState().selectedPanelIds
        gesture.current = {
          kind: 'move',
          id,
          pointerId: e.pointerId,
          start: { x: e.clientX, y: e.clientY },
          scale: scaleOf(e.currentTarget),
          ids: selected.includes(id) ? selected : [id],
          dragging: false,
          moved: {}
        }
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
        if (e.target !== e.currentTarget || step === undefined) return
        e.preventDefault()
        const selected = useAppStore.getState().selectedPanelIds
        const ids = selected.includes(id) ? selected : [id]
        if (nudge.current !== null && nudge.current.ids.join() !== ids.join()) flushNudge()
        const by = e.shiftKey ? NUDGE_BIG_PX : NUDGE_PX
        const held = nudge.current ?? { ids, dx: 0, dy: 0 }
        const next = shifted(ids, held.dx + step.x * by, held.dy + step.y * by)
        nudge.current = { ids, dx: next.dx, dy: next.dy }
        setPreviews(next.moves)
        if (nudgeTimer.current !== null) clearTimeout(nudgeTimer.current)
        nudgeTimer.current = setTimeout(flushNudge, NUDGE_COMMIT_MS)
      }
    }),
    [endGesture, flushNudge, onMove, setPreviews, shifted]
  )

  const bindResize = useCallback(
    (id: string): HTMLAttributes<HTMLElement> => ({
      onPointerDown: (e: PointerEvent<HTMLElement>) => {
        // The handle is not a press on the card: it neither selects nor drags it.
        e.stopPropagation()
        if (e.button !== 0) return
        const p = placedRef.current.find((q) => q.panel.id === id)
        if (p === undefined) return
        flushNudge()
        setError(null)
        e.currentTarget.setPointerCapture?.(e.pointerId)
        gesture.current = {
          kind: 'resize',
          id,
          pointerId: e.pointerId,
          start: { x: e.clientX, y: e.clientY },
          scale: scaleOf(e.currentTarget),
          from: { x: Math.round(p.x), y: Math.round(p.y), width: Math.round(p.width) },
          moved: {}
        }
      },
      onPointerMove: onMove,
      onPointerUp: (e: PointerEvent<HTMLElement>) => endGesture(e, true),
      onPointerCancel: (e: PointerEvent<HTMLElement>) => endGesture(e, false),
      onLostPointerCapture: (e: PointerEvent<HTMLElement>) => endGesture(e, false),
      onClick: (e: MouseEvent<HTMLElement>) => e.stopPropagation(),
      onDoubleClick: (e: MouseEvent<HTMLElement>) => e.stopPropagation()
    }),
    [endGesture, flushNudge, onMove]
  )

  return { previews, error, bindCard, bindResize }
}
