import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Beat } from '@shared/types'
import { startEventSync } from '../../events'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { initialStoryState, useStoryStore } from '../../stores/story-store'
import { installFakeApi } from '../../test/fake-api'
import { PROJECT_ID as P } from '../../test/character-fixtures'
import { episode } from '../../test/panel-fixtures'
import { StoryTab } from './StoryTab'

const E1 = 'epi_0000000001'
const E2 = 'epi_0000000002'
const BIBLE = '# Story Bible\n\n## Premise\nA girl who hears the moon.\n\n## World\n'
const NOW = '2026-10-21T10:00:00.000Z'

const beat = (id: string, summary: string, o: Partial<Beat> = {}): Beat => ({ id: `bt_00000000${id}`, episodeId: E1, summary, status: 'planned', createdAt: NOW, ...o })
const BEATS = [beat('01', 'Mina finds the map'), beat('02', 'Jin follows her', { status: 'drawn' }), beat('03', 'Elsewhere', { episodeId: E2 })]

let stopSync: (() => void) | undefined
let bible = BIBLE
let beats = BEATS
beforeEach(() => {
  bible = BIBLE
  beats = BEATS
  useAppStore.setState({ ...initialAppState, projectId: P, activeEpisodeId: E1 })
  useStoryStore.setState({ ...initialStoryState })
  usePanelsStore.setState({ ...initialPanelsState, projectId: P, episodes: [episode({ id: E1, title: 'Pilot' }), episode({ id: E2, number: 2, title: 'Second' })], episodesLoaded: true })
})
afterEach(() => stopSync?.())

function mount(handlers: Parameters<typeof installFakeApi>[0] = {}) {
  const api = installFakeApi({
    'story:get': () => ({ mode: 'user', bible, beats }),
    'story:updateBible': (req: { markdown: string }) => {
      bible = req.markdown
    },
    'story:updateBeat': (req: { beatId: string; patch: Partial<Beat> }) => {
      beats = beats.map((b) => (b.id === req.beatId ? { ...b, ...req.patch } : b))
      return beats.find((b) => b.id === req.beatId)
    },
    ...handlers
  })
  stopSync = startEventSync()
  render(<StoryTab />)
  return api
}

const editor = (): HTMLTextAreaElement => screen.getByTestId('bible-editor') as HTMLTextAreaElement

describe('StoryTab', () => {
  it('shows the bible in an editor and the active episode’s beats with status chips', async () => {
    const { calls } = mount()
    await waitFor(() => expect(editor()).toHaveValue(BIBLE))
    expect(calls.find((c) => c.channel === 'story:get')?.req).toEqual({ projectId: P })
    const items = screen.getAllByTestId('beat-item')
    expect(items.map((i) => i.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('Mina finds the map'), expect.stringContaining('Jin follows her')]))
    expect(items).toHaveLength(2)
    expect(screen.queryByText('Elsewhere')).toBeNull()
    expect(screen.getAllByTestId('beat-status').map((s) => (s as HTMLSelectElement).value)).toEqual(['planned', 'drawn'])
    expect(screen.getByText(/Pilot/)).toBeInTheDocument()
  })

  it('follows the active episode', async () => {
    mount()
    await waitFor(() => expect(screen.getAllByTestId('beat-item')).toHaveLength(2))
    act(() => useAppStore.setState({ activeEpisodeId: E2 }))
    expect(screen.getAllByTestId('beat-item').map((i) => i.textContent)).toEqual([expect.stringContaining('Elsewhere')])
  })

  it('says so when there are no beats or no open episode', async () => {
    beats = []
    mount()
    expect(await screen.findByText('No beats planned for this episode yet.')).toBeInTheDocument()
    act(() => useAppStore.setState({ activeEpisodeId: null }))
    expect(screen.getByText(/Open an episode/)).toBeInTheDocument()
  })

  it('saves the edited bible through story:updateBible, and Save is off until something changed', async () => {
    const { calls } = mount()
    await waitFor(() => expect(editor()).toHaveValue(BIBLE))
    expect(screen.getByTestId('bible-save')).toBeDisabled()
    await userEvent.type(editor(), 'Moon rules.')
    expect(screen.getByTestId('bible-save')).toBeEnabled()
    await userEvent.click(screen.getByTestId('bible-save'))
    await waitFor(() => expect(calls.find((c) => c.channel === 'story:updateBible')?.req).toEqual({ projectId: P, markdown: `${BIBLE}Moon rules.` }))
    await waitFor(() => expect(screen.getByTestId('bible-save')).toBeDisabled())
    expect(editor()).toHaveValue(`${BIBLE}Moon rules.`)
  })

  it('shows a failed save and keeps the text', async () => {
    mount({
      'story:updateBible': () => {
        throw new Error("Error invoking remote method 'story:updateBible': Error: EPERM: locked")
      }
    })
    await waitFor(() => expect(editor()).toHaveValue(BIBLE))
    await userEvent.type(editor(), 'x')
    await userEvent.click(screen.getByTestId('bible-save'))
    expect(await screen.findByRole('alert')).toHaveTextContent('EPERM: locked')
    expect(editor()).toHaveValue(`${BIBLE}x`)
    expect(screen.getByTestId('bible-save')).toBeEnabled()
  })

  it('shows what the agent writes while the user is not editing', async () => {
    const { emit } = mount()
    await waitFor(() => expect(editor()).toHaveValue(BIBLE))
    bible = `${BIBLE}\nAgent was here.`
    beats = [...BEATS, beat('04', 'A brand new beat')]
    act(() => emit({ type: 'story.changed', projectId: P }))
    await waitFor(() => expect(editor()).toHaveValue(`${BIBLE}\nAgent was here.`))
    expect(await screen.findByText('A brand new beat')).toBeInTheDocument()
  })

  it('does not wipe unsaved text when the agent changes the bible, and warns that saving overwrites', async () => {
    const { emit } = mount()
    await waitFor(() => expect(editor()).toHaveValue(BIBLE))
    await userEvent.type(editor(), 'my draft')
    bible = 'agent rewrote everything'
    act(() => emit({ type: 'story.changed', projectId: P }))
    expect(await screen.findByTestId('bible-conflict')).toHaveTextContent(/changed/i)
    expect(editor()).toHaveValue(`${BIBLE}my draft`)
    await userEvent.click(screen.getByTestId('bible-discard'))
    expect(editor()).toHaveValue('agent rewrote everything')
    expect(screen.queryByTestId('bible-conflict')).toBeNull()
  })

  it('changes a beat’s status through story:updateBeat', async () => {
    const { calls } = mount()
    await waitFor(() => expect(screen.getAllByTestId('beat-item')).toHaveLength(2))
    const first = within(screen.getAllByTestId('beat-item')[0]).getByTestId('beat-status')
    await userEvent.selectOptions(first, 'dropped')
    await waitFor(() => expect(calls.find((c) => c.channel === 'story:updateBeat')?.req).toEqual({ projectId: P, beatId: 'bt_0000000001', patch: { status: 'dropped' } }))
    await waitFor(() => expect((within(screen.getAllByTestId('beat-item')[0]).getByTestId('beat-status') as HTMLSelectElement).value).toBe('dropped'))
  })

  it('shows a failed beat update', async () => {
    mount({
      'story:updateBeat': () => {
        throw new Error('Unknown beat: bt_0000000001')
      }
    })
    await waitFor(() => expect(screen.getAllByTestId('beat-item')).toHaveLength(2))
    await userEvent.selectOptions(screen.getAllByTestId('beat-status')[0], 'drawn')
    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown beat: bt_0000000001')
  })

  it('shows a load failure', async () => {
    mount({
      'story:get': () => {
        throw new Error('Corrupt file')
      }
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Corrupt file')
  })

  it('ignores a story:get that finishes after the project changed', async () => {
    const releases: ((bible: string) => void)[] = []
    mount({
      'story:get': () =>
        new Promise((resolve) => {
          releases.push((bible) => resolve({ mode: 'user', bible, beats: [] }))
        })
    })
    await waitFor(() => expect(releases).toHaveLength(1))
    act(() => useAppStore.setState({ projectId: 'prj_bbbbbbbbbb' }))
    await waitFor(() => expect(releases).toHaveLength(2))
    // The answer for the project that was left arrives last and must not show.
    await act(async () => {
      releases[1]('NEW PROJECT')
      releases[0]('OLD PROJECT')
    })
    expect(useStoryStore.getState()).toMatchObject({ projectId: 'prj_bbbbbbbbbb', bible: 'NEW PROJECT' })
  })
})
