import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DialogueLine, Panel, PanelPatch } from '@shared/types'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialCharactersState, useCharactersStore } from '../../stores/characters-store'
import { initialItemsState, useItemsStore } from '../../stores/items-store'
import { initialLocationsState, useLocationsStore } from '../../stores/locations-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { character, PROJECT_ID as P } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { EPISODE_ID, panel } from '../../test/panel-fixtures'
import { resolveStrip } from '@shared/strip-canvas'
import { StripBubbles } from './StripBubbles'
import { StripCanvas } from './StripCanvas'

const A = 'pnl_00000000aa'
const B = 'pnl_00000000bb'
const hello: DialogueLine = { id: 'dlg_0000000001', speakerId: null, kind: 'narration', text: 'Hello.', placement: { x: 0.5, y: 2 }, style: null, tail: null }

let stored: Panel[]
let ids = 0

/** The app's stylesheet. The web tsconfig has no node types. */
async function appCss(): Promise<string> {
  const specifier: string = 'node:fs'
  const fs = (await import(/* @vite-ignore */ specifier)) as { readFileSync(file: string, encoding: 'utf8'): string }
  return fs.readFileSync('src/renderer/src/styles.css', 'utf8')
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect
}

beforeEach(() => {
  ids = 100
  stored = [panel({ id: A, dialogue: [hello], placement: { x: 40, y: 30, width: 200 } }), panel({ id: B, placement: { x: 220, y: 500, width: 180 } })]
  useAppStore.setState({ ...initialAppState, projectId: P, activeEpisodeId: EPISODE_ID })
  usePanelsStore.setState({ ...initialPanelsState, projectId: P, episodesLoaded: true, panelsByEpisode: { [EPISODE_ID]: stored } })
  useCharactersStore.setState({ ...initialCharactersState, projectId: P, characters: [character()], loaded: true })
  useItemsStore.setState({ ...initialItemsState, projectId: P, items: [], loaded: true })
  useLocationsStore.setState({ ...initialLocationsState, projectId: P, locations: [], loaded: true })
  // jsdom has no layout: the strip is 440 wide, a panel's art is 200x300 at the origin, and every bubble is 100x50.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.classList.contains('bubble')) return rect(0, 0, 100, 50)
    if (this.classList.contains('strip-canvas')) return rect(0, 0, 440, 3000)
    return rect(0, 0, 200, 300)
  })
})
afterEach(() => vi.restoreAllMocks())

function mount() {
  const api = installFakeApi({
    'panels:list': () => stored,
    'panels:update': (req: { panelId: string; patch: PanelPatch }) => {
      stored = stored.map((p) =>
        p.id !== req.panelId
          ? p
          : {
              ...p,
              dialogue: (req.patch.dialogue ?? p.dialogue).map((line) => ({ ...line, id: `dlg_${String((ids += 1)).padStart(10, '0')}`, placement: line.placement ?? null, style: line.style ?? null, tail: line.tail ?? null }))
            }
      ) as Panel[]
      return { panel: stored.find((p) => p.id === req.panelId), warnings: [] }
    },
    'panels:place': () => undefined
  })
  function Host() {
    const panels = usePanelsStore((s) => s.panelsByEpisode[EPISODE_ID] ?? [])
    return <StripCanvas episodeId={EPISODE_ID} panels={panels} />
  }
  render(<Host />)
  return api
}

const layer = (id: string): HTMLElement => document.querySelector<HTMLElement>(`[data-testid="strip-bubbles"][data-panel-id="${id}"]`)!
const bubble = (i = 0): HTMLElement => within(layer(A)).getByLabelText(`Line ${i + 1}`)
const card = (id: string): HTMLElement => document.querySelector<HTMLElement>(`[data-testid="panel-card"][data-panel-id="${id}"]`)!
const updates = (calls: { channel: string; req: unknown }[]): PanelPatch[] => calls.filter((c) => c.channel === 'panels:update').map((c) => (c.req as { patch: PanelPatch }).patch)

describe('StripBubbles', () => {
  it('draws a placed bubble below its panel', () => {
    mount()
    const wrapper = layer(A)
    expect(wrapper.style.left).toBe('40px')
    expect(wrapper.style.top).toBe('30px')
    expect(wrapper.style.width).toBe('200px')
    expect(wrapper.style.getPropertyValue('--share')).toBe(String(200 / 440))
    // Not inside the card, and 2 panel heights down: below the panel.
    expect(card(A)).not.toContainElement(bubble())
    expect(bubble().style.top).toBe('200%')
    expect(bubble().style.left).toBe('50%')
    // The card draws the art alone: the lettering is the layer's.
    expect(within(card(A)).queryByText('Hello.')).toBeNull()
  })

  it('draws a bubble inside the strip when its stored offset would land past the edge, and keeps the stored value', () => {
    // 2.95 panel widths from the panel's left edge at 40 px, in a panel 200 px wide: 630 px on a strip 440 wide.
    stored = [{ ...stored[0], dialogue: [{ ...hello, placement: { x: 2.95, y: 0.5 } }] }, stored[1]]
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: stored } })
    mount()
    expect(bubble().style.left).toBe('200%')
    expect(usePanelsStore.getState().panelsByEpisode[EPISODE_ID][0].dialogue[0].placement).toEqual({ x: 2.95, y: 0.5 })
  })

  it('a bubble left of the strip is drawn at its left edge', () => {
    stored = [{ ...stored[0], dialogue: [{ ...hello, placement: { x: -0.7, y: 0.5 } }] }, stored[1]]
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: stored } })
    mount()
    expect(bubble().style.left).toBe('-20%')
  })

  it('a bubble can be pressed on a panel that is not selected', () => {
    mount()
    expect(useAppStore.getState().selectedPanelIds).toEqual([])
    fireEvent.pointerDown(bubble(), { clientX: 50, clientY: 25, button: 0, buttons: 1 })
    expect(useAppStore.getState().selectedPanelIds).toEqual([A])
    expect(bubble()).toHaveAttribute('data-selected', 'true')
    expect(within(layer(A)).getByRole('toolbar', { name: 'Panel tools' })).toBeInTheDocument()
  })

  describe('the empty layer', () => {
    let sheet: HTMLStyleElement
    beforeEach(async () => {
      sheet = document.createElement('style')
      sheet.textContent = await appCss()
      document.head.append(sheet)
    })
    afterEach(() => sheet.remove())

    it('lets clicks through to the panel', () => {
      mount()
      expect(getComputedStyle(layer(A)).pointerEvents).toBe('none')
      expect(getComputedStyle(layer(A).querySelector('.dialogue-overlay')!).pointerEvents).toBe('none')
      expect(getComputedStyle(bubble()).pointerEvents).toBe('auto')
    })

    it('shows the panel art whole under it, and its bubbles past its edge', () => {
      mount()
      expect(getComputedStyle(layer(A).querySelector('.panel-media')!).overflow).toBe('visible')
      expect(getComputedStyle(card(A).querySelector('.panel-media')!).overflow).toBe('clip')
    })
  })

  it('pressing a bubble does not start a panel drag, or clear the selection', () => {
    const { calls } = mount()
    act(() => useAppStore.getState().selectPanel(B))
    fireEvent.pointerDown(bubble(), { clientX: 50, clientY: 25, button: 0, buttons: 1, pointerId: 1 })
    fireEvent.pointerMove(layer(A), { clientX: 300, clientY: 400, buttons: 1, pointerId: 1 })
    fireEvent.pointerMove(card(A), { clientX: 400, clientY: 500, buttons: 1, pointerId: 1 })
    fireEvent.click(bubble())
    fireEvent.pointerUp(layer(A), { clientX: 300, clientY: 400, pointerId: 1 })
    expect(calls.filter((c) => c.channel === 'panels:place')).toHaveLength(0)
    expect(card(A).style.left).toBe('40px')
    // Its panel is the selection now, not nothing.
    expect(useAppStore.getState().selectedPanelIds).toEqual([A])
  })

  it('a drag below the panel saves a placement past 1', async () => {
    const { calls } = mount()
    fireEvent.pointerDown(bubble(), { clientX: 50, clientY: 25, button: 0, buttons: 1, pointerId: 1 })
    // The bubble's centre is at (50, 25) in the mock; the pointer takes it to y 900, a long way under the 300 px panel.
    fireEvent.pointerMove(layer(A), { clientX: 100, clientY: 900, buttons: 1, pointerId: 1 })
    fireEvent.pointerUp(layer(A), { clientX: 100, clientY: 900, pointerId: 1 })
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    expect(updates(calls)[0].dialogue![0].placement).toEqual({ x: 0.5, y: 3 })
  })

  it('double-clicking a bubble retypes it on the strip', async () => {
    const { calls } = mount()
    await userEvent.dblClick(bubble())
    const box = within(layer(A)).getByRole('textbox', { name: 'Line text' })
    expect(box).toHaveFocus()
    await userEvent.clear(box)
    await userEvent.type(box, 'Later.{Enter}')
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    expect(updates(calls)[0].dialogue![0]).toMatchObject({ text: 'Later.' })
    // The card behind did not take the double-click for its own and open focus mode.
    expect(useAppStore.getState().focusedPanelId).toBeNull()
  })

  /** A press and release on the bubble with no travel: a click. */
  const click = (): void => {
    fireEvent.pointerDown(bubble(), { clientX: 50, clientY: 25, button: 0, buttons: 1 })
    fireEvent.pointerUp(bubble(), { clientX: 50, clientY: 25, button: 0 })
  }

  it('dragging a bubble opens no popover, only selects it', () => {
    mount()
    fireEvent.pointerDown(bubble(), { clientX: 50, clientY: 25, button: 0, buttons: 1 })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.pointerMove(layer(A), { clientX: 100, clientY: 400, buttons: 1 })
    fireEvent.pointerUp(layer(A), { clientX: 100, clientY: 400 })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(bubble()).toHaveAttribute('data-selected', 'true')
  })

  it('the popover opened by a click does not cover the selected bubble', async () => {
    const was = vi.mocked(Element.prototype.getBoundingClientRect).getMockImplementation()!
    vi.mocked(Element.prototype.getBoundingClientRect).mockImplementation(function (this: Element) {
      // The Lines button is at the foot of the panel; the bubble is just under it, where the popover would open.
      if (this instanceof HTMLButtonElement && this.getAttribute('aria-label') === 'Lines') return rect(100, 400, 28, 28)
      if (this.classList.contains('bubble')) return rect(60, 460, 100, 50)
      if (this instanceof HTMLElement && this.classList.contains('tool-popover')) {
        const top = this.style.top !== '' ? parseFloat(this.style.top) : window.innerHeight - parseFloat(this.style.bottom) - 200
        return rect(parseFloat(this.style.left), top, parseFloat(this.style.width), 200)
      }
      return was.call(this)
    })
    mount()
    click()
    const popover = await screen.findByRole('dialog', { name: 'Lines' })
    await waitFor(() => {
      const p = popover.getBoundingClientRect()
      const b = bubble().getBoundingClientRect()
      const apart = p.bottom <= b.top || p.top >= b.bottom || p.right <= b.left || p.left >= b.right
      expect(apart).toBe(true)
    })
  })

  it('selecting a bubble opens its text and style controls in the panel\'s tools', async () => {
    mount()
    click()
    const popover = await screen.findByRole('dialog', { name: 'Lines' })
    const row = within(popover).getAllByRole('listitem').find((li) => li.getAttribute('aria-current') === 'true')!
    expect(within(row).getByDisplayValue('Hello.')).toBeInTheDocument()
    expect(within(row).getByText('Reset to auto')).toBeInTheDocument()
    // The bubble keeps its selection, and the focus for its keys.
    expect(bubble()).toHaveAttribute('data-selected', 'true')
    expect(popover).not.toContainElement(document.activeElement as HTMLElement)
  })

  it('opening another tool lets go of the bubble, so it opens on its own tab', async () => {
    mount()
    click()
    await screen.findByRole('dialog', { name: 'Lines' })
    await userEvent.click(screen.getByRole('button', { name: 'Cast' }))
    expect(await screen.findByRole('dialog', { name: 'Cast' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Lines' })).toBeNull()
    expect(bubble()).toHaveAttribute('data-selected', 'false')
  })

  it('Add bubble adds a line on the strip', async () => {
    const { calls } = mount()
    act(() => useAppStore.getState().selectPanel(A))
    await userEvent.click(within(layer(A)).getByRole('button', { name: 'Add bubble' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Caption' }))
    const box = within(layer(A)).getByRole('textbox', { name: 'Line text' })
    await userEvent.type(box, 'Meanwhile.{Enter}')
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    expect(updates(calls)[0].dialogue!.map((l) => l.text)).toEqual(['Hello.', 'Meanwhile.'])
  })

  it('a selected bubble is let go when another panel is selected', () => {
    mount()
    fireEvent.pointerDown(bubble(), { clientX: 50, clientY: 25, button: 0, buttons: 1 })
    expect(bubble()).toHaveAttribute('data-selected', 'true')
    act(() => useAppStore.getState().selectPanel(B))
    expect(bubble()).toHaveAttribute('data-selected', 'false')
  })

  it('has no tools while a panel is open in focus mode, or with several panels selected', () => {
    mount()
    act(() => useAppStore.getState().selectPanel(A))
    expect(screen.getByRole('toolbar', { name: 'Panel tools' })).toBeInTheDocument()
    act(() => useAppStore.getState().focusPanel(A))
    expect(screen.queryByRole('toolbar', { name: 'Panel tools' })).toBeNull()
    act(() => useAppStore.getState().focusPanel(null))
    act(() => useAppStore.getState().togglePanelSelection(B))
    expect(screen.queryByRole('toolbar', { name: 'Panel tools' })).toBeNull()
  })

  it.each(['Focus', 'Sketch'])('%s closes an open popover: focus mode holds the only editor of the panel', async (name) => {
    mount()
    act(() => useAppStore.getState().selectPanel(A))
    await userEvent.click(screen.getByRole('button', { name: 'Scene' }))
    expect(screen.getByRole('dialog', { name: 'Scene' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name }))
    expect(useAppStore.getState().focusedPanelId).toBe(A)
    expect(screen.queryByRole('dialog', { name: 'Scene' })).toBeNull()
    expect(screen.queryByRole('toolbar', { name: 'Panel tools' })).toBeNull()
  })

  it('clicking a tool does not select, open or clear anything on the strip', async () => {
    mount()
    act(() => useAppStore.getState().selectPanel(A))
    await userEvent.dblClick(screen.getByRole('button', { name: 'Redraw' }))
    expect(useAppStore.getState().focusedPanelId).toBeNull()
    expect(useAppStore.getState().selectedPanelIds).toEqual([A])
  })

  it('a click on a bubble does not clear the selection the strip would clear on empty space', async () => {
    mount()
    await userEvent.click(bubble())
    expect(useAppStore.getState().selectedPanelIds).toEqual([A])
  })

  it('draws the lettering alone, with no handlers, for the export', () => {
    const placed = resolveStrip(stored)
    const canvas = { current: null }
    render(<StripBubbles placed={placed} canvas={canvas} mode="export" />)
    expect(screen.getByText('Hello.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Line 1')).toBeNull()
    expect(screen.queryByRole('toolbar')).toBeNull()
  })

  it('follows its card while the card is dragged', () => {
    mount()
    fireEvent.pointerDown(card(A), { clientX: 100, clientY: 100, button: 0, buttons: 1, pointerId: 2 })
    fireEvent.pointerMove(card(A), { clientX: 130, clientY: 160, buttons: 1, pointerId: 2 })
    expect(card(A).style.left).toBe('70px')
    expect(layer(A).style.left).toBe('70px')
    expect(layer(A).style.top).toBe('90px')
  })
})
