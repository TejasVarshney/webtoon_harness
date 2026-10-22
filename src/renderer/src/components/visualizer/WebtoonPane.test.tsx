import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assetUrl } from '@shared/asset-url'
import type { Panel } from '@shared/types'
import { startEventSync } from '../../events'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialCharactersState, useCharactersStore } from '../../stores/characters-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { PROJECT_ID as projectId, character } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { EPISODE_ID, episode, panel, panelVersion } from '../../test/panel-fixtures'
import { WebtoonPane } from './WebtoonPane'

const mina = character()
const second = episode({ id: 'epi_0000000002', number: 2, title: 'The Rooftop' })
let stopSync: (() => void) | undefined

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId })
  usePanelsStore.setState({ ...initialPanelsState })
  useCharactersStore.setState({ ...initialCharactersState })
})
afterEach(() => stopSync?.())

function mount(handlers: Parameters<typeof installFakeApi>[0]) {
  const api = installFakeApi({ 'characters:list': () => [mina], ...handlers })
  stopSync = startEventSync()
  render(<WebtoonPane />)
  return api
}

const a = panel({ id: 'pnl_00000000aa', versions: [panelVersion({ id: 'ver_00000000aa', imagePath: 'panels/pnl_00000000aa/ver_00000000aa.png' })], currentVersionId: 'ver_00000000aa' })
const b = panel({ id: 'pnl_00000000bb', versions: [panelVersion({ id: 'ver_00000000bb', imagePath: 'panels/pnl_00000000bb/ver_00000000bb.png' })], currentVersionId: 'ver_00000000bb' })

describe('WebtoonPane', () => {
  it('opens the first episode and lists its panels in order', async () => {
    mount({ 'episodes:list': () => [episode({ panelIds: [a.id, b.id] }), second], 'panels:list': () => [a, b] })
    const cards = await screen.findAllByTestId('panel-card')
    expect(cards).toHaveLength(2)
    expect(within(cards[0]).getByRole('img')).toHaveAttribute('src', assetUrl(projectId, 'panels/pnl_00000000aa/ver_00000000aa.png'))
    expect(within(cards[1]).getByRole('img')).toHaveAttribute('src', assetUrl(projectId, 'panels/pnl_00000000bb/ver_00000000bb.png'))
    expect(useAppStore.getState().activeEpisodeId).toBe(EPISODE_ID)
  })

  it('puts an insert button after every panel, so the last one appends', async () => {
    mount({ 'episodes:list': () => [episode()], 'panels:list': () => [a, b] })
    await screen.findAllByTestId('panel-card')
    expect(screen.getAllByTestId('add-panel')).toHaveLength(2)
  })

  it('passes the panel to insert after, and nothing at the end of the strip', async () => {
    const created = panel({ id: 'pnl_00000000cc' })
    const { calls } = mount({ 'episodes:list': () => [episode()], 'panels:list': () => [a, b], 'panels:create': () => ({ panel: created, warnings: [] }) })
    await screen.findAllByTestId('panel-card')
    const [between, end] = screen.getAllByTestId('add-panel')

    await userEvent.click(between)
    await userEvent.click(within(screen.getByTestId('panel-editor')).getByRole('button', { name: 'Create without image' }))
    await waitFor(() => expect(screen.queryByTestId('panel-editor')).toBeNull())

    await userEvent.click(end)
    await userEvent.click(within(screen.getByTestId('panel-editor')).getByRole('button', { name: 'Create without image' }))
    await waitFor(() => expect(screen.queryByTestId('panel-editor')).toBeNull())

    const drafts = calls.filter((c) => c.channel === 'panels:create').map((c) => (c.req as { draft: Record<string, unknown> }).draft)
    expect(drafts[0].afterPanelId).toBe(a.id)
    expect(drafts[1]).not.toHaveProperty('afterPanelId')
    expect(drafts.every((d) => d.episodeId === EPISODE_ID)).toBe(true)
  })

  it('shows one insert button and a hint for an empty episode', async () => {
    mount({ 'episodes:list': () => [episode()], 'panels:list': () => [] })
    expect(await screen.findAllByTestId('add-panel')).toHaveLength(1)
    expect(screen.queryByTestId('panel-card')).toBeNull()
    expect(screen.getByText(/no panels yet/i)).toBeInTheDocument()
  })

  it('shows a new panel when panel.changed arrives', async () => {
    let panels: Panel[] = []
    const api = mount({ 'episodes:list': () => [episode()], 'panels:list': () => panels })
    await screen.findByText(/no panels yet/i)
    panels = [a]
    api.emit({ type: 'panel.changed', projectId, panelId: a.id })
    expect(await screen.findByTestId('panel-card')).toBeInTheDocument()
  })

  it('follows a generation from Generating… to the image', async () => {
    const pending = panel({ id: a.id, versions: [panelVersion({ id: 'ver_00000000aa', status: 'pending', imagePath: null })], currentVersionId: null })
    let current = pending
    const api = mount({ 'episodes:list': () => [episode()], 'panels:list': () => [current] })
    expect(await screen.findByTestId('panel-status')).toHaveTextContent('Generating…')
    expect(screen.queryByRole('img')).toBeNull()
    current = a
    api.emit({ type: 'panel.changed', projectId, panelId: a.id })
    await waitFor(() => expect(screen.getByTestId('panel-card').querySelector('img')).not.toBeNull())
    expect(screen.queryByTestId('panel-status')).toBeNull()
  })

  it('marks the selected panel', async () => {
    mount({ 'episodes:list': () => [episode()], 'panels:list': () => [a, b] })
    const cards = await screen.findAllByTestId('panel-card')
    await userEvent.click(cards[1])
    expect(screen.getAllByTestId('panel-card').map((c) => c.getAttribute('data-selected'))).toEqual(['false', 'true'])
    expect(useAppStore.getState().selectedPanelId).toBe(b.id)
  })

  it('asks for a project first', () => {
    useAppStore.setState({ projectId: null })
    installFakeApi({})
    render(<WebtoonPane />)
    expect(screen.getByText(/create a project/i)).toBeInTheDocument()
  })

  it('shows a load failure', async () => {
    mount({
      'episodes:list': () => {
        throw new Error('disk on fire')
      }
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('disk on fire')
  })

  describe('episode bar', () => {
    it('switches episodes and shows the other episode`s panels', async () => {
      const { calls } = mount({
        'episodes:list': () => [episode({ panelIds: [a.id] }), { ...second, panelIds: [b.id] }],
        'panels:list': (req: { episodeId: string }) => (req.episodeId === EPISODE_ID ? [a] : [{ ...b, episodeId: second.id }])
      })
      const select = await screen.findByLabelText('Episode')
      expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Episode 1', 'The Rooftop'])
      expect(select).toHaveValue(EPISODE_ID)
      await screen.findByTestId('panel-card')

      await userEvent.selectOptions(select, 'The Rooftop')
      expect(useAppStore.getState().activeEpisodeId).toBe(second.id)
      await waitFor(() => expect(within(screen.getByTestId('panel-card')).getByRole('img')).toHaveAttribute('src', assetUrl(projectId, 'panels/pnl_00000000bb/ver_00000000bb.png')))
      expect(calls.filter((c) => c.channel === 'panels:list').map((c) => (c.req as { episodeId: string }).episodeId)).toContain(second.id)
    })

    it('creates an episode, opens it, and numbers the title', async () => {
      let episodes = [episode()]
      const { calls } = mount({
        'episodes:list': () => episodes,
        'panels:list': () => [],
        'episodes:create': () => {
          episodes = [...episodes, second]
          return second
        }
      })
      await screen.findByLabelText('Episode')
      await userEvent.click(screen.getByRole('button', { name: 'New episode' }))
      const title = screen.getByLabelText('Episode title')
      expect(title).toHaveValue('Episode 2')
      await userEvent.clear(title)
      await userEvent.type(title, 'The Rooftop')
      await userEvent.click(screen.getByRole('button', { name: 'Create episode' }))
      await waitFor(() => expect(useAppStore.getState().activeEpisodeId).toBe(second.id))
      expect(calls.find((c) => c.channel === 'episodes:create')?.req).toEqual({ projectId, title: 'The Rooftop' })
      expect(screen.queryByLabelText('Episode title')).toBeNull()
      expect(screen.getByLabelText('Episode')).toHaveValue(second.id)
    })

    it('can cancel creating an episode, and shows a failure', async () => {
      mount({
        'episodes:list': () => [episode()],
        'panels:list': () => [],
        'episodes:create': () => {
          throw new Error('disk full')
        }
      })
      await screen.findByLabelText('Episode')
      await userEvent.click(screen.getByRole('button', { name: 'New episode' }))
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByLabelText('Episode title')).toBeNull()

      await userEvent.click(screen.getByRole('button', { name: 'New episode' }))
      await userEvent.click(screen.getByRole('button', { name: 'Create episode' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('disk full')
      expect(screen.getByLabelText('Episode title')).toBeInTheDocument()
    })
  })
})
