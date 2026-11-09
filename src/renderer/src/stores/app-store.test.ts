import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectMeta } from '@shared/types'
import { usePanelsStore } from './panels-store'
import { initialAppState, startActiveContextSync, useAppStore } from './app-store'
import { installFakeApi } from '../test/fake-api'

const P = 'prj_aaaaaaaaaa'
const E = 'epi_0000000001'
const meta = { id: P, title: 'Moon' } as unknown as ProjectMeta

let stop: (() => void) | null = null
beforeEach(() => {
  useAppStore.setState({ ...initialAppState })
})
afterEach(() => {
  stop?.()
  stop = null
})

describe('loadProjects and closeProject', () => {
  const second = { id: 'prj_bbbbbbbbbb', title: 'Sun' } as unknown as ProjectMeta

  it('loadProjects lists projects and opens none', async () => {
    const { calls } = installFakeApi({ 'projects:list': () => ({ projects: [meta, second], problems: [] }) })
    await useAppStore.getState().loadProjects()
    expect(useAppStore.getState().projects).toHaveLength(2)
    expect(useAppStore.getState().projectId).toBeNull()
    expect(calls.some((c) => c.channel === 'projects:open')).toBe(false)
  })

  it('closeProject empties the open project, its problems, sessions and the selection', () => {
    useAppStore.setState({
      projects: [meta],
      projectId: P,
      problems: [{ path: 'panels/pnl_0000000bad.json', message: 'Unexpected token' }],
      sessions: [{ id: 'ses_0000000001' }] as never,
      sessionId: 'ses_0000000001',
      selectedPanelId: 'pnl_0000000001',
      activeEpisodeId: E
    })
    useAppStore.getState().closeProject()
    const s = useAppStore.getState()
    expect([s.projectId, s.problems, s.sessions, s.sessionId, s.selectedPanelId, s.activeEpisodeId]).toEqual([null, [], [], null, null, null])
    expect(s.projects).toEqual([meta])
  })
})

describe('panel selection', () => {
  const state = (): ReturnType<typeof useAppStore.getState> => useAppStore.getState()

  it('a plain click replaces the selection', () => {
    state().selectPanel('a')
    state().selectPanel('b')
    expect(state().selectedPanelIds).toEqual(['b'])
    expect(state().selectedPanelId).toBe('b')
    expect(state().shiftSelecting).toBe(false)
  })

  it('shift adds the selected panel and the clicked one', () => {
    state().selectPanel('a')
    state().togglePanelSelection('b')
    expect(state().selectedPanelIds).toEqual(['a', 'b'])
    expect(state().selectedPanelId).toBe('b')
    expect(state().shiftSelecting).toBe(true)
  })

  it('shift on a selected panel takes it out', () => {
    state().selectPanel('a')
    state().togglePanelSelection('b')
    state().togglePanelSelection('a')
    expect(state().selectedPanelIds).toEqual(['b'])
    expect(state().selectedPanelId).toBe('b')
    state().togglePanelSelection('b')
    expect([state().selectedPanelIds, state().selectedPanelId, state().shiftSelecting]).toEqual([[], null, false])
  })

  it('a plain click after a shift selection ends it, and clearing empties it', () => {
    state().selectPanel('a')
    state().togglePanelSelection('b')
    state().selectPanel('c')
    expect([state().selectedPanelIds, state().shiftSelecting]).toEqual([['c'], false])
    state().selectPanel(null)
    expect([state().selectedPanelIds, state().selectedPanelId]).toEqual([[], null])
  })

  it('focusing a panel selects only it; focusing none leaves the selection', () => {
    state().selectPanel('a')
    state().togglePanelSelection('b')
    state().focusPanel('c')
    expect([state().focusedPanelId, state().selectedPanelIds, state().shiftSelecting]).toEqual(['c', ['c'], false])
    state().focusPanel(null)
    expect([state().focusedPanelId, state().selectedPanelIds]).toEqual([null, ['c']])
  })

  it('closeProject and openProject reset the selection and the focus', async () => {
    installFakeApi({ 'projects:open': () => ({ meta, problems: [] }), 'sessions:list': () => [] })
    useAppStore.setState({ projectId: P, selectedPanelId: 'a', selectedPanelIds: ['a', 'b'], shiftSelecting: true, focusedPanelId: 'a' })
    state().closeProject()
    expect([state().selectedPanelIds, state().shiftSelecting, state().focusedPanelId]).toEqual([[], false, null])
    useAppStore.setState({ selectedPanelId: 'a', selectedPanelIds: ['a'], shiftSelecting: true, focusedPanelId: 'a' })
    await state().openProject(P)
    expect([state().selectedPanelId, state().selectedPanelIds, state().shiftSelecting, state().focusedPanelId]).toEqual([null, [], false, null])
  })
})

function contexts(calls: { channel: string; req: unknown }[]): unknown[] {
  return calls.filter((c) => c.channel === 'app:setActiveContext').map((c) => c.req)
}

describe('active context sync', () => {
  it('tells main the context once at start, then on every project and episode change', async () => {
    const { calls } = installFakeApi({
      'projects:open': () => ({ meta, problems: [] }),
      'sessions:list': () => [],
      'episodes:list': () => [],
      'panels:list': () => [],
      'app:setActiveContext': () => undefined
    })
    stop = startActiveContextSync()
    expect(contexts(calls)).toEqual([{ projectId: null, episodeId: null }])

    await useAppStore.getState().openProject(P)
    expect(contexts(calls)).toEqual([
      { projectId: null, episodeId: null },
      { projectId: P, episodeId: null }
    ])

    usePanelsStore.getState().selectEpisode(E)
    expect(contexts(calls).at(-1)).toEqual({ projectId: P, episodeId: E })
    expect(contexts(calls)).toHaveLength(3)

    // Other state changes do not repeat the call.
    useAppStore.getState().selectPanel('pnl_0000000001')
    useAppStore.getState().setStudioTab('story')
    expect(contexts(calls)).toHaveLength(3)
  })

  it('clears the episode when another project is opened', async () => {
    const { calls } = installFakeApi({
      'projects:open': () => ({ meta, problems: [] }),
      'sessions:list': () => [],
      'app:setActiveContext': () => undefined
    })
    useAppStore.setState({ projectId: 'prj_bbbbbbbbbb', activeEpisodeId: E })
    stop = startActiveContextSync()
    await useAppStore.getState().openProject(P)
    expect(contexts(calls)).toEqual([
      { projectId: 'prj_bbbbbbbbbb', episodeId: E },
      { projectId: P, episodeId: null }
    ])
  })

  it('records a refusal instead of throwing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    installFakeApi({})
    stop = startActiveContextSync()
    await vi.waitFor(() => expect(error).toHaveBeenCalled())
    error.mockRestore()
  })

  it('stops sending after the returned function runs', () => {
    const { calls } = installFakeApi({ 'app:setActiveContext': () => undefined })
    stop = startActiveContextSync()
    stop()
    stop = null
    useAppStore.setState({ projectId: P })
    expect(contexts(calls)).toHaveLength(1)
  })
})
