import {
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject
} from 'react'
import type { BubblePlacement, BubbleShape, DialogueLine, Panel } from '@shared/types'
import type { DialogueDraftLine } from './dialogue-edits'
import type { OverlayEditing } from '../visualizer/DialogueOverlay'
import { ARROWS, DRAG_THRESHOLD_PX, NUDGE_COMMIT_MS, addSpot, boxOf, centreOf, nudgePlacement, placementFromPointer, type Arrow, type Box } from './bubble-placement'
import { appendLine, editLine, identityOf, newBubble, removeLine, type LineIdentity } from './dialogue-edits'
import type { Nudge, Press } from './bubble-press'
import { useDialogueSaver } from './use-dialogue-saver'
import { inTailHandle, useTailEditing } from './use-tail-editing'
import { inWidthHandle, useWidthEditing } from './use-width-editing'

/** The id a new line has until it is saved and the service gives it a real one. Each new line has its own. */
let newLines = 0
const newLineId = (): string => `dlg_new_${(newLines += 1)}`

export interface BubbleEditing {
  editing: OverlayEditing
  selected: number | null
  select(i: number | null): void
  /** The lines to draw: the stored ones, as the save still going will leave them, and a new line while it is typed. */
  lines: DialogueLine[]
  /** For the stage element: a press on the empty stage, the drag that follows a press on a bubble, and Escape. */
  stage: HTMLAttributes<HTMLElement>
  /** The Add bubble menu's choice, and whether a new bubble is being typed (the menu waits for it). */
  add(shape: BubbleShape): void
  adding: boolean
}

/** The text open for typing: a stored line's (by index), or the new line's (`index: null`). */
interface TextEdit {
  index: number | null
  draft: string
  expect: LineIdentity | null
}

const inTextField = (target: EventTarget): boolean => target instanceof Element && target.closest('textarea, input, select') !== null
const inBubble = (target: EventTarget): boolean => target instanceof Element && target.closest('.bubble') !== null
/** The panel's status (Generating…, or Failed with its Retry) and any button are not empty stage: a double-click there adds no line. */
const inControl = (target: EventTarget): boolean => target instanceof Element && target.closest('.panel-status, button') !== null

/**
 * Selecting, retyping, dragging, nudging, adding and deleting the bubbles of the panel on the stage. Every
 * bubble is known by its line's index, since the ids change on each save, and each change saves the whole dialogue
 * through `useDialogueSaver`, built from the store when it is sent; its conflicts and refusals show in the Lines tab.
 * Nothing here calls a model.
 * While a save is going, the lines are drawn as it will leave them, so a dropped or retyped bubble does not jump back
 * until the store catches up. The bubbles remount when their ids change, so the selected one gets the focus back.
 */
export function useBubbleEditing(panel: Panel, stageRef: RefObject<HTMLElement | null>): BubbleEditing {
  const { save, reportConflict } = useDialogueSaver(panel.id)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [preview, setPreview] = useState<{ index: number; placement: BubblePlacement } | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [text, setText] = useState<TextEdit | null>(null)
  const [adding, setAdding] = useState<DialogueLine | null>(null)
  const [held, setHeld] = useState<{ token: object; lines: DialogueLine[] } | null>(null)

  const press = useRef<Press | null>(null)
  const nudge = useRef<Nudge | null>(null)
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Set once Enter, Escape or blur has closed the open text, so only the first of them acts. */
  const textClosed = useRef(false)
  /** A bubble had the focus, so the bubble at the selected index gets it back after a remount. */
  const keepFocus = useRef(false)
  /** A drag just ended: the click and double-click that may follow it are not the user's. */
  const dragEnded = useRef(false)

  const base = held?.lines ?? panel.dialogue
  const lines = adding === null ? base : [...base, adding]
  const selected = selectedIndex !== null && selectedIndex < base.length ? selectedIndex : null
  // A line that is gone (the agent removed it) is no longer open for typing.
  const textGone = text !== null && text.index !== null && text.index >= base.length
  const textEditing = text === null ? null : text.index === null ? base.length : textGone ? null : text.index

  // Timers and the unmount see the store's lines through a ref: their closures may be older than the store.
  const storedRef = useRef(panel.dialogue)
  useLayoutEffect(() => {
    storedRef.current = panel.dialogue
  })

  // Its text went with it, unsaved, and the unmounted textarea had no blur to say so: the draft is dropped, so it never
  // reopens on a line that comes to that place later, and the change is said in Lines.
  useLayoutEffect(() => {
    if (!textGone) return
    textClosed.current = true
    setText(null)
    reportConflict()
  }, [textGone, reportConflict])

  const select = useCallback((i: number | null) => setSelectedIndex(i), [])

  const panelBox = useCallback((): Box | null => {
    const media = stageRef.current?.querySelector('.panel-media')
    return media ? boxOf(media) : null
  }, [stageRef])
  const bubbleAt = useCallback((i: number): HTMLElement | null => stageRef.current?.querySelector<HTMLElement>(`[data-line="${i}"]`) ?? null, [stageRef])
  const focusStage = (): void => {
    keepFocus.current = false
    tail.tailFocus.current = false
    widths.widthFocus.current = null
    stageRef.current?.focus({ preventScroll: true })
  }

  /**
   * Saves what `build` makes of the store's lines, and draws the lines as `show` makes them until the save settles. A
   * save sent while another is going shows on top of that one, as it will be built on top of it.
   */
  const send = useCallback(
    (show: (lines: DialogueLine[]) => DialogueLine[], build: (current: DialogueLine[]) => DialogueDraftLine[] | null): void => {
      const token = {}
      setHeld((h) => ({ token, lines: show(h?.lines ?? storedRef.current) }))
      void save(build).finally(() => setHeld((h) => (h?.token === token ? null : h)))
    },
    [save]
  )

  // The run of nudges waiting is saved through a ref: the handles' closures are made before `flushNudge` is.
  const flushRef = useRef<() => void>(() => undefined)
  const handles = { base, selected, textEditing, panelBox, bubbleAt, select, send, press, nudge, nudgeTimer, keepFocus, dragEnded, dropPress, flushNudge: () => flushRef.current() }
  const tail = useTailEditing(handles)
  const widths = useWidthEditing(handles)

  const commitPlacement = useCallback(
    (index: number, placement: BubblePlacement, expect: LineIdentity): void => {
      setPreview(null)
      send(
        (lines) => lines.map((line, j) => (j === index ? { ...line, placement } : line)),
        (current) => editLine(current, index, expect, { placement })
      )
    },
    [send]
  )

  const flushNudge = useCallback((): void => {
    if (nudgeTimer.current !== null) clearTimeout(nudgeTimer.current)
    nudgeTimer.current = null
    const run = nudge.current
    nudge.current = null
    if (run === null) return
    if (run.tail) tail.commitTail(run.index, run.placement, run.expect)
    else if (run.width !== undefined) widths.saveWidth(run.index, run.width, run.placement, run.expect)
    else commitPlacement(run.index, run.placement, run.expect)
  }, [commitPlacement, tail.commitTail, widths.saveWidth])

  // Stepping to another panel remounts the stage: a run of nudges still waiting is saved, not lost.
  useLayoutEffect(() => {
    flushRef.current = flushNudge
  })
  useEffect(() => () => flushRef.current(), [])

  // A press outside the stage leaves the focus where the user put it.
  useEffect(() => {
    function onPointerDown(e: globalThis.PointerEvent): void {
      if (!(e.target instanceof Node) || !stageRef.current?.contains(e.target)) {
        keepFocus.current = false
        tail.tailFocus.current = false
        widths.widthFocus.current = null
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [stageRef])

  // The selected bubble remounts on every save (its line has a new id) and when it moves into the placed layer. Its
  // focus fell to the body with it, so it is given back, by index. The tail's dot is measured after it mounts, so it
  // takes the focus back itself (`bindTail`'s ref), and so does a width handle (`bindWidth`'s).
  useLayoutEffect(() => {
    if (!keepFocus.current || tail.tailFocus.current || widths.widthFocus.current !== null || selected === null || textEditing !== null) return
    const el = bubbleAt(selected)
    const active = document.activeElement
    if (el !== null && el !== active && (active === null || active === document.body)) el.focus({ preventScroll: true })
  })

  /** The open text takes the focus, with its caret after the text, when it opens and if its bubble remounts. */
  const focusText = useCallback((el: HTMLTextAreaElement | null) => {
    if (el === null) return
    el.focus({ preventScroll: true })
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  function openText(i: number): void {
    const line = base[i]
    if (line === undefined) return
    flushNudge()
    select(i)
    textClosed.current = false
    setText({ index: i, draft: line.text, expect: identityOf(line) })
  }

  /** A double-click adds a spoken line (narration without a cast); the Add bubble menu adds the `shape` it names. */
  function addAt(placement: BubblePlacement, shape?: BubbleShape): void {
    flushNudge()
    const first = panel.characters[0]?.characterId ?? null
    const made = newBubble(shape ?? (first === null ? 'caption' : 'speech'), first)
    select(null)
    textClosed.current = false
    setAdding({ id: newLineId(), ...made, text: '', placement, tail: null })
    setText({ index: null, draft: '', expect: null })
  }

  const add = (shape: BubbleShape): void => addAt(addSpot(base.length), shape)

  /** Enter or blur. Empty text keeps the old text (deleting is the Delete key); a new line left empty is dropped. */
  function commitText(): void {
    if (text === null || textClosed.current) return
    textClosed.current = true
    setText(null)
    const value = text.draft.trim()
    if (text.index === null) {
      const line = adding
      setAdding(null)
      if (line === null || line.placement === null || value === '') return
      // Kept inside the panel, now that the bubble's size is known.
      const panelB = panelBox()
      const el = bubbleAt(base.length)
      const placement =
        panelB !== null && el !== null
          ? placementFromPointer({ pointer: { x: panelB.left + line.placement.x * panelB.width, y: panelB.top + line.placement.y * panelB.height }, grab: { dx: 0, dy: 0 }, panel: panelB, bubble: boxOf(el) })
          : line.placement
      const draft = { speakerId: line.speakerId, kind: line.kind, text: value, placement, style: line.style, tail: null }
      select(base.length)
      send(
        (lines) => [...lines, { ...line, text: value, placement }],
        (current) => appendLine(current, draft)
      )
      return
    }
    const { index, expect } = text
    if (expect === null || value === '' || value === expect.text) return
    send(
      (lines) => lines.map((line, j) => (j === index ? { ...line, text: value } : line)),
      (current) => editLine(current, index, expect, { text: value })
    )
  }

  function cancelText(): void {
    if (text === null || textClosed.current) return
    textClosed.current = true
    setText(null)
    if (text.index === null) setAdding(null)
  }

  function remove(i: number): void {
    const line = base[i]
    if (line === undefined) return
    // A nudge of this bubble still waiting is dropped with it; one of another bubble is saved first.
    if (nudge.current?.index === i) {
      if (nudgeTimer.current !== null) clearTimeout(nudgeTimer.current)
      nudge.current = null
      setPreview(null)
      tail.setTailPreview(null)
      widths.setWidthPreview(null)
    }
    flushNudge()
    const expect = identityOf(line)
    select(null)
    focusStage()
    send(
      (lines) => lines.filter((_, j) => j !== i),
      (current) => removeLine(current, i, expect)
    )
  }

  function nudgeBy(i: number, key: Arrow, big: boolean): void {
    const panelB = panelBox()
    const el = bubbleAt(i)
    const line = base[i]
    if (panelB === null || el === null || line === undefined || panelB.width <= 0 || panelB.height <= 0) return
    const bubble = boxOf(el)
    if (nudge.current?.index !== i || nudge.current.tail || nudge.current.width !== undefined) {
      flushNudge()
      // An automatic bubble starts from where the layout drew it.
      nudge.current = { index: i, expect: identityOf(line), tail: false, placement: line.placement ?? centreOf(bubble, panelB) }
    }
    const run = nudge.current!
    run.placement = nudgePlacement(run.placement, key, big, { x: bubble.width / 2 / panelB.width, y: bubble.height / 2 / panelB.height })
    setPreview({ index: i, placement: run.placement })
    if (nudgeTimer.current !== null) clearTimeout(nudgeTimer.current)
    nudgeTimer.current = setTimeout(flushNudge, NUDGE_COMMIT_MS)
  }

  /** Forgets a press whose release the stage never saw, and the drag it may have started. */
  function dropPress(): void {
    const p = press.current
    press.current = null
    if (p?.dragging) {
      setDragging(null)
      setPreview(null)
      tail.setTailPreview(null)
      widths.setWidthPreview(null)
    }
  }

  function pressBubble(e: PointerEvent<HTMLDivElement>, i: number): void {
    // A press in the open text places its caret.
    if (e.button !== 0 || inTextField(e.target) || inTailHandle(e.target) || inWidthHandle(e.target)) return
    // The new line being typed is not dragged before it is saved.
    const line = base[i]
    if (line === undefined) return
    dropPress()
    flushNudge()
    // A press on the edge of a bubble whose text is open saves the text first, so the drag that follows is of the
    // text the line will have, as commitText leaves it: what was typed, or the old text when nothing was.
    const typed = text !== null && text.index === i && !textClosed.current ? text.draft.trim() : ''
    if (text !== null && text.index === i) commitText()
    const expect = typed === '' ? identityOf(line) : { ...identityOf(line), text: typed }
    select(i)
    e.currentTarget.focus({ preventScroll: true })
    const box = boxOf(e.currentTarget)
    press.current = {
      index: i,
      pointerId: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      grab: { dx: e.clientX - (box.left + box.width / 2), dy: e.clientY - (box.top + box.height / 2) },
      bubble: { width: box.width, height: box.height },
      expect,
      dragging: false,
      tail: false,
      placement: null
    }
  }

  function onBubbleKeyDown(e: KeyboardEvent<HTMLDivElement>, i: number): void {
    // Keys typed in the bubble's open text are the text's, and the keys act only on the selected bubble.
    if (e.target !== e.currentTarget || selected !== i || e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      openText(i)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      remove(i)
    } else if ((ARROWS as readonly string[]).includes(e.key)) {
      e.preventDefault()
      nudgeBy(i, e.key as Arrow, e.shiftKey)
    }
  }

  function bind(i: number): HTMLAttributes<HTMLDivElement> {
    const attrs = {
      'data-line': i,
      role: 'button',
      tabIndex: 0,
      'aria-label': `Line ${i + 1}`,
      onPointerDown: (e: PointerEvent<HTMLDivElement>) => pressBubble(e, i),
      onDoubleClick: (e: MouseEvent<HTMLDivElement>) => {
        if (!inTextField(e.target) && !inTailHandle(e.target) && !inWidthHandle(e.target)) openText(i)
      },
      onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => onBubbleKeyDown(e, i),
      onFocus: (e: FocusEvent<HTMLDivElement>) => {
        keepFocus.current = true
        // Any focus but the dot's (the bubble's, or its text's) takes the focus from the dot, and the same for a width handle.
        if (!inTailHandle(e.target)) tail.tailFocus.current = false
        if (!inWidthHandle(e.target)) widths.widthFocus.current = null
        // Tabbing to a bubble selects it, as a click does. The new line is selected once it is saved.
        if (e.target === e.currentTarget && i < base.length) select(i)
      }
    }
    return attrs
  }

  function endPress(e: PointerEvent<HTMLElement>, commit: boolean): void {
    const p = press.current
    if (p === null || e.pointerId !== p.pointerId) return
    press.current = null
    if (!p.dragging) return
    dragEnded.current = true
    setDragging(null)
    if (commit && p.placement !== null) {
      if (p.tail) tail.commitTail(p.index, p.placement, p.expect)
      else if (p.width) widths.releaseWidth(p)
      else commitPlacement(p.index, p.placement, p.expect)
    } else {
      setPreview(null)
      tail.setTailPreview(null)
      widths.setWidthPreview(null)
    }
  }

  const stage: HTMLAttributes<HTMLElement> = {
    onPointerDown: (e) => {
      dragEnded.current = false
      if (e.button !== 0 || inBubble(e.target)) return
      tail.tailFocus.current = false
      widths.widthFocus.current = null
      dropPress()
      flushNudge()
      select(null)
    },
    onPointerMove: (e) => {
      const p = press.current
      if (p === null || e.pointerId !== p.pointerId) return
      // No button is down: the press was released where the stage could not see it (outside it, before the drag
      // took the capture), so it is over.
      if ((e.buttons & 1) === 0) {
        dropPress()
        return
      }
      if (!p.dragging) {
        if (Math.hypot(e.clientX - p.start.x, e.clientY - p.start.y) < DRAG_THRESHOLD_PX) return
        // Captured on the stage, not the bubble: an automatic bubble remounts as it moves into the placed layer.
        p.dragging = true
        stageRef.current?.setPointerCapture?.(e.pointerId)
        // Dragging the dot moves the tip, and a width handle sets the width: neither moves the bubble.
        if (!p.tail && !p.width) setDragging(p.index)
      }
      const panelB = panelBox()
      if (panelB === null) return
      if (p.width) return widths.dragWidth(p, e.clientX, panelB)
      p.placement = placementFromPointer({ pointer: { x: e.clientX, y: e.clientY }, grab: p.grab, panel: panelB, bubble: p.bubble })
      if (p.tail) tail.setTailPreview({ index: p.index, tip: p.placement })
      else setPreview({ index: p.index, placement: p.placement })
    },
    onPointerUp: (e) => endPress(e, true),
    onPointerCancel: (e) => endPress(e, false),
    onLostPointerCapture: (e) => endPress(e, false),
    onDoubleClick: (e) => {
      if (dragEnded.current || inBubble(e.target) || inControl(e.target) || adding !== null) return
      const panelB = panelBox()
      if (panelB === null || panelB.width <= 0 || panelB.height <= 0) return
      const x = e.clientX - panelB.left
      const y = e.clientY - panelB.top
      // The gutter around the panel is not part of it.
      if (x < 0 || y < 0 || x > panelB.width || y > panelB.height) return
      addAt(placementFromPointer({ pointer: { x: e.clientX, y: e.clientY }, grab: { dx: 0, dy: 0 }, panel: panelB, bubble: { width: 0, height: 0 } }))
    },
    onKeyDown: (e) => {
      // Escape clears the selection first; with nothing selected it is left to the workspace, which goes back.
      if (e.key !== 'Escape' || e.defaultPrevented || inTextField(e.target) || selected === null) return
      e.preventDefault()
      flushNudge()
      select(null)
      focusStage()
    },
    onBlur: (e) => {
      if (e.relatedTarget instanceof Node && !stageRef.current?.contains(e.relatedTarget)) keepFocus.current = false
    }
  }

  const textEditor =
    text === null
      ? null
      : createElement('textarea', {
          className: 'bubble-editor',
          'aria-label': 'Line text',
          value: text.draft,
          // It grows by rows as lines are added.
          rows: Math.max(1, text.draft.split('\n').length),
          ref: focusText,
          onChange: (e: ChangeEvent<HTMLTextAreaElement>) => {
            const draft = e.target.value
            setText((t) => (t === null ? t : { ...t, draft }))
          },
          onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              commitText()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              cancelText()
            }
          },
          onBlur: commitText
        })

  return {
    editing: { selected, textEditing, textEditor, preview, tailPreview: tail.tailPreview, widthPreview: widths.widthPreview, dragging, bind, bindTail: tail.bindTail, bindWidth: widths.bindWidth },
    selected,
    select,
    lines,
    stage,
    add,
    adding: adding !== null
  }
}
