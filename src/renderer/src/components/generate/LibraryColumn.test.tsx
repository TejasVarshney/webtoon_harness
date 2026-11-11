import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  it('lists non-archived entries under a heading per kind, with a count, and says when a kind is empty', () => {
    const gone = character({ id: 'chr_0000000002', name: 'Old Kim', archived: true })
    render(<LibraryColumn characters={[character(), gone]} items={[]} locations={[location()]} />)
    expect(screen.getAllByTestId('library-character')).toHaveLength(1)
    expect(screen.getByText('No items yet')).toBeInTheDocument()
    expect(screen.getAllByTestId('library-location')).toHaveLength(1)
    const characters = screen.getByRole('region', { name: 'Characters' })
    expect(within(characters).getByRole('heading')).toHaveTextContent('Characters1')
  })

  it('shows each card with its picture and name, and a name with no picture by its initial', () => {
    const blank = character({ id: 'chr_0000000003', name: 'Ghost', variations: [variation({ status: 'pending', imagePath: null })] })
    render(<LibraryColumn characters={[character(), blank]} items={[]} locations={[]} />)
    const [mina, ghost] = screen.getAllByTestId('library-character')
    expect(mina.querySelector('img')).not.toBeNull()
    expect(within(mina).getByRole('button')).toHaveAttribute('title', 'Mina')
    expect(ghost.querySelector('img')).toBeNull()
    expect(within(ghost).getByRole('button')).toHaveTextContent('GGhost')
  })

  it('marks a chosen card, and picks its look in a row under the section, not in the card', async () => {
    const c = character({ variations: [variation(), variation({ id: 'var_0000000002', name: 'Rain', status: 'pending', imagePath: null })] })
    render(<LibraryColumn characters={[c]} items={[]} locations={[]} />)
    const card = screen.getByTestId('library-character')
    const button = within(card).getByRole('button', { name: /Mina/ })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('group', { name: 'Chosen characters' })).toBeNull()
    await userEvent.click(button)
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(card).toHaveAttribute('data-selected', 'true')
    expect(within(card).queryByRole('combobox')).toBeNull()
    const chosen = screen.getByRole('group', { name: 'Chosen characters' })
    expect(within(chosen).getByRole('option', { name: 'Rain (not ready)' })).toBeInTheDocument()
  })

  it('the bar names the three kinds, counts what is chosen, and jumps to a kind', async () => {
    render(<LibraryColumn characters={[character()]} items={[]} locations={[location()]} />)
    const bar = screen.getByRole('navigation', { name: 'Library sections' })
    expect(within(bar).getAllByRole('button').map((b) => b.textContent)).toEqual(['Characters', 'Items', 'Locations'])
    expect(within(bar).getByRole('button', { name: 'Characters' })).toHaveAttribute('aria-current', 'true')

    await userEvent.click(within(screen.getByTestId('library-character')).getByRole('button'))
    expect(within(bar).getByRole('button', { name: /Characters/ })).toHaveTextContent('Characters1')

    const scroll = vi.fn()
    screen.getByRole('region', { name: 'Locations' }).scrollIntoView = scroll
    await userEvent.click(within(bar).getByRole('button', { name: 'Locations' }))
    expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
    expect(within(bar).getByRole('button', { name: 'Locations' })).toHaveAttribute('aria-current', 'true')
  })

  it('ends in the panel details, which the bar jumps to as Details', async () => {
    render(<LibraryColumn characters={[character()]} items={[]} locations={[]} details={<p>the fields</p>} />)
    const bar = screen.getByRole('navigation', { name: 'Library sections' })
    expect(within(bar).getAllByRole('button').map((b) => b.textContent)).toEqual(['Characters', 'Items', 'Locations', 'Details'])
    const details = screen.getByRole('region', { name: 'Panel details' })
    expect(details).toHaveTextContent('the fields')
    const sections = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))
    expect(sections).toEqual(['Characters', 'Items', 'Locations', 'Panel details'])
    const scroll = vi.fn()
    details.scrollIntoView = scroll
    await userEvent.click(within(bar).getByRole('button', { name: 'Details' }))
    expect(scroll).toHaveBeenCalled()
    expect(within(bar).getByRole('button', { name: 'Details' })).toHaveAttribute('aria-current', 'true')
  })

  it('has no Details without details to show', () => {
    render(<LibraryColumn characters={[]} items={[]} locations={[]} />)
    expect(screen.queryByRole('button', { name: 'Details' })).toBeNull()
  })
})
