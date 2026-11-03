import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent } from 'react'
import { DialogueKindSchema } from '@shared/schemas'
import type { Character, DialogueLine, Panel } from '@shared/types'
import { Field } from '../characters/controls'
import { appendLine, editLine, identityOf, removeLine, type LineIdentity } from './dialogue-edits'
import { useLastWarnings } from './panel-save-queue'
import { useDialogueSaver, type DialogueSaver } from './use-dialogue-saver'
import { useAutosave } from './use-field-autosave'

const KINDS = DialogueKindSchema.options
/** The saves Lines shows the warnings of: the dialogue's, from here or from the stage. */
const DIALOGUE = ['dialogue'] as const

/** How long a row waits after a press is released before it is scrolled to: the second click of a double-click may be coming. */
export const AFTER_PRESS_MS = 400

/** Focus moved somewhere outside the element the event is on. */
const leaves = (e: FocusEvent<HTMLElement>): boolean => !(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))

/** The pointer's last press anywhere in the window, kept up to date by `usePresses`. */
export interface Presses {
  down: boolean
  /** `performance.now()` when it was last released. */
  releasedAt: number
}

/** Tracks the pointer's presses from the capture phase, so a handler further in sees the press that is going. */
export function usePresses(): Presses {
  const presses = useRef<Presses>({ down: false, releasedAt: Number.NEGATIVE_INFINITY }).current
  useEffect(() => {
    const press = (): void => {
      presses.down = true
    }
    const release = (): void => {
      presses.down = false
      presses.releasedAt = performance.now()
    }
    document.addEventListener('pointerdown', press, true)
    document.addEventListener('pointerup', release, true)
    document.addEventListener('pointercancel', release, true)
    return () => {
      document.removeEventListener('pointerdown', press, true)
      document.removeEventListener('pointerup', release, true)
      document.removeEventListener('pointercancel', release, true)
    }
  }, [presses])
  return presses
}

/**
 * Scrolls the row of the selected line into view. The stage sits above the rows in the same column, so scrolling moves
 * it: while the pointer is pressed (a bubble being dragged), or a double-click may still come, the row waits, and is
 * scrolled to `AFTER_PRESS_MS` after the last release.
 */
function useScrollToRow(line: number | null, row: (i: number) => HTMLElement | null, presses: Presses): void {
  useEffect(() => {
    if (line === null) return
    const scroll = (): void => row(line)?.scrollIntoView?.({ block: 'nearest' })
    if (!presses.down && performance.now() - presses.releasedAt >= AFTER_PRESS_MS) {
      scroll()
      return
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    const stop = (): void => {
      if (timer !== null) clearTimeout(timer)
      timer = null
      document.removeEventListener('pointerdown', wait, true)
      document.removeEventListener('pointerup', wait, true)
    }
    // Registered after `usePresses`' listeners, so `presses` already has the press or the release.
    function wait(): void {
      if (timer !== null) clearTimeout(timer)
      timer = presses.down
        ? null
        : setTimeout(() => {
            stop()
            scroll()
          }, AFTER_PRESS_MS)
    }
    wait()
    document.addEventListener('pointerdown', wait, true)
    document.addEventListener('pointerup', wait, true)
    return stop
  }, [line, row, presses])
}

export interface LinesTabProps {
  panel: Panel
  /** The whole roster, archived characters included: an archived speaker stays visible on the line that has them. */
  characters: Character[]
  /** The line selected on the stage, or by a row here. */
  selectedLine: number | null
  onSelectLine(i: number | null): void
  /** The pointer's presses, from the inspector, which outlives this tab: a press on the stage can open it. */
  presses: Presses
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
}

/**
 * One stored line. Its speaker, kind and text are one draft, saved `AUTOSAVE_MS` after the last change, when the row is
 * left and on unmount, as the whole dialogue built at send time with this line changed. Each save expects the line as
 * the edit found it, or as this row's last save left it: an agent's change in between makes it a conflict, not an
 * overwrite. A text left empty keeps the old text (Remove deletes).
 */
function LineRow({ index, line, characters, selected, save, error, onSelect, rowRef }: LineRowProps) {
  /** What the line will say on the server when this row's next save is built: as the edit found it, then as this row's last save left it. */
  const base = useRef<LineIdentity | null>(null)
  const inFlight = useRef(0)
  const draft = useAutosave<LineIdentity>(identityOf(line), {
    normalize: (v) => ({ speakerId: v.speakerId, kind: v.kind, text: v.text.trim() }),
    sendable: (v) => v.text !== '',
    send: (v) => {
      const expect = base.current ?? identityOf(line)
      base.current = v
      inFlight.current += 1
      return save((current) => editLine(current, index, expect, v)).then((outcome) => {
        inFlight.current -= 1
        if (outcome === 'refused') base.current = expect
        else if (outcome !== 'saved') base.current = null
        return outcome === 'saved' ? 'saved' : outcome === 'refused' ? 'refused' : 'dropped'
      })
    }
  })

  // A refused draft with no message left would be unsaved text nobody is told about: it gives way to the stored line.
  const orphaned = draft.refused && error === null
  const { undo } = draft
  useEffect(() => {
    if (orphaned) undo()
  }, [orphaned, undo])

  /** The line as a change made now must find it. */
  const expectNow = (): LineIdentity => (inFlight.current > 0 && base.current !== null ? base.current : identityOf(line))

  function change(patch: Partial<LineIdentity>): void {
    // An edit begins from the line as shown, the store's, unless this row still has a change of its own going.
    if (!draft.pending && inFlight.current === 0) base.current = identityOf(line)
    draft.set({ ...draft.value, ...patch })
  }

  function leave(): void {
    if (draft.value.text.trim() === '') draft.undo()
    else draft.flush()
  }

  function resetPlacement(): void {
    draft.flush()
    const expect = expectNow()
    void save((current) => editLine(current, index, expect, { placement: null }))
  }

  function remove(): void {
    draft.undo()
    const expect = expectNow()
    base.current = null
    void save((current) => removeLine(current, index, expect))
  }

  return (
    <li
      ref={rowRef}
      className="line-row"
      aria-current={selected ? 'true' : undefined}
      onFocus={() => {
        if (!selected) onSelect()
      }}
      onBlur={leave}
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
    void save((current) => appendLine(current, { ...value, text, placement: null })).then((outcome) => {
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
 * placed, and Remove; then "Add line". The row of the line selected on the stage is marked and scrolled into view, and
 * going into a row selects its bubble. A line that changed under an edit, here or on the stage, and a dialogue save the
 * service refused, are said here, once.
 */
export function LinesTab({ panel, characters, selectedLine, onSelectLine, presses }: LinesTabProps) {
  const { save, conflict, error, clear } = useDialogueSaver(panel.id)
  const warnings = useLastWarnings(panel.id, DIALOGUE)
  const [adding, setAdding] = useState<LineIdentity | null>(null)
  const rows = useRef<(HTMLLIElement | null)[]>([])
  const rowAt = useCallback((i: number) => rows.current[i] ?? null, [])
  useScrollToRow(selectedLine, rowAt, presses)

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
