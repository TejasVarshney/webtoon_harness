import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type RefObject } from 'react'
import { DialogueKindSchema } from '@shared/schemas'
import type { BubbleStyle, Character, DialogueLine, Panel } from '@shared/types'
import { Field } from '../characters/controls'
import { bubbleShape } from '../visualizer/bubble-layout'
import { BubbleStyleBlock } from './BubbleStyleBlock'
import { appendLine, editLine, identityOf, removeLine, type LineIdentity } from './dialogue-edits'
import { useLastWarnings } from './panel-save-queue'
import type { StylePreview } from './PanelStage'
import { useDialogueSaver, type DialogueSaver } from './use-dialogue-saver'
import { useAutosave } from './use-field-autosave'

const KINDS = DialogueKindSchema.options
/** The saves Lines shows the warnings of: the dialogue's, from here or from the stage. */
const DIALOGUE = ['dialogue'] as const

/** Focus moved somewhere outside the element the event is on. */
const leaves = (e: FocusEvent<HTMLElement>): boolean => !(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))

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
 * where they put it, and stays.
 */
function useScrollToRow(line: number | null, row: (i: number) => HTMLElement | null, area: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = line === null ? null : row(line)
    const box = area.current
    if (el === null || box === null || el.contains(document.activeElement)) return
    const r = el.getBoundingClientRect()
    const a = visibleSpan(box)
    // The nearest edge, and the row's top when it is taller than the area.
    if (r.top < a.top) box.scrollTop += r.top - a.top
    else if (r.bottom > a.bottom) box.scrollTop += Math.min(r.bottom - a.bottom, r.top - a.top)
  }, [line, row, area])
}

export interface LinesTabProps {
  panel: Panel
  /** The whole roster, archived characters included: an archived speaker stays visible on the line that has them. */
  characters: Character[]
  /** The line selected on the stage, or by a row here. */
  selectedLine: number | null
  onSelectLine(i: number | null): void
  /** The inspector's scroll area the rows are in, which the selected row is scrolled inside. */
  scrollArea: RefObject<HTMLElement | null>
  /** Shows the style being picked on the stage until it is saved; null ends it. */
  onPreviewStyle?(preview: StylePreview | null): void
}

/** Who says a line: Narration, or a non-archived character, plus the line's own speaker if they were archived since. */
function SpeakerSelect({ id, characters, value, onChange }: { id: string; characters: Character[]; value: string | null; onChange(next: string | null): void }) {
  const active = characters.filter((c) => !c.archived)
  const speaker = characters.find((c) => c.id === value)
  const options = speaker === undefined || !speaker.archived ? active : [...active, speaker]
  return (
    <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}>
      <option value="">Narration</option>
      {value !== null && speaker === undefined && <option value={value}>{value}</option>}
      {options.map((c) => (
        <option key={c.id} value={c.id}>
          {c.archived ? `${c.name} (archived)` : c.name}
        </option>
      ))}
    </select>
  )
}

/** A line's speaker, kind and text. */
function LineFields({ characters, value, autoFocus, onChange }: { characters: Character[]; value: LineIdentity; autoFocus?: boolean; onChange(change: Partial<LineIdentity>): void }) {
  return (
    <>
      <div className="field-row">
        <Field label="Speaker">{(id) => <SpeakerSelect id={id} characters={characters} value={value.speakerId} onChange={(speakerId) => onChange({ speakerId })} />}</Field>
        <Field label="Kind">
          {(id) => (
            <select id={id} value={value.kind} onChange={(e) => onChange({ kind: e.target.value as LineIdentity['kind'] })}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>
      <Field label="Text">{(id) => <textarea id={id} rows={2} autoFocus={autoFocus} value={value.text} onChange={(e) => onChange({ text: e.target.value })} />}</Field>
    </>
  )
}

interface LineRowProps {
  index: number
  line: DialogueLine
  characters: Character[]
  selected: boolean
  save: DialogueSaver['save']
  /** The refusal the Lines tab shows. A refused draft lasts as long as it: Undo, or a later save, clears both. */
  error: string | null
  onSelect(): void
  rowRef(el: HTMLLIElement | null): void
  onPreviewStyle?(preview: StylePreview | null): void
}

/**
 * One stored line. Its speaker, kind and text are one draft, saved `AUTOSAVE_MS` after the last change, when the row is
 * left and on unmount, as the whole dialogue built at send time with this line changed. Each save expects the line as
 * the edit found it, or as this row's last save left it: an agent's change in between makes it a conflict, not an
 * overwrite. A text left empty keeps the old text (Remove deletes). The style is a draft of its own, saved the same
 * way, so a pick and typed text both land. The tail is not in it: a tail dragged on the stage must never be
 * overwritten by a style that was waiting.
 */
function LineRow({ index, line, characters, selected, save, error, onSelect, rowRef, onPreviewStyle }: LineRowProps) {
  /** What the line will say on the server when this row's next save is built: as the edit found it, then as this row's last save left it. */
  const base = useRef<LineIdentity | null>(null)
  const inFlight = useRef(0)
  /**
   * The lines the waiting style may be saved onto: the line as it was when the style was picked, and each text this
   * row has sent since. A style never depends on the text, so it saves whether a text save landed (the line now says
   * the new text) or was refused (it still says the old), and never onto a different line that moved into this row.
   */
  const styleExpect = useRef<LineIdentity[]>([])
  const draft = useAutosave<LineIdentity>(identityOf(line), {
    normalize: (v) => ({ speakerId: v.speakerId, kind: v.kind, text: v.text.trim() }),
    sendable: (v) => v.text !== '',
    send: (v) => {
      const expect = base.current ?? identityOf(line)
      base.current = v
      // A style waiting on this row may find the line either way once this save is decided.
      styleExpect.current.push(v)
      inFlight.current += 1
      return save((current) => editLine(current, index, expect, v)).then((outcome) => {
        inFlight.current -= 1
        if (outcome === 'refused') base.current = expect
        else if (outcome !== 'saved') base.current = null
        return outcome === 'saved' ? 'saved' : outcome === 'refused' ? 'refused' : 'dropped'
      })
    }
  })

  /** The line as a change made now must find it. */
  const expectNow = (): LineIdentity => (inFlight.current > 0 && base.current !== null ? base.current : identityOf(line))

  const style = useAutosave<BubbleStyle | null>(line.style, {
    normalize: (v) => v,
    send: (v) =>
      save((current) => {
        for (const expect of styleExpect.current) {
          const built = editLine(current, index, expect, { style: v })
          if (built !== null) return built
        }
        return null
      }).then((outcome) => (outcome === 'saved' ? 'saved' : outcome === 'refused' ? 'refused' : 'dropped'))
  })

  /** Picks a style; a pick that begins a new one notes the line it is for. */
  function setStyle(next: BubbleStyle | null): void {
    // A text save of this row still in flight may land or be refused: the line then says the new text or the old, so both count.
    if (!style.pending) styleExpect.current = inFlight.current > 0 && base.current !== null ? [identityOf(line), base.current] : [identityOf(line)]
    style.set(next)
  }

  // The line in this row is not the one the style was picked on (it was removed or moved, or an agent changed it): the
  // style is sent now, so it is dropped with the usual notice, or, if it was refused, given up.
  const { pending: styleWaiting, refused: styleRefused, flush: flushStyle, undo: dropStyle } = style
  useEffect(() => {
    if (!styleWaiting || styleExpect.current.some((e) => e.speakerId === line.speakerId && e.kind === line.kind && e.text === line.text)) return
    if (styleRefused) dropStyle()
    else flushStyle()
  }, [styleWaiting, styleRefused, line.speakerId, line.kind, line.text, flushStyle, dropStyle])

  // A refused draft with no message left would be unsaved text nobody is told about: it gives way to the stored line.
  const orphaned = draft.refused && error === null
  const { undo } = draft
  useEffect(() => {
    if (orphaned) undo()
  }, [orphaned, undo])
  const styleOrphaned = style.refused && error === null
  const { undo: undoStyle } = style
  useEffect(() => {
    if (styleOrphaned) undoStyle()
  }, [styleOrphaned, undoStyle])

  // The stage draws the style as picked while it waits to be saved, and goes back to the store's once it is.
  const previewTo = useRef(onPreviewStyle)
  useLayoutEffect(() => {
    previewTo.current = onPreviewStyle
  })
  const { pending: stylePending, value: styleValue } = style
  useLayoutEffect(() => {
    if (!stylePending) return
    previewTo.current?.({ index, style: styleValue })
    return () => previewTo.current?.(null)
  }, [stylePending, styleValue, index])

  function change(patch: Partial<LineIdentity>): void {
    // An edit begins from the line as shown, the store's, unless this row still has a change of its own going.
    if (!draft.pending && inFlight.current === 0) base.current = identityOf(line)
    draft.set({ ...draft.value, ...patch })
  }

  function leave(): void {
    if (draft.value.text.trim() === '') draft.undo()
    else draft.flush()
    style.flush()
  }

  /** The tail saves at once, after whatever of the row is still waiting. */
  function setTail(next: 'none' | null): void {
    draft.flush()
    style.flush()
    const expect = expectNow()
    void save((current) => editLine(current, index, expect, { tail: next }))
  }

  function resetPlacement(): void {
    draft.flush()
    const expect = expectNow()
    void save((current) => editLine(current, index, expect, { placement: null }))
  }

  function remove(): void {
    draft.undo()
    style.undo()
    const expect = expectNow()
    base.current = null
    void save((current) => removeLine(current, index, expect))
  }

  return (
    <li
      ref={rowRef}
      className="line-row"
      aria-current={selected ? 'true' : undefined}
      onFocus={(e) => {
        // A press focuses its button before the release. Selecting here would open this row's block, or close one above,
        // and move the button from under the pointer, so no click would fire.
        if (!selected && !(e.target instanceof Element && e.target.closest('.form-actions'))) onSelect()
      }}
      onBlur={(e) => {
        // Moving between the row's own fields is not leaving it: a text emptied on the way must not undo the rest.
        if (leaves(e)) leave()
      }}
    >
      <LineFields characters={characters} value={draft.value} onChange={change} />
      <div className="form-actions">
        {line.placement !== null && (
          <button type="button" onClick={resetPlacement}>
            Reset to auto
          </button>
        )}
        <button type="button" onClick={remove}>
          Remove
        </button>
      </div>
      {selected && (
        <BubbleStyleBlock
          autoShape={bubbleShape({ kind: draft.value.kind, text: draft.value.text })}
          style={style.value}
          tail={line.tail}
          onStyle={setStyle}
          onTail={setTail}
        />
      )}
    </li>
  )
}

interface NewLineRowProps {
  initial: LineIdentity
  characters: Character[]
  save: DialogueSaver['save']
  /** The refusal the Lines tab shows: a refused new line goes with it. */
  error: string | null
  /** The new line is saved, or was left empty, or its refusal cleared: the row goes. */
  onDone(): void
}

/**
 * A line added from Lines, with the automatic layout. As on the stage, it is saved only once it has text: when the row
 * is left, or on unmount. Left empty, it goes.
 */
function NewLineRow({ initial, characters, save, error, onDone }: NewLineRowProps) {
  const [value, setValue] = useState(initial)
  const [state, setState] = useState<'typing' | 'saving' | 'refused'>('typing')
  const latest = useRef({ value, state })
  useLayoutEffect(() => {
    latest.current = { value, state }
  })
  /** Set once the line is sent or dropped, so the unmount does not send it again. */
  const settled = useRef(false)

  function commit(unmounting = false): void {
    const { value, state } = latest.current
    if (state === 'saving' || settled.current) return
    const text = value.text.trim()
    if (text === '') {
      // Left empty, it goes. Going away empty, it has nothing to send.
      if (!unmounting) {
        settled.current = true
        onDone()
      }
      return
    }
    settled.current = true
    setState('saving')
    void save((current) => appendLine(current, { ...value, text, placement: null, style: null, tail: null })).then((outcome) => {
      if (outcome !== 'refused') onDone()
      else {
        settled.current = false
        setState('refused')
      }
    })
  }

  // Back or ‹ › before the row was left: a line with text is still saved.
  const commitRef = useRef(commit)
  useLayoutEffect(() => {
    commitRef.current = commit
  })
  useEffect(() => () => commitRef.current(true), [])

  // A refused line whose message is gone (Undo, or a later save) goes too.
  const orphaned = state === 'refused' && error === null
  const done = useRef(onDone)
  useLayoutEffect(() => {
    done.current = onDone
  })
  useEffect(() => {
    if (!orphaned) return
    settled.current = true
    done.current()
  }, [orphaned])

  return (
    <li
      className="line-row"
      onBlur={(e) => {
        if (leaves(e)) commit()
      }}
    >
      <LineFields
        characters={characters}
        value={value}
        autoFocus
        onChange={(change) => {
          setValue((v) => ({ ...v, ...change }))
          if (state === 'refused') setState('typing')
        }}
      />
      <div className="form-actions">
        <button
          type="button"
          disabled={state === 'saving'}
          onClick={() => {
            settled.current = true
            onDone()
          }}
        >
          Remove
        </button>
      </div>
    </li>
  )
}

/**
 * The Lines tab: the panel's lines in reading order, each a row with its speaker, kind, text, "Reset to auto" when
 * placed, and Remove; then "Add line". The row of the line selected on the stage is marked and scrolled into view, in
 * the inspector's scroll area only, and going into a row selects its bubble. A line that changed under an edit, here or
 * on the stage, and a dialogue save the service refused, are said here, once.
 */
export function LinesTab({ panel, characters, selectedLine, onSelectLine, scrollArea, onPreviewStyle }: LinesTabProps) {
  const { save, conflict, error, clear } = useDialogueSaver(panel.id)
  const warnings = useLastWarnings(panel.id, DIALOGUE)
  const [adding, setAdding] = useState<LineIdentity | null>(null)
  const rows = useRef<(HTMLLIElement | null)[]>([])
  const rowAt = useCallback((i: number) => rows.current[i] ?? null, [])
  useScrollToRow(selectedLine, rowAt, scrollArea)

  function addLine(): void {
    const speakerId = panel.characters[0]?.characterId ?? null
    setAdding({ speakerId, kind: speakerId === null ? 'narration' : 'speech', text: '' })
  }

  return (
    <div className="lines-tab">
      {conflict && (
        <p role="alert" className="error inspector-alert">
          This line changed while you were editing it.
        </p>
      )}
      {error !== null && (
        <div role="alert" className="error inspector-alert">
          <p>{error}</p>
          <button type="button" onClick={clear}>
            Undo my change
          </button>
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="inspector-warnings">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      {panel.dialogue.length === 0 && adding === null ? (
        <p className="placeholder">No lines yet. Double-click the panel to place one.</p>
      ) : (
        <ol className="line-rows">
          {/* By index: line ids change on every dialogue save, and the row being typed in must stay. */}
          {panel.dialogue.map((line, i) => (
            <LineRow
              key={i}
              index={i}
              line={line}
              characters={characters}
              selected={selectedLine === i}
              save={save}
              error={error}
              onSelect={() => onSelectLine(i)}
              onPreviewStyle={onPreviewStyle}
              rowRef={(el) => {
                rows.current[i] = el
              }}
            />
          ))}
          {adding !== null && <NewLineRow key="new" initial={adding} characters={characters} save={save} error={error} onDone={() => setAdding(null)} />}
        </ol>
      )}
      <div className="form-actions">
        <button type="button" disabled={adding !== null} onClick={addLine}>
          Add line
        </button>
      </div>
    </div>
  )
}
