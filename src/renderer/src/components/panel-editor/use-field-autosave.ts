import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import type { Panel, PanelCharacter, PanelItem, PanelPatch } from '@shared/types'
import { errorText } from '../characters/controls'
import { queuePanelSave, useLastWarnings } from './panel-save-queue'

/** How long a field waits after the last change before it saves. */
const AUTOSAVE_MS = 600

/** The panel's fields the editing mode's tabs save one by one. Dialogue saves through `useDialogueSaver`. */
export type AutosaveField = 'description' | 'setting' | 'shot' | 'aspect' | 'frame' | 'beside' | 'gapAfter' | 'gutter' | 'characters' | 'items'

/** What became of a sent value: stored, refused by the service, or not sent after all (the line changed, the panel is gone). */
type AutosaveOutcome = 'saved' | 'refused' | 'dropped'

export interface Autosave<T> {
  /** The draft while it is waiting, being saved or refused; otherwise the stored value. */
  value: T
  /** Changes the draft, and saves it `AUTOSAVE_MS` after the last change. */
  set(value: T): void
  /** Saves a waiting draft at once (text fields call it on blur). */
  flush(): void
  /** Drops the draft, so the stored value shows again. Nothing is sent. */
  undo(): void
  /** A change is waiting, being saved, or was refused: the draft, not the store, is what the user is editing. */
  pending: boolean
  /** The last save was refused, and its draft is kept. */
  refused: boolean
}

export interface AutosaveOptions<T> {
  /** The value as it is stored: text trimmed. */
  normalize(value: T): T
  /** Whether a value can be saved yet. One that cannot waits for the next change, and is dropped on unmount. */
  sendable?(value: T): boolean
  /** Saves a normalized value. */
  send(value: T): Promise<AutosaveOutcome>
}

interface Draft<T> {
  value: T
  /** `saved` keeps a draft that differs from the store only by the spaces being typed, until the field is left. */
  phase: 'waiting' | 'saving' | 'saved' | 'refused'
  seq: number
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * A local draft of one stored value, saved on its own: `AUTOSAVE_MS` after the last change, at once on
 * `flush`, and on unmount (Back, ‹ ›, another tab). While nothing is pending it shows the stored value, so an agent's
 * edit appears; while a change waits or is being saved, the draft stays. A refused save keeps the draft until the next
 * change or `undo`. Timers and the unmount read the latest stored value and options through refs: their closures may
 * be older than the store.
 */
export function useAutosave<T>(stored: T, options: AutosaveOptions<T>): Autosave<T> {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const draft = useRef<Draft<T> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)
  /** Saves sent and not settled yet: while any is, the server will not have the stored value for long. */
  const inFlight = useRef(0)
  const latest = useRef({ stored, options })
  useLayoutEffect(() => {
    latest.current = { stored, options }
  })

  const commit = useCallback((): void => {
    const d = draft.current
    if (d === null || d.phase !== 'waiting') return
    const { stored, options } = latest.current
    const value = options.normalize(d.value)
    if (options.sendable !== undefined && !options.sendable(value)) return
    // Typed and typed back: nothing to send, unless a save still going would leave something else.
    if (inFlight.current === 0 && same(value, stored)) {
      draft.current = same(d.value, value) ? null : { ...d, phase: 'saved' }
      rerender()
      return
    }
    draft.current = { ...d, phase: 'saving' }
    inFlight.current += 1
    rerender()
    void options.send(value).then((outcome) => {
      inFlight.current -= 1
      const now = draft.current
      // A newer change, or an undo, since: that one decides.
      if (now === null || now.seq !== d.seq) return
      draft.current = outcome === 'dropped' || (outcome === 'saved' && same(now.value, value)) ? null : { ...now, phase: outcome }
      rerender()
    })
  }, [])

  const flush = useCallback((): void => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    commit()
    // The field is left: a draft kept for its spaces gives way to the stored value.
    if (draft.current?.phase === 'saved') {
      draft.current = null
      rerender()
    }
  }, [commit])

  const set = useCallback(
    (value: T): void => {
      seq.current += 1
      draft.current = { value, phase: 'waiting', seq: seq.current }
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        commit()
      }, AUTOSAVE_MS)
      rerender()
    },
    [commit]
  )

  const undo = useCallback((): void => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    draft.current = null
    rerender()
  }, [])

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = null
      commit()
    },
    [commit]
  )

  const d = draft.current
  // A draft kept for its spaces shows only while the store still agrees with it: an agent's edit since shows instead.
  const shown = d === null || (d.phase === 'saved' && !same(options.normalize(d.value), stored)) ? stored : d.value
  return { value: shown, set, flush, undo, pending: d !== null && d.phase !== 'saved', refused: d?.phase === 'refused' }
}

/** The text of a field as it is stored: trimmed, as the old panel dialog stored it. */
function normalizeField<K extends AutosaveField>(field: K, value: Panel[K]): Panel[K] {
  switch (field) {
    case 'description':
    case 'setting':
      return (value as string).trim() as Panel[K]
    case 'characters':
      return (value as PanelCharacter[]).map((c) => ({ characterId: c.characterId, variationId: c.variationId, action: c.action.trim(), expression: c.expression.trim(), position: c.position.trim() })) as Panel[K]
    case 'items':
      return (value as PanelItem[]).map((i) => ({ itemId: i.itemId, usageId: i.usageId, heldBy: i.heldBy, action: i.action.trim() })) as Panel[K]
    default:
      return value
  }
}

/** A cast row with no ready look, or an item row with no ready usage, could only come back as an error: it waits until it has one. */
function sendableField<K extends AutosaveField>(field: K, value: Panel[K]): boolean {
  if (field === 'characters') return (value as PanelCharacter[]).every((c) => c.variationId !== '')
  if (field === 'items') return (value as PanelItem[]).every((i) => i.usageId !== '')
  return true
}

/** The patches a field's value saves as. A cast that loses someone first lets go of what they held: the service refuses an item held by someone not in the cast. */
function patchesFor<K extends AutosaveField>(panel: Panel, field: K, value: Panel[K]): PanelPatch[] {
  const patch = { [field]: value } as PanelPatch
  if (field !== 'characters') return [patch]
  const cast = new Set((value as PanelCharacter[]).map((c) => c.characterId))
  const released = panel.items.map((i) => (i.heldBy !== null && !cast.has(i.heldBy) ? { ...i, heldBy: null } : i))
  return released.some((i, n) => i !== panel.items[n]) ? [{ items: released }, patch] : [patch]
}

export interface FieldAutosave<T> extends Autosave<T> {
  /** The last save the service refused, until the next save or `undo`. */
  error: string | null
  /** From the service, when the panel's last save was of this field: it was saved, but something deserves a look. */
  warnings: string[]
}

/**
 * One field of the panel, saved as `{ [field]: value }` (text trimmed) through the panel's save queue, after the saves
 * made before it. Setting `characters` also clears `heldBy` for anyone who left the cast, through a second, `items`
 * save, sent first (the old dialog's rule). A panel that left the store saves nothing.
 */
export function useFieldAutosave<K extends AutosaveField>(panel: Panel, field: K): FieldAutosave<Panel[K]> {
  const [error, setError] = useState<string | null>(null)
  const panelId = panel.id
  const warnings = useLastWarnings(panelId, [field])
  const draft = useAutosave<Panel[K]>(panel[field], {
    normalize: (value) => normalizeField(field, value),
    sendable: (value) => sendableField(field, value),
    send: (value) => {
      setError(null)
      return queuePanelSave(panelId, (current) => patchesFor(current, field, value), field).then(
        (result) => (result === null ? 'dropped' : 'saved'),
        (e: unknown) => {
          setError(errorText(e))
          return 'refused'
        }
      )
    }
  })
  const { undo: dropDraft } = draft
  const undo = useCallback(() => {
    dropDraft()
    setError(null)
  }, [dropDraft])
  return { ...draft, undo, error, warnings }
}
