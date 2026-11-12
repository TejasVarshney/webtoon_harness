import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Panel } from '@shared/types'
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

afterEach(() => {
  vi.useRealTimers()
})

/** The panels as the store holds them, so a test that wants the strip to follow a save can serve them from `panels:list`. */
function moved(panelId: string, placement: Panel['placement']): Panel[] {
  return [a, b].map((p) => (p.id === panelId ? { ...p, placement } : p))
}

const card = (i: number): HTMLElement => screen.getAllByTestId('panel-card')[i]
const placeCalls = (calls: { channel: string; req: unknown }[]): unknown[] => calls.filter((c) => c.channel === 'panels:place').map((c) => c.req)

/** A press at (x, y), a move to (x + dx, y + dy) and a release there, the way the pointer sends them. */
function drag(el: HTMLElement, dx: number, dy: number, mods: { shiftKey?: boolean } = {}): void {
  fireEvent.pointerDown(el, { clientX: 100, clientY: 100, button: 0, buttons: 1, ...mods })
  fireEvent.pointerMove(el, { clientX: 100 + dx, clientY: 100 + dy, buttons: 1, ...mods })
  fireEvent.pointerUp(el, { clientX: 100 + dx, clientY: 100 + dy, button: 0, buttons: 0, ...mods })
}

describe('dragging panels on the strip', () => {
  it('a press under the threshold stays a click', async () => {
    const { calls } = installFakeApi({ 'panels:place': () => undefined, 'panels:list': () => [a, b] })
    render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    drag(card(0), 2, 0)
    fireEvent.click(card(0))
    expect(placeCalls(calls)).toEqual([])
    expect(useAppStore.getState().selectedPanelIds).toEqual([a.id])
    expect(card(0).style.left).toBe('40px')
  })

  it('a drag saves the moved panel', async () => {
    const { calls } = installFakeApi({ 'panels:place': () => undefined, 'panels:list': () => moved(a.id, { x: 60, y: 80, width: 200 }) })
    render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    useAppStore.getState().selectPanel(b.id)
    drag(card(0), 20, 50)
    await waitFor(() => expect(placeCalls(calls)).toHaveLength(1))
    expect(placeCalls(calls)[0]).toEqual({ projectId, episodeId: EPISODE_ID, moves: [{ panelId: a.id, placement: { x: 60, y: 80, width: 200 } }] })
  })

  it('dragging a selected panel moves the whole selection by the same delta', async () => {
    const { calls } = installFakeApi({ 'panels:place': () => undefined, 'panels:list': () => [a, b] })
    render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    fireEvent.click(card(0))
    fireEvent.click(card(1), { shiftKey: true })
    drag(card(1), 10, -20)
    // The click that ends a drag must not collapse the selection to the card.
    fireEvent.click(card(1))
    expect(useAppStore.getState().selectedPanelIds).toEqual([a.id, b.id])
    await waitFor(() => expect(placeCalls(calls)).toHaveLength(1))
    expect(placeCalls(calls)[0]).toEqual({
      projectId,
      episodeId: EPISODE_ID,
      moves: [
        { panelId: a.id, placement: { x: 50, y: 10, width: 200 } },
        { panelId: b.id, placement: { x: 230, y: 480, width: 180 } }
      ]
    })
  })

  it('a group stops at the strip edge as one piece', async () => {
    const { calls } = installFakeApi({ 'panels:place': () => undefined, 'panels:list': () => [a, b] })
    render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    fireEvent.click(card(0))
    fireEvent.click(card(1), { shiftKey: true })
    // b's right edge is at 400, so the group can only go 40 right.
    drag(card(0), 300, 0)
    await waitFor(() => expect(placeCalls(calls)).toHaveLength(1))
    expect((placeCalls(calls)[0] as { moves: unknown[] }).moves).toEqual([
      { panelId: a.id, placement: { x: 80, y: 30, width: 200 } },
      { panelId: b.id, placement: { x: 260, y: 500, width: 180 } }
    ])
  })

  it('dragging an unselected panel selects it and moves only it', async () => {
    const { calls } = installFakeApi({ 'panels:place': () => undefined, 'panels:list': () => [a, b] })
    render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    useAppStore.getState().selectPanel(a.id)
    drag(card(1), 0, 40)
    await waitFor(() => expect(placeCalls(calls)).toHaveLength(1))
    expect((placeCalls(calls)[0] as { moves: unknown[] }).moves).toEqual([{ panelId: b.id, placement: { x: 220, y: 540, width: 180 } }])
    expect(useAppStore.getState().selectedPanelIds).toEqual([b.id])
  })

  it('a shift press does not start a drag', () => {
    const { calls } = installFakeApi({ 'panels:place': () => undefined, 'panels:list': () => [a, b] })
    render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    drag(card(0), 40, 40, { shiftKey: true })
    expect(placeCalls(calls)).toEqual([])
    expect(card(0).style.left).toBe('40px')
  })

  it('a press on the panel tools, or in a popover they open, does not start a drag', () => {
    const { calls } = installFakeApi({ 'panels:place': () => undefined, 'panels:list': () => [a, b] })
    useAppStore.getState().selectPanel(a.id)
    render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    drag(screen.getByRole('button', { name: 'Redraw' }), 40, 40)
    // The bar between its buttons, and the popover (a portal, but still the card's child in the React tree).
    drag(screen.getByRole('toolbar', { name: 'Panel tools' }), 40, 40)
    fireEvent.click(screen.getByRole('button', { name: 'Versions' }))
    drag(screen.getByRole('dialog', { name: 'Versions' }), 40, 40)
    expect(placeCalls(calls)).toEqual([])
    expect(card(0).style.left).toBe('40px')
  })

  it('the tools and popovers match the selector that skips presses on controls', () => {
    installFakeApi({ 'panels:list': () => [a, b] })
    useAppStore.getState().selectPanel(a.id)
    render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Versions' }))
    const controls = 'button, a, input, textarea, select, [role="dialog"], .panel-tools'
    for (const el of [screen.getByRole('toolbar', { name: 'Panel tools' }), screen.getByRole('dialog', { name: 'Versions' }), ...screen.getAllByRole('button')]) {
      expect(el.closest(controls), el.outerHTML.slice(0, 60)).not.toBeNull()
    }
  })

  it('resize keeps the aspect and saves width', async () => {
    const { calls } = installFakeApi({ 'panels:place': () => undefined, 'panels:list': () => moved(a.id, { x: 40, y: 30, width: 240 }) })
    render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    const handle = screen.getAllByTestId('panel-resize')[0]
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100, button: 0, buttons: 1 })
    fireEvent.pointerMove(handle, { clientX: 140, clientY: 100, buttons: 1 })
    // Only the width is set; the height follows the aspect (2:3), so the shape is kept.
    expect(card(0).style.width).toBe('240px')
    expect(card(0).style.height).toBe('360px')
    fireEvent.pointerUp(handle, { clientX: 140, clientY: 100, button: 0, buttons: 0 })
    await waitFor(() => expect(placeCalls(calls)).toHaveLength(1))
    expect(placeCalls(calls)[0]).toEqual({ projectId, episodeId: EPISODE_ID, moves: [{ panelId: a.id, placement: { x: 40, y: 30, width: 240 } }] })
    // The press on the handle is not a press on the card.
    expect(useAppStore.getState().selectedPanelIds).toEqual([])
  })

  it('a resize stops at the strip edge and at the smallest width', async () => {
    const { calls } = installFakeApi({ 'panels:place': () => undefined, 'panels:list': () => [a, b] })
    render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    const handle = screen.getAllByTestId('panel-resize')[0]
    drag(handle, 500, 0)
    drag(screen.getAllByTestId('panel-resize')[1], -500, 0)
    await waitFor(() => expect(placeCalls(calls)).toHaveLength(2))
    expect(placeCalls(calls).map((c) => (c as { moves: unknown[] }).moves)).toEqual([
      [{ panelId: a.id, placement: { x: 40, y: 30, width: 400 } }],
      [{ panelId: b.id, placement: { x: 220, y: 500, width: 80 } }]
    ])
  })

  it('arrow nudges 1, Shift 10, and saves after 300 ms', async () => {
    const { calls } = installFakeApi({ 'panels:place': () => undefined, 'panels:list': () => [a, b] })
    render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.keyDown(card(0), { key: 'ArrowRight' })
    fireEvent.keyDown(card(0), { key: 'ArrowRight' })
    fireEvent.keyDown(card(0), { key: 'ArrowDown', shiftKey: true })
    expect(card(0).style.left).toBe('42px')
    expect(card(0).style.top).toBe('40px')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299)
    })
    expect(placeCalls(calls)).toEqual([])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(placeCalls(calls)).toEqual([{ projectId, episodeId: EPISODE_ID, moves: [{ panelId: a.id, placement: { x: 42, y: 40, width: 200 } }] }])
  })

  it('an arrow key in a tool button is not a nudge', () => {
    installFakeApi({ 'panels:place': () => undefined, 'panels:list': () => [a, b] })
    useAppStore.getState().selectPanel(a.id)
    render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Redraw' }), { key: 'ArrowRight' })
    expect(card(0).style.left).toBe('40px')
  })

  it('the preview holds until the save lands', async () => {
    let land: () => void = () => undefined
    installFakeApi({
      'panels:place': () => new Promise<void>((resolve) => (land = resolve)),
      'panels:list': () => moved(a.id, { x: 60, y: 80, width: 200 })
    })
    const view = render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    drag(card(0), 20, 50)
    expect(card(0).style.left).toBe('60px')
    expect(card(0).style.top).toBe('80px')
    land()
    // The store reloads, and the strip follows it without a step back.
    await waitFor(() => expect(usePanelsStore.getState().panelsByEpisode[EPISODE_ID][0].placement).toEqual({ x: 60, y: 80, width: 200 }))
    view.rerender(<StripCanvas episodeId={EPISODE_ID} panels={usePanelsStore.getState().panelsByEpisode[EPISODE_ID]} />)
    expect(card(0).style.left).toBe('60px')
    expect(card(0).style.top).toBe('80px')
  })

  it('a failed save clears the preview and shows an error', async () => {
    installFakeApi({ 'panels:place': () => Promise.reject(new Error('disk full')), 'panels:list': () => [a, b] })
    render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    drag(card(0), 20, 50)
    expect(await screen.findByRole('alert')).toHaveTextContent('disk full')
    expect(card(0).style.left).toBe('40px')
    expect(card(0).style.top).toBe('30px')
  })

  it('a cancelled drag does not swallow the next click', async () => {
    installFakeApi({ 'panels:place': () => undefined, 'panels:list': () => [a, b] })
    render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    fireEvent.pointerDown(card(0), { clientX: 100, clientY: 100, button: 0, buttons: 1 })
    fireEvent.pointerMove(card(0), { clientX: 130, clientY: 100, buttons: 1 })
    fireEvent.pointerCancel(card(0), {})
    expect(card(0).style.left).toBe('40px')
    fireEvent.click(card(1))
    expect(useAppStore.getState().selectedPanelIds).toEqual([b.id])
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    expect(screen.getByRole('dialog', { name: 'Delete panel' })).toBeInTheDocument()
  })

  it('a click long after a drag is not swallowed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    installFakeApi({ 'panels:place': () => undefined, 'panels:list': () => [a, b] })
    render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    drag(card(0), 20, 0)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    fireEvent.click(card(1))
    expect(useAppStore.getState().selectedPanelIds).toEqual([b.id])
  })

  it('takes the pointer at the press, so a move off the card still reaches it', () => {
    installFakeApi({ 'panels:place': () => undefined, 'panels:list': () => [a, b] })
    useAppStore.getState().selectPanel(a.id)
    render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    const capture = vi.fn()
    card(0).setPointerCapture = capture
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Redraw' }), { pointerId: 7, button: 0, buttons: 1 })
    expect(capture).not.toHaveBeenCalled()
    fireEvent.pointerDown(card(0), { pointerId: 7, clientX: 100, clientY: 100, button: 0, buttons: 1 })
    expect(capture).toHaveBeenCalledWith(7)
  })

  it('a press and release without travel still selects and a double-click still opens', () => {
    installFakeApi({ 'panels:place': () => undefined, 'panels:list': () => [a, b] })
    render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    drag(card(0), 0, 0)
    fireEvent.click(card(0))
    expect(useAppStore.getState().selectedPanelIds).toEqual([a.id])
    fireEvent.doubleClick(card(0))
    expect(useAppStore.getState().focusedPanelId).toBe(a.id)
  })

  it('a second drag while the first save is pending starts from the preview, and the first save landing keeps it', async () => {
    const resolves: (() => void)[] = []
    const { calls } = installFakeApi({
      'panels:place': () => new Promise<void>((resolve) => resolves.push(resolve)),
      'panels:list': () => [a, b]
    })
    render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    drag(card(0), 20, 50)
    expect(card(0).style.left).toBe('60px')
    drag(card(0), 10, 0)
    expect(card(0).style.left).toBe('70px')
    expect(placeCalls(calls)[1]).toEqual({ projectId, episodeId: EPISODE_ID, moves: [{ panelId: a.id, placement: { x: 70, y: 80, width: 200 } }] })
    await act(async () => {
      resolves[0]()
    })
    expect(card(0).style.left).toBe('70px')
    expect(card(0).style.top).toBe('80px')
  })

  it('a card that leaves the strip mid-drag ends the gesture', () => {
    const { calls } = installFakeApi({ 'panels:place': () => undefined, 'panels:list': () => [b] })
    const view = render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    fireEvent.click(card(0))
    fireEvent.click(card(1), { shiftKey: true })
    fireEvent.pointerDown(card(1), { clientX: 100, clientY: 100, button: 0, buttons: 1 })
    fireEvent.pointerMove(card(1), { clientX: 120, clientY: 100, buttons: 1 })
    view.rerender(<StripCanvas episodeId={EPISODE_ID} panels={[b]} />)
    fireEvent.pointerUp(card(0), { clientX: 120, clientY: 100, button: 0, buttons: 0 })
    expect(placeCalls(calls)).toEqual([])
    expect(card(0).style.left).toBe('220px')
  })

  it('an arrow with Ctrl, Alt or Meta is not a nudge', () => {
    installFakeApi({ 'panels:place': () => undefined, 'panels:list': () => [a, b] })
    render(<StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />)
    for (const mod of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) fireEvent.keyDown(card(0), { key: 'ArrowRight', ...mod })
    expect(card(0).style.left).toBe('40px')
  })
})

describe('dragging while the pane scrolls', () => {
  /** The strip in a pane that scrolls, 600 px tall at the top of the window. jsdom has no layout, so the pane's box and scroll offset are set by hand. */
  function renderInPane(): { pane: HTMLElement; scrollTo: (top: number) => void } {
    render(
      <div data-testid="pane" style={{ overflowY: 'auto' }}>
        <StripCanvas episodeId={EPISODE_ID} panels={[a, b]} />
      </div>
    )
    const pane = screen.getByTestId('pane')
    let top = 0
    Object.defineProperty(pane, 'scrollTop', { get: () => top, set: (v: number) => (top = v), configurable: true })
    pane.getBoundingClientRect = () => ({ top: 0, bottom: 600, left: 0, right: 500, width: 500, height: 600, x: 0, y: 0, toJSON: () => ({}) })
    return {
      pane,
      scrollTo: (next) => {
        top = next
        fireEvent.scroll(pane)
      }
    }
  }

  it('a scroll during a drag moves the panel by the scrolled amount', async () => {
    const { calls } = installFakeApi({ 'panels:place': () => undefined, 'panels:list': () => [a, b] })
    const { scrollTo } = renderInPane()
    fireEvent.pointerDown(card(0), { clientX: 100, clientY: 300, button: 0, buttons: 1 })
    fireEvent.pointerMove(card(0), { clientX: 100, clientY: 320, buttons: 1 })
    scrollTo(200)
    expect(card(0).style.top).toBe('250px')
    // The pointer then moves on, and the scroll still counts.
    fireEvent.pointerMove(card(0), { clientX: 100, clientY: 330, buttons: 1 })
    fireEvent.pointerUp(card(0), { clientX: 100, clientY: 330, button: 0, buttons: 0 })
    await waitFor(() => expect(placeCalls(calls)).toHaveLength(1))
    expect(placeCalls(calls)[0]).toEqual({ projectId, episodeId: EPISODE_ID, moves: [{ panelId: a.id, placement: { x: 40, y: 260, width: 200 } }] })
  })

  it('a scroll alone does not start a drag', () => {
    const { calls } = installFakeApi({ 'panels:place': () => undefined, 'panels:list': () => [a, b] })
    const { scrollTo } = renderInPane()
    fireEvent.pointerDown(card(0), { clientX: 100, clientY: 300, button: 0, buttons: 1 })
    scrollTo(200)
    fireEvent.pointerUp(card(0), { clientX: 100, clientY: 300, button: 0, buttons: 0 })
    expect(placeCalls(calls)).toEqual([])
    expect(card(0).style.top).toBe('30px')
  })

  it('a drag near the pane edge scrolls the pane, and a panel dragged that way goes with it', async () => {
    vi.useFakeTimers()
    const { calls } = installFakeApi({ 'panels:place': () => undefined, 'panels:list': () => [a, b] })
    const { pane } = renderInPane()
    fireEvent.pointerDown(card(0), { clientX: 100, clientY: 300, button: 0, buttons: 1 })
    fireEvent.pointerMove(card(0), { clientX: 100, clientY: 590, buttons: 1 })
    await act(async () => {
      vi.advanceTimersByTime(160)
    })
    const scrolled = pane.scrollTop
    expect(scrolled).toBeGreaterThan(0)
    // The pointer has not moved, and the panel has followed the scroll.
    expect(parseInt(card(0).style.top, 10)).toBe(30 + 290 + scrolled)
    // Away from the edge the pane stays where it is.
    fireEvent.pointerMove(card(0), { clientX: 100, clientY: 300, buttons: 1 })
    await act(async () => {
      vi.advanceTimersByTime(160)
    })
    expect(pane.scrollTop).toBe(scrolled)
    fireEvent.pointerUp(card(0), { clientX: 100, clientY: 300, button: 0, buttons: 0 })
    expect(placeCalls(calls)).toHaveLength(1)
    expect((placeCalls(calls)[0] as { moves: { placement: { y: number } }[] }).moves[0].placement.y).toBe(30 + scrolled)
  })

  it('scrolls up near the top edge, and stops when the drag ends', async () => {
    vi.useFakeTimers()
    installFakeApi({ 'panels:place': () => undefined, 'panels:list': () => [a, b] })
    const { pane, scrollTo } = renderInPane()
    scrollTo(500)
    fireEvent.pointerDown(card(0), { clientX: 100, clientY: 300, button: 0, buttons: 1 })
    fireEvent.pointerMove(card(0), { clientX: 100, clientY: 10, buttons: 1 })
    await act(async () => {
      vi.advanceTimersByTime(160)
    })
    expect(pane.scrollTop).toBeLessThan(500)
    fireEvent.pointerUp(card(0), { clientX: 100, clientY: 10, button: 0, buttons: 0 })
    const stopped = pane.scrollTop
    await act(async () => {
      vi.advanceTimersByTime(160)
    })
    expect(pane.scrollTop).toBe(stopped)
  })
})
