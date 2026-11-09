import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { contentBottom, resolveStrip } from '@shared/strip-canvas'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialCharactersState, useCharactersStore } from '../../stores/characters-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { PROJECT_ID as projectId, character } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { EPISODE_ID, panel } from '../../test/panel-fixtures'
import { StripCanvas } from './StripCanvas'

const a = panel({ id: 'pnl_00000000aa', placement: { x: 40, y: 30, width: 200 } })
const b = panel({ id: 'pnl_00000000bb', placement: { x: 220, y: 500, width: 180 } })

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId, activeEpisodeId: EPISODE_ID })
  usePanelsStore.setState({ ...initialPanelsState, projectId, panelsByEpisode: { [EPISODE_ID]: [a, b] } })
  useCharactersStore.setState({ ...initialCharactersState, projectId, characters: [character()], loaded: true })
})

describe('StripCanvas', () => {
  it('places each card at its resolved position', () => {
    installFakeApi({})
    render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    const placed = resolveStrip([a, b])
    screen.getAllByTestId('panel-card').forEach((card, i) => {
      expect(card.style.left).toBe(`${placed[i].x}px`)
      expect(card.style.top).toBe(`${placed[i].y}px`)
      expect(card.style.width).toBe(`${placed[i].width}px`)
      expect(card.style.getPropertyValue('--share')).toBe(String(placed[i].share))
    })
  })

  it('its height runs 1600 past the lowest panel', () => {
    installFakeApi({})
    const { container } = render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    const canvas = container.querySelector<HTMLElement>('.strip-canvas')
    expect(canvas?.style.height).toBe(`${contentBottom(resolveStrip([a, b])) + 1600}px`)
  })

  it('the export drawing ends at the lowest panel and has no chrome', () => {
    installFakeApi({})
    const { container } = render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} mode="export" background="#123456" />)
    const canvas = container.querySelector<HTMLElement>('.strip-canvas')
    expect(canvas?.style.height).toBe(`${contentBottom(resolveStrip([a, b]))}px`)
    expect(canvas?.style.background).toContain('rgb(18, 52, 86)')
    expect(screen.queryByTestId('add-panel')).toBeNull()
    expect(screen.queryByRole('group', { name: 'Panel actions' })).toBeNull()
  })

  it('shift-click selects, click replaces', async () => {
    installFakeApi({})
    render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    const [first, second] = screen.getAllByTestId('panel-card')
    await userEvent.click(first)
    fireEvent.click(second, { shiftKey: true })
    expect(useAppStore.getState().selectedPanelIds).toEqual([a.id, b.id])
    expect(useAppStore.getState().shiftSelecting).toBe(true)
    await userEvent.click(first)
    expect(useAppStore.getState().selectedPanelIds).toEqual([a.id])
    expect(useAppStore.getState().shiftSelecting).toBe(false)
  })

  it('a click on empty strip clears the selection', async () => {
    installFakeApi({})
    const { container } = render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    useAppStore.getState().selectPanel(a.id)
    await userEvent.click(container.querySelector('.strip-canvas') as HTMLElement)
    expect(useAppStore.getState().selectedPanelIds).toEqual([])
  })

  it('a click does not open the editor, a double-click does', async () => {
    installFakeApi({})
    render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    const [first] = screen.getAllByTestId('panel-card')
    await userEvent.click(first)
    expect(useAppStore.getState().focusedPanelId).toBeNull()
    fireEvent.doubleClick(first)
    expect(useAppStore.getState().focusedPanelId).toBe(a.id)
  })

  it('Add panel button keeps testid add-panel, makes a blank panel and focuses it', async () => {
    const made = panel({ id: 'pnl_00000000cc', versions: [], currentVersionId: null })
    const { calls } = installFakeApi({ 'panels:create': () => ({ panel: made, warnings: [] }), 'panels:list': () => [a, b, made] })
    render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    await userEvent.click(screen.getByTestId('add-panel'))
    await waitFor(() => expect(useAppStore.getState().focusedPanelId).toBe(made.id))
    expect(calls.filter((c) => c.channel === 'panels:create').map((c) => c.req)).toEqual([
      { projectId, draft: { episodeId: EPISODE_ID, description: '', setting: '', shot: 'medium', characters: [], dialogue: [] }, generate: false }
    ])
  })
})
