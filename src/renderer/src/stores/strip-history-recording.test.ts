import { beforeEach, describe, expect, it } from 'vitest'
import type { DialogueLine, Episode, StripLayout } from '@shared/types'
import { queuePanelSave } from '../components/panel-editor/panel-save-queue'
import { PROJECT_ID as projectId } from '../test/character-fixtures'
import { installFakeApi } from '../test/fake-api'
import { EPISODE_ID, episode, panel, panelVersion } from '../test/panel-fixtures'
import { initialAppState, useAppStore } from './app-store'
import { initialPanelsState, usePanelsStore } from './panels-store'
import { useStripHistoryStore } from './strip-history-store'

// The user's saves record their steps where they pass; nothing else does.

const A = 'pnl_00000000aa'
const B = 'pnl_00000000bb'

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId, activeEpisodeId: EPISODE_ID })
  usePanelsStore.setState({ ...initialPanelsState, projectId })
  useStripHistoryStore.getState().reset()
})

const steps = () => useStripHistoryStore.getState().episodes[EPISODE_ID]?.undo ?? []

describe('recording the strip history', () => {
  it('placePanels records one step from the layouts main read and wrote, named by its caller', async () => {
    const before: StripLayout = { order: [A, B], placements: { [A]: null, [B]: null } }
    const after: StripLayout = { order: [B, A], placements: { [A]: { x: 0, y: 900, width: 200 }, [B]: { x: 0, y: 0, width: 440 } } }
    installFakeApi({ 'panels:place': () => ({ before, after }), 'panels:list': () => [] })
    await usePanelsStore.getState().placePanels(EPISODE_ID, [{ panelId: A, placement: { x: 0, y: 900, width: 200 } }], 'layout')
    expect(steps()).toEqual([{ kind: 'place', episodeId: EPISODE_ID, label: 'layout', panelIds: [A], before, after }])
  })

  it('a field save records the strip fields it changed, from the panel it was built from', async () => {
    const line: DialogueLine = { id: 'dlg_0000000001', speakerId: null, kind: 'speech', text: 'Hi', placement: null, style: null, tail: null }
    const was = panel({ id: A, dialogue: [line] })
    const moved = { ...was, dialogue: [{ ...line, id: 'dlg_0000000002', placement: { x: 0.4, y: 0.6 } }] }
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [was] } })
    installFakeApi({ 'panels:update': () => ({ panel: moved, warnings: [] }), 'panels:list': () => [moved] })
    await queuePanelSave(A, () => [{ dialogue: moved.dialogue }], 'dialogue')
    expect(steps()).toEqual([{ kind: 'fields', episodeId: EPISODE_ID, panelId: A, label: 'lettering', before: { dialogue: was.dialogue }, after: { dialogue: moved.dialogue } }])
  })

  it('a save of fields the strip does not draw records nothing', async () => {
    const was = panel({ id: A })
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [was] } })
    installFakeApi({ 'panels:update': () => ({ panel: { ...was, description: 'new' }, warnings: [] }), 'panels:list': () => [was] })
    await queuePanelSave(A, () => [{ description: 'new' }], 'description')
    expect(steps()).toEqual([])
  })

  it('a background save records the background before it: the last save answer while the list lags', async () => {
    const red = { kind: 'solid' as const, color: '#ff0000' }
    const blue = { kind: 'solid' as const, color: '#0000ff' }
    let stored: Episode = episode({ updatedAt: '2026-11-12T10:00:00.000Z' })
    usePanelsStore.setState({ episodes: [stored] })
    let n = 0
    installFakeApi({
      'episodes:setBackground': (req: { background: Episode['background'] }) => {
        stored = { ...stored, background: req.background, updatedAt: `2026-11-12T10:00:0${++n}.000Z` }
        return stored
      },
      // The list never catches up in this test.
      'episodes:list': () => [episode({ updatedAt: '2026-11-12T10:00:00.000Z' })],
      'panels:list': () => []
    })
    await Promise.all([usePanelsStore.getState().setBackground(EPISODE_ID, red), usePanelsStore.getState().setBackground(EPISODE_ID, blue)])
    // The two land within the merge window, so they are one step from nothing to blue.
    expect(steps()).toEqual([{ kind: 'background', episodeId: EPISODE_ID, label: 'background', before: null, after: blue }])
  })

  it('picking a background image is not recorded, and ends the episode background steps', async () => {
    useStripHistoryStore.getState().record({ kind: 'background', episodeId: EPISODE_ID, label: 'background', before: null, after: { kind: 'solid', color: '#000000' } })
    const picked = episode({ backgroundImage: `episode-backgrounds/${EPISODE_ID}/a.png`, background: { kind: 'image', path: `episode-backgrounds/${EPISODE_ID}/a.png`, fit: 'width', opacity: 1, color: '#ffffff' } })
    installFakeApi({ 'episodes:pickBackgroundImage': () => picked, 'episodes:list': () => [picked], 'panels:list': () => [] })
    await usePanelsStore.getState().pickBackgroundImage(EPISODE_ID)
    expect(steps()).toEqual([])
  })

  it('a crop records the version and the shape before and after; a panel with no picture before records nothing', async () => {
    const shown = panel({ id: A, aspect: '3:4' })
    const blank = panel({ id: B, versions: [], currentVersionId: null })
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [shown, blank] } })
    const crop = panelVersion({ id: 'ver_0000000002', source: 'crop' })
    const upload = panelVersion({ id: 'ver_0000000003', source: 'upload' })
    installFakeApi({ 'panels:crop': () => crop, 'panels:uploadImage': () => upload, 'panels:list': () => [shown, blank] })
    await usePanelsStore.getState().cropPanelImage(A, shown.currentVersionId!, { x: 0, y: 0, width: 1, height: 1 }, '1:1')
    await usePanelsStore.getState().uploadPanelImage(B)
    expect(steps()).toEqual([{ kind: 'picture', episodeId: EPISODE_ID, panelId: A, label: 'crop', before: { versionId: shown.currentVersionId, aspect: '3:4' }, after: { versionId: crop.id, aspect: '1:1' } }])
  })

  it('picking a version records a picture step', async () => {
    const two = panelVersion({ id: 'ver_0000000002' })
    const shown = panel({ id: A, versions: [panelVersion(), two], currentVersionId: two.id })
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [shown] } })
    installFakeApi({ 'panels:revert': () => ({ ...shown, currentVersionId: 'ver_0000000001' }), 'panels:list': () => [shown] })
    await usePanelsStore.getState().revertPanel(A, 'ver_0000000001')
    expect(steps()).toEqual([{ kind: 'picture', episodeId: EPISODE_ID, panelId: A, label: 'picture', before: { versionId: two.id, aspect: shown.aspect }, after: { versionId: 'ver_0000000001', aspect: shown.aspect } }])
  })

  it('deleting a panel drops its steps', async () => {
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [panel({ id: A })] } })
    useStripHistoryStore.getState().record({ kind: 'fields', episodeId: EPISODE_ID, panelId: A, label: 'frame', before: { frame: 'bordered' }, after: { frame: 'borderless' } })
    installFakeApi({ 'panels:delete': () => undefined, 'panels:list': () => [] })
    await usePanelsStore.getState().deletePanel(A)
    expect(steps()).toEqual([])
  })
})
