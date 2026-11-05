import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { DialogueLine, Panel, PanelPatch } from '@shared/types'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { PROJECT_ID as P } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { EPISODE_ID, panel } from '../../test/panel-fixtures'
import { editLine, identityOf, toDrafts } from './dialogue-edits'
import { useDialogueSaver } from './use-dialogue-saver'

// Each test has a panel of its own: the savers keep what the last save of a panel returned until the store catches up.
let n = 0
let A: string
const hello: DialogueLine = { id: 'dlg_0000000001', speakerId: null, kind: 'narration', text: 'Hello.', placement: null }
const night: DialogueLine = { id: 'dlg_0000000002', speakerId: null, kind: 'narration', text: 'Night fell.', placement: { x: 0.5, y: 0.8 } }

/** The panel as the main process holds it. */
let stored: Panel

beforeEach(() => {
  n += 1
  A = `pnl_000000sv${String(n).padStart(2, '0')}`
  stored = panel({ id: A, dialogue: [hello, night] })
  useAppStore.setState({ ...initialAppState, projectId: P, activeEpisodeId: EPISODE_ID })
  usePanelsStore.setState({ ...initialPanelsState, projectId: P, episodesLoaded: true, panelsByEpisode: { [EPISODE_ID]: [stored] } })
})

/** Runs a save inside act, and resolves to its outcome. */
async function run<T>(task: () => Promise<T>): Promise<T> {
  let out!: T
  await act(async () => {
    out = await task()
  })
  return out
}

const updates = (calls: { channel: string; req: unknown }[]): PanelPatch[] =>
  calls.filter((c) => c.channel === 'panels:update').map((c) => (c.req as { patch: PanelPatch }).patch)

describe('useDialogueSaver', () => {
  it('builds a save from a second saver of the panel on what the first one saved, even when the store has not reloaded (Ruling 3)', async () => {
    const before = stored
    let saves = 0
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { calls } = installFakeApi({
      'panels:update': async (req: { patch: PanelPatch }) => {
        if (saves === 0) await gate
        saves += 1
        // Like the service: new ids, and a newer updatedAt.
        const dialogue = (req.patch.dialogue ?? []).map((line, i) => ({ ...line, id: `dlg_00000${saves}000${i}`, placement: line.placement ?? null }))
        stored = { ...stored, dialogue, updatedAt: `2026-10-21T10:00:0${saves}.000Z` }
        return { panel: stored, warnings: [] }
      },
      // The reload after each save is withheld: it brings back the panel as it was before them (a load that another
      // one superseded leaves the store like this).
      'panels:list': () => [before]
    })
    const stage = renderHook(() => useDialogueSaver(A))
    const lines = renderHook(() => useDialogueSaver(A))
    const seen: DialogueLine[][] = []
    let first: Promise<unknown> = Promise.resolve()
    let second: Promise<unknown> = Promise.resolve()
    act(() => {
      first = stage.result.current.save((current) => editLine(current, 0, identityOf(hello), { text: 'Hi.' }))
      second = lines.result.current.save((current) => {
        seen.push(current)
        return editLine(current, 1, identityOf(night), { text: 'Day broke.' })
      })
    })
    await act(async () => undefined)
    // One at a time: the second is not built while the first is still going.
    expect(seen).toEqual([])
    expect(updates(calls)).toHaveLength(1)

    await act(async () => {
      release()
      await Promise.all([first, second])
    })
    expect(usePanelsStore.getState().panelsByEpisode[EPISODE_ID][0].dialogue[0].text).toBe('Hello.')
    expect(seen[0].map((line) => line.text)).toEqual(['Hi.', 'Night fell.'])
    expect(updates(calls)[1]).toEqual({ dialogue: [{ ...toDrafts([hello])[0], text: 'Hi.' }, { ...toDrafts([night])[0], text: 'Day broke.' }] })
  })

  it('builds from the store again once it is as new as the last save, so an agent edit after it is kept', async () => {
    let saves = 0
    const { calls } = installFakeApi({
      'panels:update': (req: { patch: PanelPatch }) => {
        saves += 1
        stored = { ...stored, dialogue: (req.patch.dialogue ?? []).map((line, i) => ({ ...line, id: `dlg_00000${saves}000${i}`, placement: line.placement ?? null })), updatedAt: `2026-10-21T10:00:0${saves}.000Z` }
        return { panel: stored, warnings: [] }
      },
      'panels:list': () => [stored]
    })
    const saver = renderHook(() => useDialogueSaver(A))
    await run(() => saver.result.current.save((current) => editLine(current, 0, identityOf(hello), { text: 'Hi.' })))
    // The agent rewrites line 1 after the save, and the store has it.
    const agent = { ...stored, dialogue: [stored.dialogue[0], { ...stored.dialogue[1], text: 'Dawn.' }], updatedAt: '2026-10-21T10:00:05.000Z' }
    stored = agent
    act(() => usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [agent] } }))
    const seen: string[] = []
    await run(() =>
      saver.result.current.save((current) => {
        seen.push(...current.map((line) => line.text))
        return null
      })
    )
    expect(seen).toEqual(['Hi.', 'Dawn.'])
    expect(updates(calls)).toHaveLength(1)
  })

  it('shows a conflict and a refused save to every saver of the panel, until the next save or a clear', async () => {
    let refuse = true
    installFakeApi({
      'panels:update': () => {
        if (refuse) throw new Error('Dialogue is too long')
        return { panel: stored, warnings: [] }
      },
      'panels:list': () => [stored]
    })
    const stage = renderHook(() => useDialogueSaver(A))
    const lines = renderHook(() => useDialogueSaver(A))
    await run(() => stage.result.current.save(() => null))
    expect(lines.result.current.conflict).toBe(true)
    expect(stage.result.current.conflict).toBe(true)
    const reported = lines.result.current.reported

    expect(await run(() => lines.result.current.save((current) => editLine(current, 0, identityOf(hello), { text: 'Hi.' })))).toBe('refused')
    expect(stage.result.current.conflict).toBe(false)
    expect(stage.result.current.error).toBe('Dialogue is too long')
    expect(lines.result.current.reported).toBeGreaterThan(reported)
    act(() => stage.result.current.clear())
    expect(lines.result.current.error).toBeNull()

    refuse = false
    await run(() => stage.result.current.save(() => null))
    expect(await run(() => stage.result.current.save((current) => editLine(current, 0, identityOf(hello), { text: 'Hi.' })))).toBe('saved')
    expect(lines.result.current.conflict).toBe(false)
  })

  it('forgets the messages once nothing shows them', async () => {
    installFakeApi({})
    const first = renderHook(() => useDialogueSaver(A))
    await run(() => first.result.current.save(() => null))
    expect(first.result.current.conflict).toBe(true)
    first.unmount()
    const again = renderHook(() => useDialogueSaver(A))
    expect(again.result.current.conflict).toBe(false)
  })

  it('saves nothing for a panel that left the store (R2)', async () => {
    const { calls } = installFakeApi({})
    const saver = renderHook(() => useDialogueSaver(A))
    act(() => usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [] } }))
    expect(await run(() => saver.result.current.save((current) => toDrafts(current)))).toBe('skipped')
    expect(calls).toEqual([])
  })
})
