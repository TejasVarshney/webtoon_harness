import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { PROJECT_ID as P } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { EPISODE_ID, episode } from '../../test/panel-fixtures'
import { EpisodeBar } from './EpisodeBar'

beforeEach(() => {
  installFakeApi({ 'episodes:setBackground': () => episode(), 'episodes:list': () => [episode()], 'panels:list': () => [] })
  useAppStore.setState({ ...initialAppState, projectId: P, activeEpisodeId: EPISODE_ID })
  usePanelsStore.setState({ ...initialPanelsState, projectId: P, episodes: [episode()], episodesLoaded: true, panelsByEpisode: { [EPISODE_ID]: [] } })
})

describe('EpisodeBar background button', () => {
  it('opens the background editor and closes it on Escape, which saves the change and then clears the preview', async () => {
    render(<EpisodeBar />)
    fireEvent.click(screen.getByTestId('background-open'))
    expect(screen.getByRole('dialog', { name: 'Background' })).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: 'Linear' }))
    expect(usePanelsStore.getState().backgroundPreview?.episodeId).toBe(EPISODE_ID)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Background' })).toBeNull()
    await waitFor(() => expect(usePanelsStore.getState().backgroundPreview).toBeNull())
  })

  it('shows a background save that failed after the editor closed, and Dismiss puts the strip back', () => {
    usePanelsStore.setState({ backgroundError: 'Disk full', backgroundPreview: { episodeId: EPISODE_ID, background: { kind: 'solid', color: '#123456' } } })
    render(<EpisodeBar />)
    expect(screen.getByRole('alert').textContent).toContain('Disk full')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(usePanelsStore.getState().backgroundPreview).toBeNull()
  })

  it('switching episode with the editor open leaves no held preview or alert behind', async () => {
    const other = episode({ id: 'epi_0000000002', number: 2, title: 'Episode 2' })
    installFakeApi({ 'episodes:setBackground': () => Promise.reject(new Error('Disk full')), 'episodes:list': () => [episode(), other], 'panels:list': () => [] })
    usePanelsStore.setState({ episodes: [episode(), other], panelsByEpisode: { [EPISODE_ID]: [], [other.id]: [] } })
    render(<EpisodeBar />)
    fireEvent.click(screen.getByTestId('background-open'))
    fireEvent.click(screen.getByRole('radio', { name: 'Linear' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Disk full'))
    fireEvent.change(screen.getByLabelText('Episode'), { target: { value: other.id } })
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(usePanelsStore.getState().backgroundPreview).toBeNull()
    expect(usePanelsStore.getState().backgroundError).toBeNull()
  })

  it('is disabled with no episode', () => {
    usePanelsStore.setState({ episodes: [] })
    useAppStore.setState({ activeEpisodeId: null })
    render(<EpisodeBar />)
    expect((screen.getByTestId('background-open') as HTMLButtonElement).disabled).toBe(true)
  })
})
