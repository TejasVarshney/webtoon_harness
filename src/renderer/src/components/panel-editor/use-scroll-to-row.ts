import { useEffect, useRef, type RefObject } from 'react'

/**
 * The part of `el` that is on screen, top to bottom: its box, cut by each ancestor that clips and by the window. When
 * a short window has the column scrolled, part of the scroll area may be out of sight below it.
 */
function visibleSpan(el: HTMLElement): { top: number; bottom: number } {
  const box = el.getBoundingClientRect()
  let top = box.top
  let bottom = Math.min(box.bottom, window.innerHeight)
  for (let p = el.parentElement; p !== null; p = p.parentElement) {
    if (getComputedStyle(p).overflowY === 'visible') continue
    const r = p.getBoundingClientRect()
    top = Math.max(top, r.top)
    bottom = Math.min(bottom, r.bottom)
  }
  return bottom > top ? { top, bottom } : { top: box.top, bottom: box.bottom }
}

/**
 * Scrolls the row of the selected line into view inside the inspector's own scroll area, and nowhere else: the stage
 * above it never moves, so a bubble being pressed, dragged or typed in stays under the pointer and in sight. That is
 * why there is no waiting for a press or a double-click to end. A row the user is already in (it has the focus) is
 * where they put it, and stays. `count` is how many rows there are: the stage selects a new line before its save
 * lands, so its row comes after the selection does. A row that goes (the count falls) is no reason to scroll.
 */
export function useScrollToRow(
  line: number | null,
  count: number,
  row: (i: number) => HTMLElement | null,
  area: RefObject<HTMLElement | null>,
  followed: RefObject<boolean>
): void {
  /** The line and count the last run saw: a run for anything else is a removal, which leaves the scroll where it is. */
  const seen = useRef<{ line: number | null; count: number } | null>(null)
  useEffect(() => {
    const before = seen.current
    seen.current = { line, count }
    const grew = before !== null && count > before.count
    const lineChanged = before === null || before.line !== line
    // A selection that followed its line up after a removal above it: the row moved with the list, and the browser
    // already kept the scroll with it.
    const wasFollowing = lineChanged && followed.current
    if (lineChanged) followed.current = false
    if (!grew && (!lineChanged || wasFollowing)) return
    const el = line === null ? null : row(line)
    const box = area.current
    if (el === null || box === null || el.contains(document.activeElement)) return
    const r = el.getBoundingClientRect()
    const a = visibleSpan(box)
    // The nearest edge, and the row's top when it is taller than the area.
    if (r.top < a.top) box.scrollTop += r.top - a.top
    else if (r.bottom > a.bottom) box.scrollTop += Math.min(r.bottom - a.bottom, r.top - a.top)
  }, [line, count, row, area, followed])
}
