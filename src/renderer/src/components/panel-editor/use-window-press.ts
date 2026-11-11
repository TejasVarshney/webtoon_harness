import { useEffect, useRef, type RefObject } from 'react'
import type { PointerFacts, Press } from './bubble-press'

/**
 * Lets a press on a bubble follow the pointer on the window too. The strip's lettering layer takes no pointer but the
 * bubbles', so a quick flick whose first move already lands off the bubble would otherwise go to the card below and
 * drag nothing. Only events outside the stage are handled here: those inside it are the stage's own, and a press that
 * is not on is ignored. `end` is the stage's `endPress`.
 */
export function useWindowPress(
  press: RefObject<Press | null>,
  stageRef: RefObject<HTMLElement | null>,
  move: (e: PointerFacts) => void,
  end: (e: PointerFacts, commit: boolean) => void
): void {
  // The handlers are made again on each render: the listeners call the latest through a ref.
  const latest = useRef({ move, end })
  latest.current = { move, end }
  useEffect(() => {
    const outside = (e: PointerEvent): boolean => press.current !== null && !(e.target instanceof Node && stageRef.current?.contains(e.target))
    const onMove = (e: PointerEvent): void => {
      if (outside(e)) latest.current.move(e)
    }
    // A release off the stage before any drag is no click on the bubble; after one it ends the drag where it is.
    const finish = (e: PointerEvent, commit: boolean): void => {
      const p = press.current
      if (!outside(e) || p === null || e.pointerId !== p.pointerId) return
      if (p.dragging) latest.current.end(e, commit)
      else press.current = null
    }
    const onUp = (e: PointerEvent): void => finish(e, true)
    const onCancel = (e: PointerEvent): void => finish(e, false)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
    }
  }, [press, stageRef])
}
