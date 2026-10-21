import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialCharactersState, useCharactersStore } from '../../stores/characters-store'
import { PROJECT_ID as projectId, character } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { RightPane } from './RightPane'

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId })
  useCharactersStore.setState({ ...initialCharactersState })
})

describe('RightPane', () => {
  it('switches between the Webtoon, Characters and Story tabs', async () => {
    installFakeApi({ 'characters:list': () => [character()] })
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
  })

  it('labels the tabs', () => {
    render(<RightPane />)
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Webtoon', 'Characters', 'Story'])
  })
})
