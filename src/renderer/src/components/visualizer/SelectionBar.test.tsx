import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialGenerateState, useGenerateStore } from '../../stores/generate-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { PROJECT_ID as projectId } from '../../test/character-fixtures'
import { EPISODE_ID, panel } from '../../test/panel-fixtures'
import { SelectionBar } from './SelectionBar'

const a = panel({ id: 'pnl_00000000aa' })
const b = panel({ id: 'pnl_00000000bb' })
const blank = panel({ id: 'pnl_00000000cc', versions: [], currentVersionId: null })

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId, activeEpisodeId: EPISODE_ID })
  useGenerateStore.setState({ ...initialGenerateState })
  usePanelsStore.setState({ ...initialPanelsState, projectId, panelsByEpisode: { [EPISODE_ID]: [a, b, blank] } })
})

const shiftSelect = (...ids: string[]): void => useAppStore.setState({ selectedPanelIds: ids, selectedPanelId: ids.at(-1) ?? null, shiftSelecting: true })

describe('SelectionBar', () => {
  it('Generate opens the page with the ready panels, in strip order', async () => {
    shiftSelect(b.id, blank.id, a.id)
    render(<SelectionBar />)
    await userEvent.click(screen.getByRole('button', { name: 'Generate from 2 panels' }))
    expect(useGenerateStore.getState().request).toEqual({ episodeId: EPISODE_ID, referencePanelIds: [a.id, b.id] })
  })

  it('says Generate from 2 panels', () => {
    shiftSelect(a.id, b.id)
    render(<SelectionBar />)
    expect(screen.getByText('Generate from 2 panels')).toBeInTheDocument()
  })

  it('says Generate from 1 panel', () => {
    shiftSelect(a.id)
    render(<SelectionBar />)
    expect(screen.getByText('Generate from 1 panel')).toBeInTheDocument()
  })

  it('counts only panels with a ready image', () => {
    shiftSelect(a.id, blank.id)
    render(<SelectionBar />)
    expect(screen.getByText('Generate from 1 panel')).toBeInTheDocument()
  })

  it('is absent without a shift selection', () => {
    useAppStore.setState({ selectedPanelIds: [a.id, b.id], selectedPanelId: b.id, shiftSelecting: false })
    const { container } = render(<SelectionBar />)
    expect(container).toBeEmptyDOMElement()
  })

  it('says the selected panels have no image when none do', () => {
    shiftSelect(blank.id)
    render(<SelectionBar />)
    expect(screen.getByText('Selected panels have no image yet')).toBeInTheDocument()
    expect(screen.queryByText(/Generate from/)).toBeNull()
  })
})
