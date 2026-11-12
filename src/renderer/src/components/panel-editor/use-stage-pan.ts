import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/** `ready`: Space is held over a stage that can move, so a left press pans. `panning`: a pan's drag is going. */
export type StagePan = 'ready' | 'panning' | null

/** Keys typed here are text: a space typed in a bubble's open text, or a field, is a space. */
const inText = (target: EventTarget | null): boolean => target instanceof Element && target.closest('textarea, input, select, [contenteditable]:not([contenteditable="false"])') !== null
const isSpace = (e: KeyboardEvent): boolean => e.code === 'Space' || e.key === ' '

/** The viewport holds more than it shows (the panel is zoomed past the fit), so there is somewhere to move to. */
function canPan(v: HTMLElement): boolean {
  return v.scrollWidth > v.clientWidth || v.scrollHeight > v.clientHeight
}

/**
 * Moving a zoomed stage with the mouse, as in drawing and layout apps: a right- or middle-button drag, or a left drag
 * while Space is held over the stage, scrolls `viewport` so the panel follows the pointer. The stage has no context
 * menu, so a right press is always free to pan. The viewport's own scrolling keeps an
 * edge of the panel from being dragged past its side, and does nothing while the whole panel fits. The wheel scrolls
 * it (Shift and the wheel sideways) and Ctrl and the wheel zoom (`useStageZoom`), as before.
 * A pan's press, and the click or double-click it makes, are the pan's alone: they are stopped at the viewport on the
 * way down, so they neither select, drag nor add a bubble nor start a stroke. A plain left press is the stage's.
 * Returns what the cursor shows: an open hand while Space is held, a closed one while panning.
 *
 * With `move`, the stage moves its own content instead of scrolling: each drag step's travel goes to `move`, which
 * keeps it in sight, and a pan is always possible, whatever fits.
 */
export function useStagePan(viewport: RefObject<HTMLElement | null>, move?: (dx: number, dy: number) => void): StagePan {
  const [ready, setReady] = useState(false)
  const [panning, setPanning] = useState(false)
  const moveRef = useRef(move)
  useLayoutEffect(() => {
    moveRef.current = move
  })

  useEffect(() => {
    const v = viewport.current
    if (v === null) return
    const el = v
    /** The pointer is over the viewport. */
    let over = false
    let space = false
    let drag: { pointerId: number; x: number; y: number; left: number; top: number; lastX: number; lastY: number } | null = null
    /** Something to move: content the viewport scrolls over, or a stage that moves its own. */
    const movable = (): boolean => moveRef.current !== undefined || canPan(el)
    /** The last press was a pan's: the click and double-click that follow it are not the stage's. */
    let pressPanned = false

    const show = (): void => setReady(space && (over || drag !== null))

    function onEnter(): void {
      over = true
      show()
    }
    function onLeave(): void {
      over = false
      show()
    }
    function onKeyDown(e: KeyboardEvent): void {
      if (!isSpace(e) || e.ctrlKey || e.altKey || e.metaKey || inText(e.target)) return
      if (drag === null && !(over && movable())) return
      // Held, Space would press a focused button, or scroll the column.
      e.preventDefault()
      if (space) return
      space = true
      show()
    }
    function onKeyUp(e: KeyboardEvent): void {
      if (!isSpace(e) || !space) return
      e.preventDefault()
      space = false
      show()
    }
    function onBlur(): void {
      space = false
      show()
    }

    function onPointerDown(e: PointerEvent): void {
      pressPanned = drag === null && (e.button === 1 || e.button === 2 || (e.button === 0 && space)) && !inText(e.target) && movable()
      if (!pressPanned) return
      e.stopPropagation()
      drag = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop, lastX: e.clientX, lastY: e.clientY }
      try {
        el.setPointerCapture?.(e.pointerId)
      } catch {
        // A pointer the browser no longer knows: the drag still follows the moves the viewport sees.
      }
      setPanning(true)
    }
    function onPointerMove(e: PointerEvent): void {
      if (drag === null || e.pointerId !== drag.pointerId) return
      e.stopPropagation()
      const move = moveRef.current
      if (move !== undefined) {
        move(e.clientX - drag.lastX, e.clientY - drag.lastY)
        drag.lastX = e.clientX
        drag.lastY = e.clientY
        return
      }
      el.scrollLeft = drag.left - (e.clientX - drag.x)
      el.scrollTop = drag.top - (e.clientY - drag.y)
    }
    function onPointerEnd(e: PointerEvent): void {
      if (drag === null || e.pointerId !== drag.pointerId) return
      e.stopPropagation()
      drag = null
      setPanning(false)
      show()
    }
    /** The mouse's own press, click and double-click of a pan: the middle press would start the browser's autoscroll. */
    function swallow(e: MouseEvent): void {
      // A click from the keyboard (Enter on a panel's Retry) follows no press at all.
      if (!pressPanned || (e.type === 'click' && e.detail === 0)) return
      e.preventDefault()
      e.stopPropagation()
    }

    /** A right press pans, so the right button's menu never opens on the stage (a text box keeps its own). */
    function noMenu(e: MouseEvent): void {
      if (!inText(e.target)) e.preventDefault()
    }

    el.addEventListener('pointerenter', onEnter)
    el.addEventListener('contextmenu', noMenu)
    el.addEventListener('pointerleave', onLeave)
    el.addEventListener('pointerdown', onPointerDown, true)
    el.addEventListener('pointermove', onPointerMove, true)
    el.addEventListener('pointerup', onPointerEnd, true)
    el.addEventListener('pointercancel', onPointerEnd, true)
    el.addEventListener('lostpointercapture', onPointerEnd, true)
    for (const type of ['mousedown', 'click', 'auxclick', 'dblclick'] as const) el.addEventListener(type, swallow, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      el.removeEventListener('pointerenter', onEnter)
      el.removeEventListener('contextmenu', noMenu)
      el.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('pointerdown', onPointerDown, true)
      el.removeEventListener('pointermove', onPointerMove, true)
      el.removeEventListener('pointerup', onPointerEnd, true)
      el.removeEventListener('pointercancel', onPointerEnd, true)
      el.removeEventListener('lostpointercapture', onPointerEnd, true)
      for (const type of ['mousedown', 'click', 'auxclick', 'dblclick'] as const) el.removeEventListener(type, swallow, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [viewport])

  return panning ? 'panning' : ready ? 'ready' : null
}
