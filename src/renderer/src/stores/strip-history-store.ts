import { create } from 'zustand'
import type { Panel, PanelAspect, StripBackground, StripLayout } from '@shared/types'
import { useAppStore } from './app-store'

// The strip's undo and redo history: what the user changed on what the strip shows, per episode, in memory. A step is
// data (what it touched, the value before and the value after), never a closure, so it can be checked against the strip
// before it is applied. Applying one is `strip-undo.ts`; this module only keeps the stacks.

/** What a step is called in the bar's titles: "Undo move", "Redo layout". */
export type StepLabel = 'move' | 'resize' | 'layout' | 'shape' | 'frame' | 'lettering' | 'background' | 'crop' | 'picture'

/** The panel fields the strip draws that a field step holds: only the ones the change touched. */
export type StripFields = Partial<Pick<Panel, 'aspect' | 'frame' | 'cut' | 'dialogue'>>

/** A panel's picture: its current version, and its shape, which a crop can change in the same save. */
export interface PictureState {
  versionId: string
  aspect: PanelAspect
}

interface StepBase {
  episodeId: string
  label: StepLabel
}

export type StripStep =
  | (StepBase & { kind: 'place'; before: StripLayout; after: StripLayout; /** The panels the gesture moved, scrolled to after a step. */ panelIds: string[] })
  | (StepBase & { kind: 'fields'; panelId: string; before: StripFields; after: StripFields })
  | (StepBase & { kind: 'background'; before: StripBackground | null; after: StripBackground | null })
  | (StepBase & { kind: 'picture'; panelId: string; before: PictureState; after: PictureState })

export type Direction = 'undo' | 'redo'

interface EpisodeHistory {
  undo: StripStep[]
  redo: StripStep[]
}

/** How the last undo or redo ended: applied, refused because the strip changed since, or refused by the service. */
export type StepOutcome = { kind: 'done' } | { kind: 'stale' } | { kind: 'refused'; error: string }

export interface StripHistoryData {
  /** Each episode's stacks, the next step last. */
  episodes: Record<string, EpisodeHistory>
  /** An undo or redo is running: the buttons and keys wait for it. */
  busy: boolean
  /** Why the last undo or redo of an episode did nothing; it goes with the next recorded change. */
  notice: { episodeId: string; text: string } | null
}

export interface StripHistoryActions {
  /** Adds the user's change. A change that changed nothing is not kept; see `MERGE_MS` for when it joins the last step. */
  record(step: StripStep, at?: number): void
  /** Takes the next step to undo or redo and marks the history busy; null when there is none or another is running. */
  begin(direction: Direction, episodeId: string): StripStep | null
  /** Ends what `begin` started with `step`: it moves to the other stack, or stays (refused), or the history goes (stale). */
  finish(direction: Direction, step: StripStep, outcome: StepOutcome): void
  /** A deleted panel's steps go; a layout step keeps the rest of the strip, without that panel. */
  dropPanel(panelId: string): void
  /** The episode's background steps go: a picked image was not recorded, and they no longer lead back to what it shows. */
  dropBackground(episodeId: string): void
  /** Forgets everything: the project closed or another opened. */
  reset(): void
}

/** At most this many steps per episode; the oldest goes first. */
export const MAX_STEPS = 100
/** Saves of the same panel's same fields (a slider, a colour picker) this close together are one step. */
export const MERGE_MS = 800

const STALE_NOTICE: Record<Direction, string> = {
  undo: "Can't undo: the strip changed since.",
  redo: "Can't redo: the strip changed since."
}

export const initialStripHistoryState: StripHistoryData = { episodes: {}, busy: false, notice: null }

/**
 * A value as JSON with its object keys sorted and every `id` key left out. The only `id`s in a step's values are
 * dialogue lines', which the service mints afresh on every save, so two arrays that store the same lines compare equal.
 */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v)
            .filter(([k]) => k !== 'id')
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        )
      : v
  )
}

const changesNothing = (step: StripStep): boolean => canonical(step.before) === canonical(step.after)

/** Whether `next` continues `top`: the same panel's same fields, or the same episode's background. */
function continues(top: StripStep, next: StripStep): boolean {
  if (top.kind === 'fields' && next.kind === 'fields') return top.panelId === next.panelId && Object.keys(top.after).sort().join() === Object.keys(next.after).sort().join()
  return top.kind === 'background' && next.kind === 'background' && top.episodeId === next.episodeId
}

/** A layout without one panel: it is gone from the episode, and nothing else in the layout moved with it. */
function withoutPanel(layout: StripLayout, panelId: string): StripLayout {
  const { [panelId]: _gone, ...placements } = layout.placements
  return { order: layout.order.filter((id) => id !== panelId), placements }
}

function dropFrom(steps: StripStep[], panelId: string): StripStep[] {
  return steps.flatMap((step): StripStep[] => {
    if (step.kind === 'fields' || step.kind === 'picture') return step.panelId === panelId ? [] : [step]
    if (step.kind !== 'place' || !step.before.order.includes(panelId)) return [step]
    const kept: StripStep = { ...step, before: withoutPanel(step.before, panelId), after: withoutPanel(step.after, panelId), panelIds: step.panelIds.filter((id) => id !== panelId) }
    return changesNothing(kept) ? [] : [kept]
  })
}

/**
 * The step the last change made, and when: only that step, still on top, can take the next change in. An undo or redo
 * forgets it, so the next change never joins the step below the one undone.
 */
let lastRecorded: { at: number; step: StripStep } | null = null

export const useStripHistoryStore = create<StripHistoryData & StripHistoryActions>()((set, get) => {
  function history(episodeId: string): EpisodeHistory {
    return get().episodes[episodeId] ?? { undo: [], redo: [] }
  }

  function put(episodeId: string, next: EpisodeHistory): void {
    set((s) => ({ episodes: { ...s.episodes, [episodeId]: next } }))
  }

  return {
    ...initialStripHistoryState,

    record(step, at = Date.now()) {
      const { undo } = history(step.episodeId)
      const top = undo.at(-1)
      const merging = top !== undefined && lastRecorded !== null && lastRecorded.step === top && at - lastRecorded.at <= MERGE_MS && continues(top, step)
      if (!merging && changesNothing(step)) return
      // The merged step keeps the first `before` and takes the last `after`.
      const joined = merging ? ({ ...top, after: step.after } as StripStep) : step
      const rest = merging ? undo.slice(0, -1) : undo
      lastRecorded = { at, step: joined }
      // A slider dragged back to where it started leaves nothing to undo.
      const stack = changesNothing(joined) ? rest : [...rest, joined]
      put(step.episodeId, { undo: stack.slice(-MAX_STEPS), redo: [] })
      if (get().notice !== null) set({ notice: null })
    },

    begin(direction, episodeId) {
      if (get().busy) return null
      const step = history(episodeId)[direction].at(-1) ?? null
      if (step !== null) set({ busy: true })
      return step
    },

    finish(direction, step, outcome) {
      lastRecorded = null
      const { episodeId } = step
      const now = history(episodeId)
      const other: Direction = direction === 'undo' ? 'redo' : 'undo'
      if (outcome.kind === 'stale') {
        set((s) => ({ busy: false, notice: { episodeId, text: STALE_NOTICE[direction] }, episodes: { ...s.episodes, [episodeId]: { undo: [], redo: [] } } }))
        return
      }
      if (outcome.kind === 'refused') {
        set({ busy: false, notice: { episodeId, text: outcome.error } })
        return
      }
      // By identity: a change recorded, or a panel deleted, while the step ran may have taken it off its stack already.
      const moved = now[direction].includes(step) ? { [direction]: now[direction].filter((s) => s !== step), [other]: [...now[other], step].slice(-MAX_STEPS) } : now
      set((s) => ({ busy: false, notice: null, episodes: { ...s.episodes, [episodeId]: moved as EpisodeHistory } }))
    },

    dropPanel(panelId) {
      const episodes: Record<string, EpisodeHistory> = {}
      for (const [id, h] of Object.entries(get().episodes)) episodes[id] = { undo: dropFrom(h.undo, panelId), redo: dropFrom(h.redo, panelId) }
      set({ episodes })
    },

    dropBackground(episodeId) {
      const { undo, redo } = history(episodeId)
      const keep = (steps: StripStep[]): StripStep[] => steps.filter((s) => s.kind !== 'background')
      put(episodeId, { undo: keep(undo), redo: keep(redo) })
    },

    reset() {
      lastRecorded = null
      set({ ...initialStripHistoryState })
    }
  }
})

/** What sends the edits still waiting to be saved (a run of nudges on its timer), so an undo takes them back, not the step below. */
const flushers = new Set<() => void>()

/** Registers `flush` until the returned function is called. */
export function flushBeforeStep(flush: () => void): () => void {
  flushers.add(flush)
  return () => void flushers.delete(flush)
}

/** Sends every edit still waiting, so its save is queued or tracked before an undo waits for the saves. */
export function flushPendingEdits(): void {
  flushers.forEach((flush) => flush())
}

/** The recorded saves still in flight (a move, a background, a picture), which an undo waits for. */
const inFlight = new Set<Promise<unknown>>()

/** Keeps `save` among the saves an undo waits for until it settles, and passes it on. */
export function track<T>(save: Promise<T>): Promise<T> {
  inFlight.add(save)
  const forget = (): void => void inFlight.delete(save)
  save.then(forget, forget)
  return save
}

/** Settles once every save `track` holds now has, refused or not. */
export async function whenTracked(): Promise<void> {
  await Promise.allSettled([...inFlight])
}

/** The next step of `direction` in the episode, which the bar names; null when there is none. */
export function nextStep(s: StripHistoryData, direction: Direction, episodeId: string | null): StripStep | null {
  return episodeId === null ? null : (s.episodes[episodeId]?.[direction].at(-1) ?? null)
}

// The history belongs to the project that is open: closing it, or opening another, forgets it.
useAppStore.subscribe((s, prev) => {
  if (s.projectId !== prev.projectId) useStripHistoryStore.getState().reset()
})
