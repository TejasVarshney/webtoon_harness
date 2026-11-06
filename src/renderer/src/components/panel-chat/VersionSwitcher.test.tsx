import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Panel } from '@shared/types'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { PROJECT_ID as P } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { EPISODE_ID, panel, panelVersion } from '../../test/panel-fixtures'
import { VersionSwitcher } from './VersionSwitcher'

const A = 'pnl_00000000aa'
const B = 'pnl_00000000bb'

/** Three attempts, the middle one failed: the ready ones are the only ones with a number. */
const v1 = panelVersion({ id: 'ver_00000000a1', imagePath: `panels/${A}/ver_00000000a1.png` })
const v2 = panelVersion({ id: 'ver_00000000a2', status: 'failed', error: 'boom', imagePath: null })
const v3 = panelVersion({ id: 'ver_00000000a3', imagePath: `panels/${A}/ver_00000000a3.png` })
const first = panel({ id: A, versions: [v1, v2, v3], currentVersionId: v3.id })
const second = panel({ id: B, versions: [panelVersion({ id: 'ver_00000000b1', imagePath: `panels/${B}/ver_00000000b1.png` })], currentVersionId: 'ver_00000000b1' })

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId: P, activeEpisodeId: EPISODE_ID })
  usePanelsStore.setState({ ...initialPanelsState, projectId: P, episodesLoaded: true, panelsByEpisode: { [EPISODE_ID]: [first, second] } })
})

/** The switcher for the panel as the store has it now, as the workspace hands it over. */
function Host({ id }: { id: string }) {
  const p = usePanelsStore((s) => s.panelsByEpisode[EPISODE_ID]?.find((x) => x.id === id))
  return p === undefined ? null : <VersionSwitcher panel={p} />
}

function mount(handlers: Parameters<typeof installFakeApi>[0] = {}, id = A) {
  const api = installFakeApi(handlers)
  render(<Host id={id} />)
  return api
}

const label = (): string | null => screen.getByTestId('panel-version-label').textContent

describe('VersionSwitcher', () => {
  it('numbers ready versions only, and reverts to the previous ready one', async () => {
    const reverted = { ...first, currentVersionId: v1.id }
    const { calls } = mount({ 'panels:revert': () => reverted, 'panels:list': () => [reverted, second] })
    expect(label()).toBe('v2 / 2')

    await userEvent.click(screen.getByTestId('version-prev'))
    expect(calls.find((c) => c.channel === 'panels:revert')?.req).toEqual({ projectId: P, panelId: A, versionId: v1.id })
    await waitFor(() => expect(label()).toBe('v1 / 2'))
  })

  it('steps forward again with next', async () => {
    const atFirst = { ...first, currentVersionId: v1.id }
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [atFirst, second] } })
    const { calls } = mount({ 'panels:revert': () => first, 'panels:list': () => [first, second] })
    expect(label()).toBe('v1 / 2')
    await userEvent.click(screen.getByTestId('version-next'))
    expect(calls.find((c) => c.channel === 'panels:revert')?.req).toEqual({ projectId: P, panelId: A, versionId: v3.id })
    await waitFor(() => expect(label()).toBe('v2 / 2'))
  })

  it('disables the buttons at the ends of the history', () => {
    mount()
    expect(screen.getByTestId('version-next')).toBeDisabled()
    expect(screen.getByTestId('version-prev')).toBeEnabled()
    act(() => usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [{ ...first, currentVersionId: v1.id }, second] } }))
    expect(screen.getByTestId('version-prev')).toBeDisabled()
    expect(screen.getByTestId('version-next')).toBeEnabled()
  })

  it('has nothing to step through when the panel has one version', () => {
    mount({}, B)
    expect(label()).toBe('v1 / 1')
    expect(screen.getByTestId('version-prev')).toBeDisabled()
    expect(screen.getByTestId('version-next')).toBeDisabled()
  })

  it('shows no number for a panel without a ready image', () => {
    const empty = panel({ id: A, versions: [panelVersion({ id: 'ver_00000000a1', status: 'pending', imagePath: null })], currentVersionId: null })
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [empty, second] } })
    mount()
    expect(label()).toBe('No image yet')
    expect(screen.getByTestId('version-prev')).toBeDisabled()
    expect(screen.getByTestId('version-next')).toBeDisabled()
  })

  it('shows a failed revert and keeps the label', async () => {
    mount({
      'panels:revert': () => {
        throw new Error("Error invoking remote method 'panels:revert': Error: Version ver_00000000a1 is not ready")
      }
    })
    await userEvent.click(screen.getByTestId('version-prev'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Version ver_00000000a1 is not ready')
    expect(label()).toBe('v2 / 2')
    expect(screen.getByTestId('version-prev')).toBeEnabled()
  })

  it('does not send a second revert while one is in flight', async () => {
    let release: (p: Panel) => void = () => undefined
    const { calls } = mount({
      'panels:revert': () => new Promise<Panel>((resolve) => (release = resolve)),
      'panels:list': () => [{ ...first, currentVersionId: v1.id }, second]
    })
    await userEvent.click(screen.getByTestId('version-prev'))
    expect(screen.getByTestId('version-prev')).toBeDisabled()
    expect(screen.getByTestId('version-next')).toBeDisabled()
    expect(calls.filter((c) => c.channel === 'panels:revert')).toHaveLength(1)
    await act(async () => release({ ...first, currentVersionId: v1.id }))
    await waitFor(() => expect(label()).toBe('v1 / 2'))
  })
})
