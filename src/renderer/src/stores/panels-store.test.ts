import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Episode, Panel } from '@shared/types'
import { startEventSync } from '../events'
import { PROJECT_ID as projectId } from '../test/character-fixtures'
import { installFakeApi } from '../test/fake-api'
import { EPISODE_ID, episode, panel, panelVersion } from '../test/panel-fixtures'
import { initialAppState, useAppStore } from './app-store'
import { initialPanelsState, usePanelsStore } from './panels-store'

let stop: (() => void) | undefined
beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId })
  usePanelsStore.setState({ ...initialPanelsState })
})
afterEach(() => stop?.())

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const second = episode({ id: 'epi_0000000002', number: 2, title: 'Episode 2' })
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('usePanelsStore', () => {
  describe('loadEpisodes', () => {
    it('selects the first episode when none is active, and loads its panels', async () => {
      const p = panel()
      const { calls } = installFakeApi({ 'episodes:list': () => [episode({ panelIds: [p.id] }), second], 'panels:list': () => [p] })
      await usePanelsStore.getState().loadEpisodes()
      expect(useAppStore.getState().activeEpisodeId).toBe(EPISODE_ID)
      expect(usePanelsStore.getState()).toMatchObject({ projectId, episodesLoaded: true, error: null })
      expect(usePanelsStore.getState().episodes.map((e) => e.id)).toEqual([EPISODE_ID, 'epi_0000000002'])
      expect(usePanelsStore.getState().panelsByEpisode).toEqual({ [EPISODE_ID]: [p] })
      expect(calls.map((c) => c.channel)).toEqual(['episodes:list', 'panels:list'])
      expect(calls[1].req).toEqual({ projectId, episodeId: EPISODE_ID })
    })

    it('keeps the active episode when it is still there, and replaces one that is gone', async () => {
      installFakeApi({ 'episodes:list': () => [episode(), second], 'panels:list': () => [] })
      useAppStore.setState({ activeEpisodeId: 'epi_0000000002' })
      await usePanelsStore.getState().loadEpisodes()
      expect(useAppStore.getState().activeEpisodeId).toBe('epi_0000000002')

      useAppStore.setState({ activeEpisodeId: 'epi_ffffffffff' })
      await usePanelsStore.getState().loadEpisodes()
      expect(useAppStore.getState().activeEpisodeId).toBe(EPISODE_ID)
    })

    it('does nothing without a project', async () => {
      useAppStore.setState({ projectId: null })
      const { calls } = installFakeApi({})
      await usePanelsStore.getState().loadEpisodes()
      expect(calls).toEqual([])
      expect(usePanelsStore.getState()).toMatchObject(initialPanelsState)
    })

    it('never rejects: a failure lands in `error` and keeps the previous list', async () => {
      let fail = false
      installFakeApi({
        'episodes:list': () => {
          if (fail) throw new Error('disk on fire')
          return [episode()]
        },
        'panels:list': () => []
      })
      await usePanelsStore.getState().loadEpisodes()
      fail = true
      await expect(usePanelsStore.getState().loadEpisodes()).resolves.toBeUndefined()
      expect(usePanelsStore.getState().error).toBe('disk on fire')
      expect(usePanelsStore.getState().episodes).toHaveLength(1)
      fail = false
      await usePanelsStore.getState().loadEpisodes()
      expect(usePanelsStore.getState().error).toBeNull()
    })

    it('applies only the latest response, even when an older one lands last', async () => {
      const first = deferred<Episode[]>()
      const latest = deferred<Episode[]>()
      const queue = [first, latest]
      installFakeApi({ 'episodes:list': () => queue.shift()!.promise, 'panels:list': () => [] })
      const a = usePanelsStore.getState().loadEpisodes()
      const b = usePanelsStore.getState().loadEpisodes()
      latest.resolve([episode({ title: 'New' })])
      await b
      first.resolve([episode({ title: 'Old' })])
      await a
      expect(usePanelsStore.getState().episodes[0].title).toBe('New')
    })

    it('drops the previous project: its panels never show under another project', async () => {
      installFakeApi({ 'episodes:list': () => [episode()], 'panels:list': () => [panel()] })
      await usePanelsStore.getState().loadEpisodes()
      expect(usePanelsStore.getState().panelsByEpisode[EPISODE_ID]).toHaveLength(1)

      const slow = deferred<Episode[]>()
      installFakeApi({ 'episodes:list': () => slow.promise, 'panels:list': () => [] })
      useAppStore.setState({ projectId: 'prj_bbbbbbbbbb', activeEpisodeId: null })
      const pending = usePanelsStore.getState().loadEpisodes()
      expect(usePanelsStore.getState()).toMatchObject({ projectId: 'prj_bbbbbbbbbb', episodes: [], panelsByEpisode: {} })
      // The user switches back before the answer arrives: it belongs to a project that is no longer open.
      useAppStore.setState({ projectId })
      slow.resolve([episode({ id: 'epi_0000000bbb' })])
      await pending
      expect(usePanelsStore.getState().episodes.map((e) => e.id)).not.toContain('epi_0000000bbb')
    })
  })

  describe('load', () => {
    it('keeps each episode apart', async () => {
      const a = panel({ id: 'pnl_00000000aa' })
      const b = panel({ id: 'pnl_00000000bb', episodeId: 'epi_0000000002' })
      installFakeApi({ 'panels:list': (req: { episodeId: string }) => (req.episodeId === EPISODE_ID ? [a] : [b]) })
      await usePanelsStore.getState().load(EPISODE_ID)
      await usePanelsStore.getState().load('epi_0000000002')
      expect(usePanelsStore.getState().panelsByEpisode).toEqual({ [EPISODE_ID]: [a], epi_0000000002: [b] })
    })

    it('applies only the latest response per episode', async () => {
      const first = deferred<Panel[]>()
      const latest = deferred<Panel[]>()
      const queue = [first, latest]
      installFakeApi({ 'panels:list': () => queue.shift()!.promise })
      const a = usePanelsStore.getState().load(EPISODE_ID)
      const b = usePanelsStore.getState().load(EPISODE_ID)
      latest.resolve([panel({ description: 'new' })])
      await b
      first.resolve([panel({ description: 'old' })])
      await a
      expect(usePanelsStore.getState().panelsByEpisode[EPISODE_ID][0].description).toBe('new')
    })

    it('records a failure and leaves the previous panels', async () => {
      let fail = false
      installFakeApi({
        'panels:list': () => {
          if (fail) throw new Error('Unknown episode: epi_0000000001')
          return [panel()]
        }
      })
      await usePanelsStore.getState().load(EPISODE_ID)
      fail = true
      await usePanelsStore.getState().load(EPISODE_ID)
      expect(usePanelsStore.getState().error).toBe('Unknown episode: epi_0000000001')
      expect(usePanelsStore.getState().panelsByEpisode[EPISODE_ID]).toHaveLength(1)
    })
  })

  describe('actions', () => {
    it('selectEpisode makes the episode active, clears the panel selection and loads it', async () => {
      const b = panel({ id: 'pnl_00000000bb', episodeId: 'epi_0000000002' })
      const { calls } = installFakeApi({ 'panels:list': () => [b] })
      useAppStore.setState({ activeEpisodeId: EPISODE_ID, selectedPanelId: 'pnl_0000000001' })
      usePanelsStore.getState().selectEpisode('epi_0000000002')
      expect(useAppStore.getState()).toMatchObject({ activeEpisodeId: 'epi_0000000002', selectedPanelId: null })
      await flush()
      expect(calls).toEqual([{ channel: 'panels:list', req: { projectId, episodeId: 'epi_0000000002' } }])
      expect(usePanelsStore.getState().panelsByEpisode.epi_0000000002).toEqual([b])
    })

    it('createEpisode adds it, makes it active and shows it', async () => {
      const { calls } = installFakeApi({
        'episodes:create': () => second,
        'episodes:list': () => [episode(), second],
        'panels:list': () => []
      })
      useAppStore.setState({ activeEpisodeId: EPISODE_ID })
      const made = await usePanelsStore.getState().createEpisode('Episode 2')
      expect(made).toEqual(second)
      expect(calls[0]).toEqual({ channel: 'episodes:create', req: { projectId, title: 'Episode 2' } })
      expect(useAppStore.getState().activeEpisodeId).toBe('epi_0000000002')
      expect(usePanelsStore.getState().episodes.map((e) => e.id)).toEqual([EPISODE_ID, 'epi_0000000002'])
    })

    it('updateEpisode renames and reloads the list', async () => {
      const renamed = episode({ title: 'Pilot' })
      const { calls } = installFakeApi({ 'episodes:update': () => renamed, 'episodes:list': () => [renamed], 'panels:list': () => [] })
      useAppStore.setState({ activeEpisodeId: EPISODE_ID })
      await usePanelsStore.getState().updateEpisode(EPISODE_ID, { title: 'Pilot' })
      expect(calls[0]).toEqual({ channel: 'episodes:update', req: { projectId, episodeId: EPISODE_ID, patch: { title: 'Pilot' } } })
      expect(usePanelsStore.getState().episodes[0].title).toBe('Pilot')
    })

    it('createPanel sends the draft and reloads that episode', async () => {
      const made = panel({ id: 'pnl_0000000009', versions: [], currentVersionId: null })
      const { calls } = installFakeApi({ 'panels:create': () => ({ panel: made, warnings: ['w'] }), 'panels:list': () => [made] })
      const draft = { episodeId: EPISODE_ID, description: 'd', setting: 's', shot: 'medium' as const, characters: [], dialogue: [] }
      const out = await usePanelsStore.getState().createPanel(draft, true)
      expect(out).toEqual({ panel: made, warnings: ['w'] })
      expect(calls[0]).toEqual({ channel: 'panels:create', req: { projectId, draft, generate: true } })
      expect(usePanelsStore.getState().panelsByEpisode[EPISODE_ID]).toEqual([made])
    })

    it('updatePanel sends the patch and reloads the panel`s episode', async () => {
      const edited = panel({ description: 'edited' })
      const { calls } = installFakeApi({ 'panels:update': () => ({ panel: edited, warnings: [] }), 'panels:list': () => [edited] })
      await usePanelsStore.getState().updatePanel(edited.id, { description: 'edited' })
      expect(calls[0]).toEqual({ channel: 'panels:update', req: { projectId, panelId: edited.id, patch: { description: 'edited' } } })
      expect(usePanelsStore.getState().panelsByEpisode[EPISODE_ID]).toEqual([edited])
    })

    it('generatePanel, movePanel, revertPanel and uploadPanelImage call their channels and reload', async () => {
      const a = panel({ id: 'pnl_00000000aa' })
      const b = panel({ id: 'pnl_00000000bb' })
      const version = panelVersion({ id: 'ver_0000000007', source: 'upload' })
      const { calls } = installFakeApi({
        'panels:generate': () => undefined,
        'panels:move': () => undefined,
        'panels:revert': () => a,
        'panels:uploadImage': () => version,
        'panels:list': () => [a, b]
      })
      usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [a, b] } })
      await usePanelsStore.getState().generatePanel(a.id)
      await usePanelsStore.getState().movePanel(b.id, 0)
      await usePanelsStore.getState().revertPanel(a.id, 'ver_0000000001')
      await expect(usePanelsStore.getState().uploadPanelImage(a.id)).resolves.toEqual(version)
      expect(calls.filter((c) => c.channel !== 'panels:list').map((c) => [c.channel, c.req])).toEqual([
        ['panels:generate', { projectId, panelId: a.id }],
        ['panels:move', { projectId, panelId: b.id, toIndex: 0 }],
        ['panels:revert', { projectId, panelId: a.id, versionId: 'ver_0000000001' }],
        ['panels:uploadImage', { projectId, panelId: a.id }]
      ])
      expect(calls.filter((c) => c.channel === 'panels:list').length).toBeGreaterThanOrEqual(4)
    })

    it('uploadPanelImage does not reload when the file dialog was cancelled', async () => {
      const a = panel()
      const { calls } = installFakeApi({ 'panels:uploadImage': () => null })
      usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [a] } })
      await expect(usePanelsStore.getState().uploadPanelImage(a.id)).resolves.toBeNull()
      expect(calls.map((c) => c.channel)).toEqual(['panels:uploadImage'])
    })

    it('deletePanel removes it from the strip and from the selection', async () => {
      const a = panel({ id: 'pnl_00000000aa' })
      const b = panel({ id: 'pnl_00000000bb' })
      const { calls } = installFakeApi({ 'panels:delete': () => undefined, 'panels:list': () => [b] })
      usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [a, b] } })
      useAppStore.setState({ selectedPanelId: a.id })
      await usePanelsStore.getState().deletePanel(a.id)
      expect(calls[0]).toEqual({ channel: 'panels:delete', req: { projectId, panelId: a.id } })
      expect(usePanelsStore.getState().panelsByEpisode[EPISODE_ID]).toEqual([b])
      expect(useAppStore.getState().selectedPanelId).toBeNull()
    })

    it('deletePanel leaves another panel selected', async () => {
      const a = panel({ id: 'pnl_00000000aa' })
      const b = panel({ id: 'pnl_00000000bb' })
      installFakeApi({ 'panels:delete': () => undefined, 'panels:list': () => [b] })
      usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [a, b] } })
      useAppStore.setState({ selectedPanelId: b.id })
      await usePanelsStore.getState().deletePanel(a.id)
      expect(useAppStore.getState().selectedPanelId).toBe(b.id)
    })

    it('a rejected action rejects, so the caller can show it', async () => {
      installFakeApi({
        'panels:delete': () => {
          throw new Error('Unknown panel: pnl_0000000001')
        }
      })
      await expect(usePanelsStore.getState().deletePanel('pnl_0000000001')).rejects.toThrow('Unknown panel: pnl_0000000001')
    })

    it('an action with no project open rejects', async () => {
      useAppStore.setState({ projectId: null })
      installFakeApi({})
      await expect(usePanelsStore.getState().generatePanel('pnl_0000000001')).rejects.toThrow('No project is open')
    })
  })

  describe('events', () => {
    it('reloads the active episode on panel.changed', async () => {
      const first = panel({ description: 'before' })
      let current = [first]
      const api = installFakeApi({ 'episodes:list': () => [episode()], 'panels:list': () => current })
      stop = startEventSync()
      await usePanelsStore.getState().loadEpisodes()
      current = [panel({ description: 'after' })]
      api.emit({ type: 'panel.changed', projectId, panelId: first.id })
      await flush()
      expect(usePanelsStore.getState().panelsByEpisode[EPISODE_ID][0].description).toBe('after')
    })

    it('reloads the episodes and their panels on episode.changed', async () => {
      let episodes = [episode()]
      let panels: Panel[] = []
      const api = installFakeApi({ 'episodes:list': () => episodes, 'panels:list': () => panels })
      stop = startEventSync()
      await usePanelsStore.getState().loadEpisodes()
      episodes = [episode(), second]
      panels = [panel()]
      api.emit({ type: 'episode.changed', projectId, episodeId: second.id })
      await flush()
      expect(usePanelsStore.getState().episodes).toHaveLength(2)
      expect(usePanelsStore.getState().panelsByEpisode[EPISODE_ID]).toHaveLength(1)
    })

    it('ignores events of another project and panel events before an episode is open', async () => {
      const api = installFakeApi({ 'episodes:list': () => [episode()], 'panels:list': () => [panel()] })
      stop = startEventSync()
      api.emit({ type: 'panel.changed', projectId: 'prj_bbbbbbbbbb', panelId: 'pnl_0000000001' })
      api.emit({ type: 'episode.changed', projectId: 'prj_bbbbbbbbbb', episodeId: EPISODE_ID })
      api.emit({ type: 'panel.changed', projectId, panelId: 'pnl_0000000001' })
      await flush()
      expect(api.calls).toEqual([])
    })
  })
})
