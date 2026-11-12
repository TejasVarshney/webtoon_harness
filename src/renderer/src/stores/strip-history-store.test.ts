import { beforeEach, describe, expect, it } from 'vitest'
import type { StripLayout } from '@shared/types'
import { PROJECT_ID as projectId } from '../test/character-fixtures'
import { EPISODE_ID } from '../test/panel-fixtures'
import { initialAppState, useAppStore } from './app-store'
import { canonical, initialStripHistoryState, MAX_STEPS, MERGE_MS, nextStep, useStripHistoryStore, type StripStep } from './strip-history-store'

const OTHER_EPISODE = 'epi_0000000002'
const A = 'pnl_00000000aa'
const B = 'pnl_00000000bb'

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId })
  useStripHistoryStore.getState().reset()
})

const layout = (order: string[], placements: StripLayout['placements']): StripLayout => ({ order, placements })
const place = (y: number, episodeId = EPISODE_ID): Extract<StripStep, { kind: 'place' }> => ({
  kind: 'place',
  episodeId,
  label: 'move',
  panelIds: [A],
  before: layout([A, B], { [A]: null, [B]: null }),
  after: layout([A, B], { [A]: { x: 0, y, width: 200 }, [B]: { x: 0, y: 400, width: 200 } })
})
const frame = (from: 'bordered' | 'borderless', to: 'bordered' | 'borderless', panelId = A): StripStep => ({ kind: 'fields', episodeId: EPISODE_ID, panelId, label: 'frame', before: { frame: from }, after: { frame: to } })

const history = () => useStripHistoryStore.getState()
const stack = (direction: 'undo' | 'redo', episodeId = EPISODE_ID) => history().episodes[episodeId]?.[direction] ?? []

/** Runs one undo or redo through the store as `strip-undo.ts` does, ending it with `outcome`. */
function step(direction: 'undo' | 'redo', outcome: Parameters<ReturnType<typeof history>['finish']>[2] = { kind: 'done' }, episodeId = EPISODE_ID): StripStep | null {
  const taken = history().begin(direction, episodeId)
  if (taken !== null) history().finish(direction, taken, outcome)
  return taken
}

describe('useStripHistoryStore', () => {
  it('records a change, and undo and redo move it between the stacks', () => {
    const s = place(100)
    history().record(s, 0)
    expect(nextStep(history(), 'undo', EPISODE_ID)).toBe(s)
    expect(nextStep(history(), 'redo', EPISODE_ID)).toBeNull()
    expect(step('undo')).toBe(s)
    expect(stack('undo')).toEqual([])
    expect(nextStep(history(), 'redo', EPISODE_ID)).toBe(s)
    expect(step('redo')).toBe(s)
    expect(stack('undo')).toEqual([s])
    expect(stack('redo')).toEqual([])
  })

  it('keeps nothing for a change that changed nothing', () => {
    history().record(frame('bordered', 'bordered'), 0)
    expect(stack('undo')).toEqual([])
  })

  it(`keeps at most ${MAX_STEPS} steps, dropping the oldest`, () => {
    const steps = Array.from({ length: MAX_STEPS + 5 }, (_, i) => place(i + 1))
    steps.forEach((s, i) => history().record(s, i * 10_000))
    expect(stack('undo')).toHaveLength(MAX_STEPS)
    expect(stack('undo')[0]).toBe(steps[5])
    expect(stack('undo').at(-1)).toBe(steps.at(-1))
  })

  it('a new change empties redo', () => {
    history().record(place(100), 0)
    history().record(place(200), 10_000)
    step('undo')
    expect(stack('redo')).toHaveLength(1)
    history().record(frame('bordered', 'borderless'), 20_000)
    expect(stack('redo')).toEqual([])
    expect(stack('undo').map((s) => s.kind)).toEqual(['place', 'fields'])
  })

  it(`merges saves of the same panel's same fields within ${MERGE_MS} ms, keeping the first before and the last after`, () => {
    history().record({ kind: 'fields', episodeId: EPISODE_ID, panelId: A, label: 'shape', before: { aspect: '3:4' }, after: { aspect: '1:1' } }, 1000)
    history().record({ kind: 'fields', episodeId: EPISODE_ID, panelId: A, label: 'shape', before: { aspect: '1:1' }, after: { aspect: '16:9' } }, 1000 + MERGE_MS)
    expect(stack('undo')).toHaveLength(1)
    expect(stack('undo')[0]).toMatchObject({ before: { aspect: '3:4' }, after: { aspect: '16:9' } })
    // Too late, another panel, or other fields: each is a step of its own.
    history().record({ kind: 'fields', episodeId: EPISODE_ID, panelId: A, label: 'shape', before: { aspect: '16:9' }, after: { aspect: '1:1' } }, 1000 + 3 * MERGE_MS)
    history().record(frame('bordered', 'borderless', B), 1000 + 3 * MERGE_MS + 10)
    history().record(frame('bordered', 'borderless'), 1000 + 3 * MERGE_MS + 20)
    expect(stack('undo')).toHaveLength(4)
  })

  it('a merge that ends where it began leaves nothing, and background saves merge like fields', () => {
    history().record(frame('bordered', 'borderless'), 0)
    history().record(frame('borderless', 'bordered'), 100)
    expect(stack('undo')).toEqual([])
    const bg = (from: string, to: string): StripStep => ({ kind: 'background', episodeId: EPISODE_ID, label: 'background', before: { kind: 'solid', color: from }, after: { kind: 'solid', color: to } })
    history().record(bg('#ffffff', '#111111'), 1000)
    history().record(bg('#111111', '#222222'), 1300)
    expect(stack('undo')).toEqual([expect.objectContaining({ before: { kind: 'solid', color: '#ffffff' }, after: { kind: 'solid', color: '#222222' } })])
  })

  it('an undo ends the merging: the next change is a step of its own', () => {
    history().record(frame('bordered', 'borderless'), 0)
    history().record(frame('bordered', 'borderless', B), 10)
    step('undo')
    history().record(frame('bordered', 'borderless'), 20)
    expect(stack('undo')).toHaveLength(2)
  })

  it('keeps a history per episode', () => {
    history().record(place(100), 0)
    history().record(place(100, OTHER_EPISODE), 10_000)
    expect(stack('undo')).toHaveLength(1)
    expect(stack('undo', OTHER_EPISODE)).toHaveLength(1)
    step('undo', { kind: 'done' }, OTHER_EPISODE)
    expect(stack('undo')).toHaveLength(1)
    expect(nextStep(history(), 'undo', null)).toBeNull()
  })

  it('is emptied when the project closes or another opens', () => {
    history().record(place(100), 0)
    useAppStore.setState({ projectId: 'prj_other00001' })
    expect(history().episodes).toEqual({})
    history().record(place(100), 10_000)
    useAppStore.setState({ projectId: null })
    expect(history()).toMatchObject(initialStripHistoryState)
  })

  it('a stale step empties the episode history and says so, until the next change', () => {
    history().record(place(100), 0)
    history().record(place(200), 10_000)
    history().record(place(300, OTHER_EPISODE), 20_000)
    step('undo', { kind: 'stale' })
    expect(stack('undo')).toEqual([])
    expect(stack('redo')).toEqual([])
    expect(stack('undo', OTHER_EPISODE)).toHaveLength(1)
    expect(history().notice).toEqual({ episodeId: EPISODE_ID, text: "Can't undo: the strip changed since." })
    history().record(place(400), 30_000)
    expect(history().notice).toBeNull()
    step('undo')
    step('redo', { kind: 'stale' })
    expect(history().notice).toEqual({ episodeId: EPISODE_ID, text: "Can't redo: the strip changed since." })
  })

  it('a refused step stays where it was, and the error shows', () => {
    const s = place(100)
    history().record(s, 0)
    step('undo', { kind: 'refused', error: 'disk full' })
    expect(stack('undo')).toEqual([s])
    expect(stack('redo')).toEqual([])
    expect(history()).toMatchObject({ busy: false, notice: { episodeId: EPISODE_ID, text: 'disk full' } })
  })

  it('runs one step at a time: begin gives nothing while one runs', () => {
    history().record(place(100), 0)
    history().record(place(200), 10_000)
    const first = history().begin('undo', EPISODE_ID)
    expect(first).not.toBeNull()
    expect(history().busy).toBe(true)
    expect(history().begin('undo', EPISODE_ID)).toBeNull()
    history().finish('undo', first!, { kind: 'done' })
    expect(history().busy).toBe(false)
    expect(history().begin('undo', EPISODE_ID)).not.toBeNull()
  })

  it("a deleted panel's steps are dropped, and a layout step goes on without it", () => {
    const moved = place(100)
    const onlyB: StripStep = { ...place(100), panelIds: [B], before: layout([A, B], { [A]: { x: 0, y: 0, width: 200 }, [B]: null }), after: layout([A, B], { [A]: { x: 0, y: 0, width: 200 }, [B]: { x: 0, y: 9, width: 200 } }) }
    const onlyA: StripStep = { ...place(100), before: layout([A, B], { [A]: null, [B]: { x: 0, y: 5, width: 200 } }), after: layout([A, B], { [A]: { x: 0, y: 7, width: 200 }, [B]: { x: 0, y: 5, width: 200 } }) }
    history().record(moved, 0)
    history().record(frame('bordered', 'borderless'), 10_000)
    history().record(onlyB, 20_000)
    history().record(onlyA, 30_000)
    history().dropPanel(A)
    expect(stack('undo').map((s) => s.kind)).toEqual(['place', 'place'])
    expect(stack('undo')[0]).toMatchObject({ before: layout([B], { [B]: null }), after: layout([B], { [B]: { x: 0, y: 400, width: 200 } }), panelIds: [] })
    expect(stack('undo')[1]).toMatchObject({ before: layout([B], { [B]: null }), panelIds: [B] })
  })

  it('a picked background drops only that episode background steps', () => {
    history().record({ kind: 'background', episodeId: EPISODE_ID, label: 'background', before: null, after: { kind: 'solid', color: '#000000' } }, 0)
    history().record(place(100), 10_000)
    history().dropBackground(EPISODE_ID)
    expect(stack('undo').map((s) => s.kind)).toEqual(['place'])
  })

  it('compares values without dialogue line ids or key order', () => {
    const line = { speakerId: null, kind: 'speech', text: 'Hi', placement: null, style: { bold: true, size: 2 }, tail: null }
    expect(canonical([{ id: 'dlg_1', ...line }])).toBe(canonical([{ ...line, style: { size: 2, bold: true }, id: 'dlg_2' }]))
    expect(canonical([{ id: 'dlg_1', ...line }])).not.toBe(canonical([{ id: 'dlg_1', ...line, text: 'Ho' }]))
  })
})
