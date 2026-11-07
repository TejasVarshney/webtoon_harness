import { useCallback, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from 'react'
import type { BubblePlacement, DialogueLine } from '@shared/types'
import type { BubbleEdge, WidthHandleProps } from '../visualizer/BubbleWidthHandles'
import { bubbleShape } from '../visualizer/bubble-layout'
import { bubbleDefaults, withStyleChange } from '../visualizer/bubble-style'
import type { DialogueDraftLine, LineIdentity } from './dialogue-edits'
import type { Nudge, Press } from './bubble-press'
import { NUDGE_COMMIT_MS, boxOf, centreOf, placementFromPointer, type Box } from './bubble-placement'
import { editLine, identityOf } from './dialogue-edits'

/** A bubble's width handles sit inside it, but a press or double-click on one is not the bubble's. */
export const inWidthHandle = (target: EventTarget): boolean => target instanceof Element && target.closest('.bubble-width-handle') !== null

/** The narrowest and widest a bubble is set to, as shares of the panel's width, as `BubbleStyleSchema` allows. */
const MIN_WIDTH = 0.1
const MAX_WIDTH = 0.95
/** One arrow key press on a handle, and one with Shift. */
const STEP = 0.01
const STEP_BIG = 0.05

const round = (n: number): number => Math.round(n * 10000) / 10000

/** `floor` is the narrowest the bubble is drawn: a width under it would be stored but not shown. */
const clampWidth = (w: number, floor: number): number => round(Math.min(MAX_WIDTH, Math.max(floor, w)))

/** A centre where a bubble `size` big (screen px) is whole inside the panel, as a drag keeps it. */
const inside = (centre: BubblePlacement, size: { width: number; height: number }, panel: Box): BubblePlacement =>
  placementFromPointer({ pointer: { x: panel.left + centre.x * panel.width, y: panel.top + centre.y * panel.height }, grab: { dx: 0, dy: 0 }, panel, bubble: size })

/** A length the stylesheet gives, in px; 0 for none, and in jsdom, which lays nothing out. */
const px = (v: string): number => parseFloat(v) || 0

/**
 * The bubble across, in screen px: its centre, and its width as it is laid out. A sound effect is tilted, so its box on
 * screen is wider than it is. Also the narrowest it can be drawn, as a share of the panel's width: its shape's
 * min-width, or its padding and outline around about one letter. jsdom has no layout, so there it is the box.
 */
function drawnAcross(el: HTMLElement, panelB: Box): { centre: number; width: number; floor: number } {
  const box = boxOf(el)
  const media = el.closest<HTMLElement>('.panel-media')
  const mediaWidth = media === null ? 0 : px(getComputedStyle(media).width) || media.offsetWidth
  // Screen px for each px of the stage before it is scaled.
  const scale = mediaWidth > 0 ? panelB.width / mediaWidth : 1
  const s = getComputedStyle(el)
  const width = (px(s.width) || el.offsetWidth) * scale || box.width
  const least = Math.max(px(s.minWidth), px(s.paddingLeft) + px(s.paddingRight) + px(s.borderLeftWidth) + px(s.borderRightWidth) + px(s.fontSize)) * scale
  // Rounded up, so the stored width is never under the drawn one.
  return { centre: box.left + box.width / 2, width, floor: Math.max(MIN_WIDTH, Math.ceil((least / panelB.width) * 10000) / 10000) }
}

/** What the handles share with the bubbles: their press and nudge (one at a time, whichever it is on), and how they save. */
interface WidthHost {
  base: DialogueLine[]
  selected: number | null
  textEditing: number | null
  panelBox(): Box | null
  bubbleAt(i: number): HTMLElement | null
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
 * The handles on the sides of the selected bubble, which set its width: pressed and dragged (the other side stays
 * where it is), stepped with the arrow keys around the bubble's centre, double-clicked to give the width back to the
 * text. A drag and a run of keys go through the same press and nudge as the bubble's, with `width` set, and are drawn
 * as `widthPreview` until they are saved. Each saves the width and the centre that goes with it in one save, so an
 * automatic bubble is placed by its first resize. No width is under what the bubble can be drawn at.
 */
export function useWidthEditing(host: WidthHost) {
  const { base, selected, textEditing, panelBox, bubbleAt, select, send, press, nudge, nudgeTimer, keepFocus, dragEnded, dropPress, flushNudge } = host
  const [widthPreview, setWidthPreview] = useState<{ index: number; width: number; placement: BubblePlacement } | null>(null)
  /** The focus was on one of a bubble's width handles: that one gets it back after a remount. */
  const widthFocus = useRef<BubbleEdge | null>(null)

  /** `width` undefined gives the width back to the text; `placement` undefined leaves the line's as it is. */
  const commitWidth = useCallback(
    (index: number, width: number | undefined, placement: BubblePlacement | undefined, expect: LineIdentity): void => {
      setWidthPreview(null)
      // Only the width changes, on the style the line has when the save is sent: a style picked in its row a moment
      // earlier is saved first, and kept.
      const change = (line: DialogueLine): Partial<DialogueDraftLine> => ({
        ...(placement === undefined ? {} : { placement }),
        style: withStyleChange(line.style, { width }, bubbleDefaults(bubbleShape(line)))
      })
      send(
        (lines) => lines.map((line, j) => (j === index ? { ...line, ...change(line) } : line)),
        (current) => (current[index] === undefined ? null : editLine(current, index, expect, change(current[index])))
      )
    },
    [send]
  )

  /**
   * Saves a width set by a drag or a run of keys. The bubble is kept inside the panel once more, now that its height at
   * the new width is known: the preview has drawn it.
   */
  const saveWidth = useCallback(
    (index: number, width: number, placement: BubblePlacement, expect: LineIdentity): void => {
      const panelB = panelBox()
      const el = bubbleAt(index)
      const kept = panelB !== null && el !== null && panelB.width > 0 && panelB.height > 0 ? inside(placement, boxOf(el), panelB) : placement
      commitWidth(index, width, kept, expect)
    },
    [panelBox, bubbleAt, commitWidth]
  )

  /** Where line `i` is centred now: a run of nudges of it still waiting has moved it from where the line says. */
  function centreNow(i: number, line: DialogueLine, bubble: Box, panelB: Box): BubblePlacement {
    const run = nudge.current
    if (run !== null && run.index === i && !run.tail) return run.placement
    // An automatic bubble starts from where the layout drew it.
    return line.placement ?? centreOf(bubble, panelB)
  }

  function pressWidth(e: PointerEvent<HTMLDivElement>, i: number, edge: BubbleEdge): void {
    const line = base[i]
    const el = bubbleAt(i)
    const panelB = panelBox()
    if (e.button !== 0 || line === undefined || el === null || panelB === null || panelB.width <= 0) return
    const box = boxOf(el)
    const drawn = drawnAcross(el, panelB)
    const out = edge === 'right' ? 1 : -1
    const y = centreNow(i, line, box, panelB).y
    dropPress()
    flushNudge()
    select(i)
    e.currentTarget.focus({ preventScroll: true })
    press.current = {
      index: i,
      pointerId: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      // Off the side by this much: the side keeps that distance from the pointer, so it does not jump to it.
      grab: { dx: e.clientX - (drawn.centre + (out * drawn.width) / 2), dy: 0 },
      bubble: { width: box.width, height: box.height },
      expect: identityOf(line),
      dragging: false,
      tail: false,
      width: { edge, anchor: drawn.centre - (out * drawn.width) / 2, y, floor: drawn.floor, share: null },
      placement: null
    }
  }

  /** The stage's move, once a press on a handle is a drag. */
  function dragWidth(p: Press, x: number, panelB: Box): void {
    const r = p.width
    if (r === undefined || panelB.width <= 0 || panelB.height <= 0) return
    const out = r.edge === 'right' ? 1 : -1
    // The width is from the other side to the side being dragged, and the centre midway between them.
    r.share = clampWidth((out * (x - p.grab.dx - r.anchor)) / panelB.width, r.floor)
    const centre = { x: (r.anchor - panelB.left) / panelB.width + (out * r.share) / 2, y: r.y }
    p.placement = inside(centre, { width: r.share * panelB.width, height: p.bubble.height }, panelB)
    setWidthPreview({ index: p.index, width: r.share, placement: p.placement })
  }

  /** The stage's release of a drag of a handle. */
  function releaseWidth(p: Press): void {
    if (p.width === undefined || p.width.share === null || p.placement === null) return
    saveWidth(p.index, p.width.share, p.placement, p.expect)
  }

  function nudgeWidth(i: number, wider: boolean, big: boolean): void {
    const panelB = panelBox()
    const el = bubbleAt(i)
    const line = base[i]
    if (panelB === null || el === null || line === undefined || panelB.width <= 0 || panelB.height <= 0) return
    const box = boxOf(el)
    const drawn = drawnAcross(el, panelB)
    if (nudge.current?.index !== i || nudge.current.width === undefined) {
      const placement = centreNow(i, line, box, panelB)
      flushNudge()
      // An automatic bubble starts from the width it is drawn at.
      nudge.current = { index: i, expect: identityOf(line), tail: false, width: line.style?.width ?? drawn.width / panelB.width, placement }
    }
    const run = nudge.current!
    const width = clampWidth(run.width! + (wider ? 1 : -1) * (big ? STEP_BIG : STEP), drawn.floor)
    run.width = width
    run.placement = inside(run.placement, { width: width * panelB.width, height: box.height }, panelB)
    setWidthPreview({ index: i, width, placement: run.placement })
    if (nudgeTimer.current !== null) clearTimeout(nudgeTimer.current)
    nudgeTimer.current = setTimeout(flushNudge, NUDGE_COMMIT_MS)
  }

  function bindWidth(i: number, edge: BubbleEdge): WidthHandleProps {
    return {
      'aria-label': `Width of line ${i + 1}`,
      onPointerDown: (e: PointerEvent<HTMLDivElement>) => pressWidth(e, i, edge),
      onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
        if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.nativeEvent.isComposing) return
        e.preventDefault()
        nudgeWidth(i, e.key === 'ArrowRight', e.shiftKey)
      },
      onDoubleClick: (e: MouseEvent<HTMLDivElement>) => {
        // Neither the bubble's text nor a new line: the width goes back to the text, and the bubble stays where it is.
        e.stopPropagation()
        const line = base[i]
        if (dragEnded.current || line === undefined || line.style?.width === undefined) return
        flushNudge()
        commitWidth(i, undefined, undefined, identityOf(line))
      },
      onFocus: () => {
        keepFocus.current = true
        widthFocus.current = edge
      },
      // The bubble remounts on every save, and its handles with it: the one that had the focus takes it back.
      ref: (el: HTMLDivElement | null) => {
        if (el === null || widthFocus.current !== edge || !keepFocus.current || selected !== i || textEditing !== null) return
        const active = document.activeElement
        if (el !== active && (active === null || active === document.body)) el.focus({ preventScroll: true })
      }
    }
  }

  return { widthPreview, setWidthPreview, widthFocus, saveWidth, dragWidth, releaseWidth, bindWidth }
}
