import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialCharactersState, useCharactersStore } from '../../stores/characters-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { PROJECT_ID as projectId, character } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { episode, panel } from '../../test/panel-fixtures'
import { RightPane } from './RightPane'

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId })
  useCharactersStore.setState({ ...initialCharactersState })
  usePanelsStore.setState({ ...initialPanelsState })
})

describe('RightPane', () => {
  it('switches between the Webtoon, Characters and Story tabs', async () => {
    installFakeApi({
      'characters:list': () => [character()],
      'episodes:list': () => [episode()],
      'panels:list': () => [],
      'story:get': () => ({ mode: 'user', bible: '# Story Bible\n', beats: [] })
    })
    render(<RightPane />)
    expect(screen.getByTestId('tab-webtoon')).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTestId('character-card')).toBeNull()

    await userEvent.click(screen.getByTestId('tab-characters'))
    expect(screen.getByTestId('tab-characters')).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('tab-webtoon')).toHaveAttribute('aria-selected', 'false')
    expect(useAppStore.getState().rightTab).toBe('characters')
    expect(await screen.findByTestId('character-card')).toBeInTheDocument()

    await userEvent.click(screen.getByTestId('tab-story'))
    expect(useAppStore.getState().rightTab).toBe('story')
    expect(screen.queryByTestId('character-card')).toBeNull()
    expect(await screen.findByTestId('bible-editor')).toHaveValue('# Story Bible\n')
  })

  it('shows the webtoon strip on the Webtoon tab', async () => {
    installFakeApi({ 'characters:list': () => [character()], 'episodes:list': () => [episode({ panelIds: ['pnl_0000000001'] })], 'panels:list': () => [panel()] })
    render(<RightPane />)
    expect(await screen.findByTestId('panel-card')).toBeInTheDocument()
    expect(screen.getByLabelText('Episode')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('tab-characters'))
    expect(screen.queryByTestId('panel-card')).toBeNull()
  })

  it('labels the tabs', () => {
    installFakeApi({ 'characters:list': () => [], 'episodes:list': () => [episode()], 'panels:list': () => [] })
    render(<RightPane />)
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Webtoon', 'Characters', 'Story'])
  })
})
