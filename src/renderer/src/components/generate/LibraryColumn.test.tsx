import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialGenerateState, useGenerateStore } from '../../stores/generate-store'
import { character, PROJECT_ID as projectId, variation } from '../../test/character-fixtures'
import { location } from '../../test/location-fixtures'
import { EPISODE_ID } from '../../test/panel-fixtures'
import { LibraryColumn } from './LibraryColumn'

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId, activeEpisodeId: EPISODE_ID })
  useGenerateStore.setState({ ...initialGenerateState })
  useGenerateStore.getState().open({ episodeId: EPISODE_ID, referencePanelIds: [] })
})

describe('LibraryColumn', () => {
  it('lists non-archived entries and says when a kind is empty', () => {
    const gone = character({ id: 'chr_0000000002', name: 'Old Kim', archived: true })
    render(<LibraryColumn characters={[character(), gone]} items={[]} locations={[location()]} />)
    expect(screen.getAllByTestId('library-character')).toHaveLength(1)
    expect(screen.getByText('No items yet')).toBeInTheDocument()
    expect(screen.getAllByTestId('library-location')).toHaveLength(1)
  })

  it('shows a selected tile as pressed, and a variation that has no image yet as not ready', async () => {
    const c = character({ variations: [variation(), variation({ id: 'var_0000000002', name: 'Rain', status: 'pending', imagePath: null })] })
    render(<LibraryColumn characters={[c]} items={[]} locations={[]} />)
    const tile = screen.getByTestId('library-character')
    const button = within(tile).getByRole('button', { name: /Mina/ })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(within(tile).getByRole('option', { name: 'Rain (not ready)' })).toBeInTheDocument()
  })
})
