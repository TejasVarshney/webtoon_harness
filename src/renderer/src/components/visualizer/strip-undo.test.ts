import { beforeEach, describe, expect, it } from 'vitest'
import type { DialogueLine, Panel, StripLayout } from '@shared/types'
import { PROJECT_ID as projectId } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { EPISODE_ID, episode, panel, panelVersion } from '../../test/panel-fixtures'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { flushBeforeStep, track, useStripHistoryStore, type StripStep } from '../../stores/strip-history-store'
import { stepStrip } from './strip-undo'

const A = 'pnl_00000000aa'
const B = 'pnl_00000000bb'

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId, activeEpisodeId: EPISODE_ID })
  usePanelsStore.setState({ ...initialPanelsState, projectId })
  useStripHistoryStore.getState().reset()
})

const history = () => useStripHistoryStore.getState()
const stack = (direction: 'undo' | 'redo') => history().episodes[EPISODE_ID]?.[direction] ?? []

/** The panels as main would list them for a layout. */
const panelsAt = (layout: StripLayout): Panel[] => layout.order.map((id) => panel({ id, placement: layout.placements[id] ?? null }))

const before: StripLayout = { order: [A, B], placements: { [A]: null, [B]: null } }
const after: StripLayout = { order: [B, A], placements: { [A]: { x: 0, y: 900, width: 200 }, [B]: { x: 0, y: 0, width: 440 } } }
const placeStep: StripStep = { kind: 'place', episodeId: EPISODE_ID, label: 'move', panelIds: [A], before, after }

/** A fake main whose strip is `strip`, which `panels:restoreLayout` replaces. */
function fakeStrip(start: StripLayout, opts: { restore?: () => unknown } = {}) {
  let strip = start
  const fake = installFakeApi({
    'episodes:list': () => [episode({ panelIds: strip.order })],
    'panels:list': () => panelsAt(strip),
    'panels:restoreLayout': (req: { layout: StripLayout }) => {
      if (opts.restore) return opts.restore()
      strip = req.layout
      return undefined
    }
  })
  return { ...fake, strip: () => strip }
}

const restores = (calls: { channel: string; req: unknown }[]) => calls.filter((c) => c.channel === 'panels:restoreLayout').map((c) => (c.req as { layout: StripLayout }).layout)

describe('stepStrip', () => {
  it('undoes a move by putting back the layout read before it, nulls and order included, and redoes it', async () => {
    const { calls, strip } = fakeStrip(after)
    history().record(placeStep, 0)
    await stepStrip('undo', EPISODE_ID)
    expect(restores(calls)).toEqual([before])
    expect(strip()).toEqual(before)
    expect(stack('undo')).toEqual([])
    expect(stack('redo')).toEqual([placeStep])
    await stepStrip('redo', EPISODE_ID)
    expect(strip()).toEqual(after)
    expect(stack('undo')).toEqual([placeStep])
  })

  it('writes nothing when the strip changed since, empties the history and says so', async () => {
    const changed: StripLayout = { ...after, placements: { ...after.placements, [B]: { x: 0, y: 10, width: 440 } } }
    const { calls } = fakeStrip(changed)
    history().record(placeStep, 0)
    await stepStrip('undo', EPISODE_ID)
    expect(restores(calls)).toEqual([])
    expect(stack('undo')).toEqual([])
    expect(history().notice).toEqual({ episodeId: EPISODE_ID, text: "Can't undo: the strip changed since." })
  })

  it('a step the service refuses stays, and the error shows', async () => {
    fakeStrip(after, {
      restore: () => {
        throw new Error('disk full')
      }
    })
    history().record(placeStep, 0)
    await stepStrip('undo', EPISODE_ID)
    expect(stack('undo')).toEqual([placeStep])
    expect(history().notice).toEqual({ episodeId: EPISODE_ID, text: 'disk full' })
  })

  it('waits for the saves still on their way, then runs one step at a time', async () => {
    const { calls } = fakeStrip(after)
    history().record(placeStep, 0)
    let land!: () => void
    void track(new Promise<void>((resolve) => (land = resolve)))
    const first = stepStrip('undo', EPISODE_ID)
    const second = stepStrip('undo', EPISODE_ID)
    await Promise.resolve()
    expect(calls).toEqual([])
    expect(history().busy).toBe(true)
    land()
    await Promise.all([first, second])
    expect(restores(calls)).toHaveLength(1)
    expect(history().busy).toBe(false)
  })

  it('a change whose save is still on its way when the key is pressed is the one undone', async () => {
    const { calls } = fakeStrip(after)
    let land!: () => void
    void track(new Promise<void>((resolve) => (land = resolve)).then(() => history().record(placeStep, 0)))
    const undoing = stepStrip('undo', EPISODE_ID)
    land()
    await undoing
    expect(restores(calls)).toEqual([before])
    expect(stack('redo')).toEqual([placeStep])
  })

  it('sends the edits still waiting (a run of nudges) before it waits, so it undoes them', async () => {
    const { calls } = fakeStrip(after)
    const stop = flushBeforeStep(() => void track(Promise.resolve().then(() => history().record(placeStep, 0))))
    try {
      await stepStrip('undo', EPISODE_ID)
    } finally {
      stop()
    }
    expect(restores(calls)).toEqual([before])
  })

  it('undoes a lettering change exactly: every look field is sent, null included, and no line id', async () => {
    const line = (text: string, o: Partial<DialogueLine> = {}): DialogueLine => ({ id: 'dlg_0000000001', speakerId: null, kind: 'speech', text, placement: null, style: null, tail: null, ...o })
    const was = [line('Hi'), line('There', { id: 'dlg_0000000002', placement: { x: 0.2, y: 0.3 }, style: { bold: true }, tail: 'none' })]
    const now = [line('Hi', { id: 'dlg_0000000009', placement: { x: 0.5, y: 0.5 } })]
    const stored = panel({ id: A, dialogue: now })
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [stored] } })
    const { calls } = installFakeApi({
      'panels:get': () => stored,
      'panels:update': () => ({ panel: { ...stored, dialogue: was }, warnings: [] }),
      'panels:list': () => [{ ...stored, dialogue: was }]
    })
    history().record({ kind: 'fields', episodeId: EPISODE_ID, panelId: A, label: 'lettering', before: { dialogue: was }, after: { dialogue: now.map((l) => ({ ...l, id: 'dlg_0000000005' })) } }, 0)
    await stepStrip('undo', EPISODE_ID)
    const update = calls.find((c) => c.channel === 'panels:update')!.req as { patch: { dialogue: unknown[] } }
    expect(update.patch).toEqual({
      dialogue: [
        { speakerId: null, kind: 'speech', text: 'Hi', placement: null, style: null, tail: null },
        { speakerId: null, kind: 'speech', text: 'There', placement: { x: 0.2, y: 0.3 }, style: { bold: true }, tail: 'none' }
      ]
    })
    expect(stack('redo')).toHaveLength(1)
  })

  it('undoes a crop by making the old version current and putting the shape back', async () => {
    const cropped = panelVersion({ id: 'ver_0000000002', source: 'crop' })
    const stored = panel({ id: A, aspect: '1:1', versions: [panelVersion(), cropped], currentVersionId: cropped.id })
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [stored] } })
    const reverted = { ...stored, currentVersionId: 'ver_0000000001' }
    const { calls } = installFakeApi({
      'panels:get': () => stored,
      'panels:revert': () => reverted,
      'panels:update': () => ({ panel: { ...reverted, aspect: '3:4' }, warnings: [] }),
      'panels:list': () => [{ ...reverted, aspect: '3:4' }]
    })
    history().record({ kind: 'picture', episodeId: EPISODE_ID, panelId: A, label: 'crop', before: { versionId: 'ver_0000000001', aspect: '3:4' }, after: { versionId: cropped.id, aspect: '1:1' } }, 0)
    await stepStrip('undo', EPISODE_ID)
    expect(calls.filter((c) => c.channel !== 'panels:list').map((c) => [c.channel, c.req])).toEqual([
      ['panels:get', { projectId, panelId: A }],
      ['panels:revert', { projectId, panelId: A, versionId: 'ver_0000000001' }],
      ['panels:update', { projectId, panelId: A, patch: { aspect: '3:4' } }]
    ])
  })

  it("a step for a panel that left the store is stale", async () => {
    const { calls } = installFakeApi({})
    history().record({ kind: 'fields', episodeId: EPISODE_ID, panelId: A, label: 'frame', before: { frame: 'bordered' }, after: { frame: 'borderless' } }, 0)
    await stepStrip('undo', EPISODE_ID)
    expect(calls).toEqual([])
    expect(history().notice?.text).toBe("Can't undo: the strip changed since.")
  })

  it('undoes a background change when the strip still shows what it left', async () => {
    const solid = { kind: 'solid' as const, color: '#112233' }
    const { calls } = installFakeApi({
      'episodes:list': () => [episode({ background: solid })],
      'episodes:setBackground': () => episode(),
      'panels:list': () => []
    })
    history().record({ kind: 'background', episodeId: EPISODE_ID, label: 'background', before: null, after: solid }, 0)
    await stepStrip('undo', EPISODE_ID)
    expect(calls.find((c) => c.channel === 'episodes:setBackground')!.req).toEqual({ projectId, episodeId: EPISODE_ID, background: null })
    expect(stack('redo')).toHaveLength(1)
  })
})
