import { useCallback, useRef, useState, type HTMLAttributes, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from 'react'
import type { BubblePlacement, DialogueLine } from '@shared/types'
import type { DialogueDraftLine, LineIdentity } from './dialogue-edits'
import type { Nudge, Press } from './bubble-press'
import { ARROWS, NUDGE_COMMIT_MS, boxOf, centreOf, nudgePlacement, type Arrow, type Box } from './bubble-placement'
import { editLine, identityOf } from './dialogue-edits'

/** The dot at a tail's tip sits inside its bubble, but a press or double-click on it is not the bubble's. */
export const inTailHandle = (target: EventTarget): boolean => target instanceof Element && target.closest('.bubble-tail-handle') !== null

/** What the dot shares with the bubbles: their press and nudge (one at a time, whichever it is on), and how they save. */
interface TailHost {
  base: DialogueLine[]
  selected: number | null
  textEditing: number | null
  panelBox(): Box | null
  select(i: number | null): void
  send(show: (lines: DialogueLine[]) => DialogueLine[], build: (current: DialogueLine[]) => DialogueDraftLine[] | null): void
  press: RefObject<Press | null>
  nudge: RefObject<Nudge | null>
  nudgeTimer: RefObject<ReturnType<typeof setTimeout> | null>
  keepFocus: RefObject<boolean>
  dragEnded: RefObject<boolean>
  dropPress(): void
  /** Saves the run of nudges waiting. It goes through a ref there, as the timer's closure may be older than the render. */
  flushNudge(): void
}

/**
 * The dot at the tip of the selected bubble's tail: pressed and dragged, nudged with the arrow keys, double-clicked
 * to give the tail back to the app. Its drag and its nudges run through the same press and nudge as the bubble's, with
 * `tail` set, and are drawn as `tailPreview` until they are saved.
 */
export function useTailEditing(host: TailHost) {
  const { base, selected, textEditing, panelBox, select, send, press, nudge, nudgeTimer, keepFocus, dragEnded, dropPress, flushNudge } = host
  const [tailPreview, setTailPreview] = useState<{ index: number; tip: BubblePlacement } | null>(null)
  /** The focus was on a bubble's tail dot, not the bubble: the dot gets it back after a remount. */
  const tailFocus = useRef(false)

  const commitTail = useCallback(
    (index: number, tail: BubblePlacement | null, expect: LineIdentity): void => {
      setTailPreview(null)
      send(
        (lines) => lines.map((line, j) => (j === index ? { ...line, tail } : line)),
        (current) => editLine(current, index, expect, { tail })
      )
    },
    [send]
  )

  function nudgeTail(i: number, key: Arrow, big: boolean, dot: Element): void {
    const panelB = panelBox()
    const line = base[i]
    if (panelB === null || line === undefined || panelB.width <= 0 || panelB.height <= 0) return
    if (nudge.current?.index !== i || !nudge.current.tail) {
      flushNudge()
      // A tail still automatic starts from where its dot is drawn.
      const start = line.tail !== null && line.tail !== 'none' ? line.tail : centreOf(boxOf(dot), panelB)
      nudge.current = { index: i, expect: identityOf(line), tail: true, placement: start }
    }
    const run = nudge.current!
    run.placement = nudgePlacement(run.placement, key, big, { x: 0, y: 0 })
    setTailPreview({ index: i, tip: run.placement })
    if (nudgeTimer.current !== null) clearTimeout(nudgeTimer.current)
    nudgeTimer.current = setTimeout(flushNudge, NUDGE_COMMIT_MS)
  }

  function pressTail(e: PointerEvent<HTMLDivElement>, i: number): void {
    const line = base[i]
    if (e.button !== 0 || line === undefined) return
    dropPress()
    flushNudge()
    select(i)
    e.currentTarget.focus({ preventScroll: true })
    press.current = {
      index: i,
      pointerId: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      grab: { dx: 0, dy: 0 },
      bubble: { width: 0, height: 0 },
      expect: identityOf(line),
      dragging: false,
      tail: true,
      placement: null
    }
  }

  function bindTail(i: number): HTMLAttributes<HTMLDivElement> {
    const attrs = {
      'aria-label': `Point of line ${i + 1}`,
      onPointerDown: (e: PointerEvent<HTMLDivElement>) => pressTail(e, i),
      onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
        if (!(ARROWS as readonly string[]).includes(e.key) || e.nativeEvent.isComposing) return
        e.preventDefault()
        nudgeTail(i, e.key as Arrow, e.shiftKey, e.currentTarget)
      },
      onDoubleClick: (e: MouseEvent<HTMLDivElement>) => {
        // Neither the bubble's text nor a new line: the tail goes back to the app.
        e.stopPropagation()
        const line = base[i]
        if (dragEnded.current || line === undefined || line.tail === null) return
        flushNudge()
        commitTail(i, null, identityOf(line))
      },
      onFocus: () => {
        keepFocus.current = true
        tailFocus.current = true
      },
      // The dot is not in the tree until its tail is measured, which is after the focus effect has run for a remounted
      // bubble: so the dot takes the focus back as it mounts.
      ref: (el: HTMLDivElement | null) => {
        if (el === null || !tailFocus.current || !keepFocus.current || selected !== i || textEditing !== null) return
        const active = document.activeElement
        if (el !== active && (active === null || active === document.body)) el.focus({ preventScroll: true })
      }
    }
    return attrs
  }

  return { tailPreview, setTailPreview, tailFocus, commitTail, bindTail }
}
