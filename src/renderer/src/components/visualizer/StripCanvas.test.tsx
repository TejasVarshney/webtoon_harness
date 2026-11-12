import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { contentBottom, resolveStrip } from '@shared/strip-canvas'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialCharactersState, useCharactersStore } from '../../stores/characters-store'
import { initialGenerateState, useGenerateStore } from '../../stores/generate-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { PROJECT_ID as projectId, character } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { EPISODE_ID, episode, panel } from '../../test/panel-fixtures'
import { StripCanvas } from './StripCanvas'

/** A stylesheet's text, whitespace collapsed. The web tsconfig has no node types, and a ?raw import of CSS comes back empty under vitest. */
async function cssOf(file: string): Promise<string> {
  const specifier: string = 'node:fs'
  const fs = (await import(/* @vite-ignore */ specifier)) as { readFileSync(file: string, encoding: 'utf8'): string }
  return fs.readFileSync(file, 'utf8').replace(/\s+/g, ' ')
}

const a = panel({ id: 'pnl_00000000aa', placement: { x: 40, y: 30, width: 200 } })
const b = panel({ id: 'pnl_00000000bb', placement: { x: 220, y: 500, width: 180 } })

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId, activeEpisodeId: EPISODE_ID })
  useGenerateStore.setState({ ...initialGenerateState })
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

  it('gives each card and its bubble layer the placed height, so the frame is inside the layout box', () => {
    installFakeApi({})
    const wide = panel({ id: 'pnl_00000000ee', aspect: '16:9', placement: { x: 0, y: 0, width: 300 } })
    const tall = panel({ id: 'pnl_00000000ff', aspect: '9:16', placement: { x: 0, y: 400, width: 200 } })
    const { container } = render(<StripCanvas episodeId={EPISODE_ID} panels={[wide, tall]} />)
    const placed = resolveStrip([wide, tall])
    screen.getAllByTestId('panel-card').forEach((card, i) => expect(card.style.height).toBe(`${placed[i].height}px`))
    container.querySelectorAll<HTMLElement>('.strip-bubbles').forEach((layer, i) => expect(layer.style.height).toBe(`${placed[i].height}px`))
  })

  it('lets the art fill the card, whatever the frame takes', async () => {
    const css = await cssOf('src/renderer/src/styles.css')
    expect(css).toMatch(/\.strip-canvas > \.panel-card \.panel-media, \.strip-bubbles \.panel-media \{[^}]*height: 100%[^}]*aspect-ratio: auto !important/)
  })

  it('its height runs 1600 past the lowest panel', () => {
    installFakeApi({})
    const { container } = render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    const canvas = container.querySelector<HTMLElement>('.strip-canvas')
    expect(canvas?.style.height).toBe(`${contentBottom(resolveStrip([a, b])) + 1600}px`)
  })

  it('paints the episode background over the content, and an old episode as it always looked', () => {
    installFakeApi({})
    const bottom = contentBottom(resolveStrip([a, b]))
    const { container, unmount } = render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    expect(container.querySelector<HTMLElement>('.strip-canvas')?.style.backgroundColor).toBe('rgb(255, 255, 255)')
    expect(container.querySelector<HTMLElement>('.strip-canvas')?.style.backgroundImage).toBe('')
    unmount()
    const stops = [
      { color: '#000000', at: 0 },
      { color: '#ffffff', at: 1 }
    ]
    usePanelsStore.setState({ episodes: [episode({ background: { kind: 'linear', angle: 180, repeatEvery: null, stops } })] })
    const painted = render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />).container.querySelector<HTMLElement>('.strip-canvas')
    expect(painted?.style.backgroundImage).toContain('linear-gradient')
    expect(painted?.style.backgroundSize).toBe(`100% ${bottom}px`)
  })

  it('an old episode with a black gutter still shows black below its last panel', () => {
    installFakeApi({})
    const white = panel({ id: 'pnl_00000000cc', aspect: '1:1', gutter: 'white' })
    const black = panel({ id: 'pnl_00000000dd', aspect: '1:1', gutter: 'black' })
    const { container } = render(<StripCanvas episodeId={EPISODE_ID} panels={[white, black]} />)
    const canvas = container.querySelector<HTMLElement>('.strip-canvas')
    expect(canvas?.style.backgroundImage).toContain('linear-gradient')
    expect(canvas?.style.backgroundColor).toBe('rgb(0, 0, 0)')
  })

  it('draws an image background from the project asset', () => {
    installFakeApi({})
    usePanelsStore.setState({ episodes: [episode({ background: { kind: 'image', path: `episode-backgrounds/${EPISODE_ID}/x.png`, fit: 'width', opacity: 1, color: '#ffffff' } })] })
    const { container } = render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    expect(container.querySelector<HTMLElement>('.strip-canvas')?.style.backgroundImage).toContain(`webtoon-asset://${projectId}/episode-backgrounds/${EPISODE_ID}/x.png`)
  })

  it('numbers each card by its place in the episode, in the edit view only', () => {
    installFakeApi({})
    const view = render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    expect(screen.getAllByTestId('panel-card').map((card) => card.querySelector('[data-testid="panel-number"]')?.textContent)).toEqual(['1', '2'])
    expect(screen.getAllByTestId('panel-number')[1]).toHaveAttribute('title', 'Panel 2')
    view.unmount()
    render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} mode="export" />)
    expect(screen.queryByTestId('panel-number')).toBeNull()
  })

  it('the export drawing ends at the lowest panel and has no chrome', () => {
    installFakeApi({})
    const { container } = render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} mode="export" background={{ kind: 'solid', color: '#123456' }} />)
    const canvas = container.querySelector<HTMLElement>('.strip-canvas')
    expect(canvas?.style.height).toBe(`${contentBottom(resolveStrip([a, b]))}px`)
    expect(canvas?.style.backgroundColor).toBe('rgb(18, 52, 86)')
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

  it('cancelling a delete keeps the selection, and a shift selection has no per-panel tools to delete from', async () => {
    installFakeApi({})
    render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    const [first, second] = screen.getAllByTestId('panel-card')
    await userEvent.click(first)
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete panel' })).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useAppStore.getState().selectedPanelIds).toEqual([a.id])
    fireEvent.click(second, { shiftKey: true })
    expect(useAppStore.getState().selectedPanelIds).toEqual([a.id, b.id])
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(useAppStore.getState().shiftSelecting).toBe(true)
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

  it('Add panel button keeps testid add-panel and opens the Generate page with no references', async () => {
    const { calls } = installFakeApi({})
    render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    await userEvent.click(screen.getByTestId('add-panel'))
    expect(useGenerateStore.getState().request).toEqual({ episodeId: EPISODE_ID, referencePanelIds: [] })
    expect(calls).toEqual([])
  })
})
