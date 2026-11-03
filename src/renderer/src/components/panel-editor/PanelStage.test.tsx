import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DialogueLine, Panel, PanelCharacter, PanelPatch } from '@shared/types'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialCharactersState, useCharactersStore } from '../../stores/characters-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { character, PROJECT_ID as P } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { EPISODE_ID, panel } from '../../test/panel-fixtures'
import { toDrafts } from './dialogue-edits'
import { PanelStage } from './PanelStage'

const A = 'pnl_00000000aa'
const MINA = 'chr_0000000001'
const cast: PanelCharacter[] = [{ characterId: MINA, variationId: 'var_0000000001', action: '', expression: '', position: 'left' }]
const hello: DialogueLine = { id: 'dlg_0000000001', speakerId: MINA, kind: 'speech', text: 'Hello.', placement: null }
const night: DialogueLine = { id: 'dlg_0000000002', speakerId: null, kind: 'narration', text: 'Night fell.', placement: { x: 0.5, y: 0.8 } }

/** The panel as the main process holds it: what `panels:list` returns, and what `panels:update` changes. */
let stored: Panel
let ids = 0
/** While set, the next `panels:update` waits for it: a save that is still going. */
let gate: Promise<void> | null = null

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect
}

beforeEach(() => {
  stored = panel({ id: A, characters: cast, dialogue: [hello, night] })
  ids = 100
  gate = null
  useAppStore.setState({ ...initialAppState, projectId: P, sessionId: 'ses_0000000001', activeEpisodeId: EPISODE_ID, selectedPanelId: A })
  usePanelsStore.setState({ ...initialPanelsState, projectId: P, episodesLoaded: true, panelsByEpisode: { [EPISODE_ID]: [stored] } })
  useCharactersStore.setState({ ...initialCharactersState, projectId: P, characters: [character()], loaded: true })
  // jsdom has no layout: the panel is 400x600 at the origin, and every bubble is 100x50 at its top left corner.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.classList.contains('bubble') ? rect(0, 0, 100, 50) : rect(0, 0, 400, 600)
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/** An edit from elsewhere (the agent): the store and the main process both have it. */
function replaceStored(next: Panel): void {
  stored = next
  act(() => usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [next] } }))
}

/** The stage as the workspace mounts it: fed from the store, so saves and agent edits reach it. */
function Host({ onSelectLine, share = 1, slant }: { onSelectLine(i: number | null): void; share?: number; slant?: 'left' | 'right' }) {
  const open = usePanelsStore((s) => s.panelsByEpisode[EPISODE_ID]?.find((p) => p.id === A))
  return open === undefined ? null : <PanelStage panel={open} share={share} slant={slant} onSelectLine={onSelectLine} />
}

function mount(props: { share?: number; slant?: 'left' | 'right' } = {}) {
  const onSelectLine = vi.fn()
  const api = installFakeApi({
    'panels:update': async (req: { panelId: string; patch: PanelPatch }) => {
      const wait = gate
      gate = null
      if (wait !== null) await wait
      // Like the service: a dialogue save gives every line a new id.
      const dialogue = (req.patch.dialogue ?? []).map((line) => ({ ...line, id: `dlg_${String((ids += 1)).padStart(10, '0')}`, placement: line.placement ?? null }))
      stored = { ...stored, dialogue }
      return { panel: stored, warnings: [] }
    },
    'panels:list': () => [stored]
  })
  const view = render(<Host onSelectLine={onSelectLine} {...props} />)
  return { ...api, onSelectLine, unmount: view.unmount }
}

const stage = (): HTMLElement => screen.getByTestId('panel-stage')
const bubble = (i: number): HTMLElement => within(stage()).getByLabelText(`Line ${i + 1}`)
const textBox = (): HTMLElement => within(stage()).getByRole('textbox', { name: 'Line text' })
const media = (): HTMLElement => stage().querySelector<HTMLElement>('.panel-media')!
const updates = (calls: { channel: string; req: unknown }[]): PanelPatch[] =>
  calls.filter((c) => c.channel === 'panels:update').map((c) => (c.req as { patch: PanelPatch }).patch)

describe('PanelStage', () => {
  it('lays the panel out at its share of the reference row, with its frame, slant and gutter', () => {
    stored = { ...stored, frame: 'slanted', gutter: 'black' }
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [stored] } })
    mount({ share: 0.5, slant: 'right' })
    const shape = stage().querySelector<HTMLElement>('.panel-shape')!
    expect(shape.style.width).toBe('280px')
    expect(shape.style.getPropertyValue('--share')).toBe('0.5')
    expect(shape).toHaveAttribute('data-frame', 'slanted')
    expect(shape).toHaveAttribute('data-slant', 'right')
    expect(stage()).toHaveAttribute('data-gutter', 'black')
    expect(stage().querySelector<HTMLElement>('.stage-row')!.style.width).toBe('560px')
  })

  it('fades a tall panel, whatever its frame says', () => {
    stored = { ...stored, aspect: '1:2', frame: 'bordered' }
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [stored] } })
    mount()
    expect(stage().querySelector('.panel-shape')).toHaveAttribute('data-frame', 'fade')
  })

  it('scales the panel to fit the slot, and keeps the last scale while the slot is unmeasured', () => {
    let width = 280
    let resized: () => void = () => undefined
    vi.spyOn(window, 'ResizeObserver').mockImplementation(function (callback: ResizeObserverCallback) {
      resized = () => callback([], {} as ResizeObserver)
      return { observe: () => undefined, unobserve: () => undefined, disconnect: () => undefined }
    } as unknown as typeof ResizeObserver)
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
      return this.classList.contains('panel-stage') ? width : 0
    })
    // The panel's natural size at the reference row: 560 wide, 2:3.
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('panel-shape') ? 560 : 0
    })
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('panel-shape') ? 840 : 0
    })
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(2000)
    mount()
    const row = (): HTMLElement => stage().querySelector<HTMLElement>('.stage-row')!
    const fit = (): HTMLElement => stage().querySelector<HTMLElement>('.stage-fit')!
    expect(row().style.transform).toBe('scale(0.5)')
    expect(fit().style.width).toBe('280px')
    expect(fit().style.height).toBe('420px')

    // At most 62% of the window's height.
    width = 2000
    act(() => resized())
    expect(row().style.transform).toBe(`scale(${(2000 * 0.62) / 840})`)

    width = 0
    act(() => resized())
    expect(row().style.transform).toBe(`scale(${(2000 * 0.62) / 840})`)
  })

  it('selects a bubble on click, without selecting the panel', async () => {
    const selectPanel = vi.spyOn(useAppStore.getState(), 'selectPanel')
    const { onSelectLine, calls } = mount()
    await userEvent.click(bubble(0))
    expect(bubble(0)).toHaveAttribute('data-selected', 'true')
    expect(bubble(1)).toHaveAttribute('data-selected', 'false')
    expect(onSelectLine).toHaveBeenLastCalledWith(0)
    expect(selectPanel).not.toHaveBeenCalled()
    expect(useAppStore.getState().selectedPanelId).toBe(A)
    expect(updates(calls)).toEqual([])
  })

  it('clears the selection on a click on the empty stage', async () => {
    const { onSelectLine } = mount()
    await userEvent.click(bubble(1))
    await userEvent.click(media())
    expect(bubble(1)).toHaveAttribute('data-selected', 'false')
    expect(onSelectLine).toHaveBeenLastCalledWith(null)
  })

  it('treats a press that moves under 3px as a click, and saves a drag where it was released', async () => {
    const { calls } = mount()
    fireEvent.pointerDown(bubble(0), { clientX: 50, clientY: 25 })
    fireEvent.pointerMove(stage(), { clientX: 52, clientY: 25 })
    fireEvent.pointerUp(stage(), { clientX: 52, clientY: 25 })
    await act(async () => undefined)
    expect(updates(calls)).toEqual([])
    expect(bubble(0)).toHaveAttribute('data-selected', 'true')

    // Pressed at the bubble's centre, so it follows the pointer exactly.
    fireEvent.pointerDown(bubble(0), { clientX: 50, clientY: 25 })
    fireEvent.pointerMove(stage(), { clientX: 300, clientY: 150 })
    expect(bubble(0)).toHaveAttribute('data-dragging', 'true')
    expect(bubble(0)).toHaveStyle({ left: '75%', top: '25%' })
    fireEvent.pointerUp(stage(), { clientX: 300, clientY: 150 })
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    expect(updates(calls)[0]).toEqual({ dialogue: [{ ...toDrafts([hello])[0], placement: { x: 0.75, y: 0.25 } }, toDrafts([night])[0]] })
    await waitFor(() => expect(stored.dialogue[0].id).not.toBe(hello.id))
    // The saved panel's lines have new ids: the bubble is found again by its index, placed, and keeps the focus.
    expect(bubble(0)).toHaveStyle({ left: '75%', top: '25%' })
    expect(bubble(0)).not.toHaveAttribute('data-dragging')
    expect(bubble(0)).toHaveFocus()
  })

  it('clamps a drag so the whole bubble stays inside the panel', async () => {
    const { calls } = mount()
    fireEvent.pointerDown(bubble(0), { clientX: 50, clientY: 25 })
    fireEvent.pointerMove(stage(), { clientX: 900, clientY: -40 })
    fireEvent.pointerUp(stage(), { clientX: 900, clientY: -40 })
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    expect(updates(calls)[0].dialogue?.[0].placement).toEqual({ x: 0.875, y: 0.0417 })
  })

  it('nudges a selected placed bubble with the arrow keys, and saves 300ms after the last key', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { calls } = mount()
    act(() => bubble(1).focus())
    expect(bubble(1)).toHaveAttribute('data-selected', 'true')
    fireEvent.keyDown(bubble(1), { key: 'ArrowRight' })
    expect(bubble(1)).toHaveStyle({ left: '51%' })
    await act(() => vi.advanceTimersByTimeAsync(299))
    expect(updates(calls)).toEqual([])
    await act(() => vi.advanceTimersByTimeAsync(1))
    vi.useRealTimers()
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    expect(updates(calls)[0]).toEqual({ dialogue: [toDrafts([hello])[0], { ...toDrafts([night])[0], placement: { x: 0.51, y: 0.8 } }] })
  })

  it('runs quick nudges into one save, a big step with Shift', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { calls } = mount()
    act(() => bubble(1).focus())
    fireEvent.keyDown(bubble(1), { key: 'ArrowUp' })
    await act(() => vi.advanceTimersByTimeAsync(200))
    fireEvent.keyDown(bubble(1), { key: 'ArrowLeft', shiftKey: true })
    await act(() => vi.advanceTimersByTimeAsync(200))
    expect(updates(calls)).toEqual([])
    await act(() => vi.advanceTimersByTimeAsync(100))
    vi.useRealTimers()
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    expect(updates(calls)[0].dialogue?.[1].placement).toEqual({ x: 0.45, y: 0.79 })
  })

  it('saves a run of nudges still waiting when the stage goes away', async () => {
    const { calls, unmount } = mount()
    act(() => bubble(1).focus())
    fireEvent.keyDown(bubble(1), { key: 'ArrowDown' })
    unmount()
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    expect(updates(calls)[0].dialogue?.[1].placement).toEqual({ x: 0.5, y: 0.81 })
  })

  it('nudges an automatic bubble from where it is drawn', async () => {
    const { calls } = mount()
    act(() => bubble(0).focus())
    fireEvent.keyDown(bubble(0), { key: 'ArrowDown' })
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    // Its centre is (50, 25) of the 400x600 panel.
    expect(updates(calls)[0].dialogue?.[0].placement).toEqual({ x: 0.125, y: 0.0517 })
  })

  it('retypes a bubble on double-click, and saves the text on Enter', async () => {
    const { calls } = mount()
    await userEvent.dblClick(bubble(0))
    expect(textBox()).toHaveValue('Hello.')
    expect(textBox()).toHaveFocus()
    await userEvent.clear(textBox())
    await userEvent.type(textBox(), 'Run!{Enter}')
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    expect(updates(calls)[0]).toEqual({ dialogue: [{ ...toDrafts([hello])[0], text: 'Run!' }, toDrafts([night])[0]] })
    expect(within(stage()).queryByRole('textbox')).toBeNull()
    await waitFor(() => expect(bubble(0)).toHaveTextContent('Run!'))
  })

  it('opens the text of a selected bubble on Enter, keeps Backspace and Shift+Enter in the text, and saves on blur', async () => {
    const { calls } = mount()
    act(() => bubble(1).focus())
    await userEvent.keyboard('{Enter}')
    expect(textBox()).toHaveValue('Night fell.')
    await userEvent.keyboard('{Backspace}{Shift>}{Enter}{/Shift}Again')
    expect(textBox()).toHaveValue('Night fell\nAgain')
    expect(updates(calls)).toEqual([])
    act(() => textBox().blur())
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    expect(updates(calls)[0].dialogue).toEqual([toDrafts([hello])[0], { ...toDrafts([night])[0], text: 'Night fell\nAgain' }])
  })

  it('cancels a text edit on Escape, and keeps the old text when the new one is empty', async () => {
    const { calls } = mount()
    await userEvent.dblClick(bubble(0))
    await userEvent.type(textBox(), ' Bye.')
    expect(fireEvent.keyDown(textBox(), { key: 'Escape' })).toBe(false)
    expect(within(stage()).queryByRole('textbox')).toBeNull()
    expect(bubble(0)).toHaveTextContent('Hello.')

    await userEvent.dblClick(bubble(0))
    await userEvent.clear(textBox())
    await userEvent.type(textBox(), '   {Enter}')
    expect(within(stage()).queryByRole('textbox')).toBeNull()
    expect(bubble(0)).toHaveTextContent('Hello.')
    await act(async () => undefined)
    expect(updates(calls)).toEqual([])
  })

  it('deletes a selected bubble with Delete', async () => {
    const { calls, onSelectLine } = mount()
    act(() => bubble(0).focus())
    await userEvent.keyboard('{Delete}')
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    expect(updates(calls)[0]).toEqual({ dialogue: toDrafts([night]) })
    expect(onSelectLine).toHaveBeenLastCalledWith(null)
    await waitFor(() => expect(within(stage()).queryByLabelText('Line 2')).toBeNull())
    expect(bubble(0)).toHaveTextContent('Night fell.')
  })

  it('adds a line where the empty panel is double-clicked, spoken by the first of the cast', async () => {
    const { calls } = mount()
    fireEvent.doubleClick(stage().querySelector('.dialogue-overlay')!, { clientX: 200, clientY: 300 })
    expect(textBox()).toHaveFocus()
    expect(bubble(2)).toHaveStyle({ left: '50%', top: '50%' })
    await userEvent.type(textBox(), 'Hey{Enter}')
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    expect(updates(calls)[0]).toEqual({
      dialogue: [...toDrafts([hello, night]), { speakerId: MINA, kind: 'speech', text: 'Hey', placement: { x: 0.5, y: 0.5 } }]
    })
    await waitFor(() => expect(stored.dialogue).toHaveLength(3))
    expect(bubble(2)).toHaveTextContent('Hey')
  })

  it('adds narration to a panel with no cast and no lines, and drops a new line left empty', async () => {
    stored = { ...stored, characters: [], dialogue: [] }
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [stored] } })
    const { calls } = mount()
    fireEvent.doubleClick(media(), { clientX: 100, clientY: 150 })
    await userEvent.type(textBox(), '{Enter}')
    expect(within(stage()).queryByLabelText('Line 1')).toBeNull()

    fireEvent.doubleClick(media(), { clientX: 100, clientY: 150 })
    await userEvent.type(textBox(), 'Later.{Enter}')
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    expect(updates(calls)[0]).toEqual({ dialogue: [{ speakerId: null, kind: 'narration', text: 'Later.', placement: { x: 0.25, y: 0.25 } }] })
  })

  it('builds a save sent while another is still going on top of that one, and shows both meanwhile', async () => {
    let release: () => void = () => undefined
    gate = new Promise((resolve) => (release = resolve))
    const { calls } = mount()
    fireEvent.pointerDown(bubble(0), { clientX: 50, clientY: 25 })
    fireEvent.pointerMove(stage(), { clientX: 300, clientY: 150 })
    fireEvent.pointerUp(stage(), { clientX: 300, clientY: 150 })
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    act(() => bubble(1).focus())
    fireEvent.keyDown(bubble(1), { key: 'Delete' })
    expect(bubble(0)).toHaveStyle({ left: '75%', top: '25%' })
    expect(within(stage()).queryByLabelText('Line 2')).toBeNull()
    await act(async () => undefined)
    expect(updates(calls)).toHaveLength(1)

    await act(async () => release())
    await waitFor(() => expect(updates(calls)).toHaveLength(2))
    expect(updates(calls)[1]).toEqual({ dialogue: [{ ...toDrafts([hello])[0], placement: { x: 0.75, y: 0.25 } }] })
  })

  it('sends nothing when the line changed under a drag, and says so (Review Focus 2)', async () => {
    const { calls } = mount()
    fireEvent.pointerDown(bubble(0), { clientX: 50, clientY: 25 })
    fireEvent.pointerMove(stage(), { clientX: 300, clientY: 150 })
    // The agent rewrites the line while the user holds it.
    replaceStored({ ...stored, dialogue: [{ ...hello, id: 'dlg_0000000009', text: 'Goodbye.' }, night] })
    fireEvent.pointerUp(stage(), { clientX: 300, clientY: 150 })
    expect(await within(stage().parentElement!).findByText('This line changed while you were editing it.')).toBeInTheDocument()
    expect(updates(calls)).toEqual([])
    expect(bubble(0)).not.toHaveClass('bubble-placed')
    expect(bubble(0)).toHaveTextContent('Goodbye.')
  })

  it('sends nothing when the line changed under a text edit', async () => {
    const { calls } = mount()
    await userEvent.dblClick(bubble(0))
    await userEvent.type(textBox(), ' Again.')
    replaceStored({ ...stored, dialogue: [{ ...hello, id: 'dlg_0000000009', kind: 'thought' }, night] })
    fireEvent.keyDown(textBox(), { key: 'Enter' })
    expect(await within(stage().parentElement!).findByText('This line changed while you were editing it.')).toBeInTheDocument()
    expect(updates(calls)).toEqual([])
  })

  it('clears the selection on Escape, and lets the next Escape through', async () => {
    const { onSelectLine } = mount()
    act(() => bubble(0).focus())
    expect(fireEvent.keyDown(bubble(0), { key: 'Escape' })).toBe(false)
    expect(bubble(0)).toHaveAttribute('data-selected', 'false')
    expect(onSelectLine).toHaveBeenLastCalledWith(null)
    expect(stage()).toHaveFocus()
    expect(fireEvent.keyDown(stage(), { key: 'Escape' })).toBe(true)
  })

  it('shows a refused save', async () => {
    installFakeApi({
      'panels:update': () => {
        throw new Error('Dialogue is too long')
      }
    })
    render(<Host onSelectLine={() => undefined} />)
    act(() => bubble(0).focus())
    fireEvent.keyDown(bubble(0), { key: 'Delete' })
    expect(await within(stage().parentElement!).findByRole('alert')).toHaveTextContent('Dialogue is too long')
    expect(bubble(1)).toBeInTheDocument()
  })

  it('never calls a model: selecting, dragging, nudging, retyping, adding and deleting only save the dialogue (No AI)', async () => {
    const { calls } = mount()
    await userEvent.click(bubble(1))
    fireEvent.pointerDown(bubble(0), { clientX: 50, clientY: 25 })
    fireEvent.pointerMove(stage(), { clientX: 300, clientY: 150 })
    fireEvent.pointerUp(stage(), { clientX: 300, clientY: 150 })
    await waitFor(() => expect(updates(calls)).toHaveLength(1))

    act(() => bubble(1).focus())
    fireEvent.keyDown(bubble(1), { key: 'ArrowUp' })
    await waitFor(() => expect(updates(calls)).toHaveLength(2))

    await userEvent.dblClick(bubble(0))
    await userEvent.clear(textBox())
    await userEvent.type(textBox(), 'Go.{Enter}')
    await waitFor(() => expect(updates(calls)).toHaveLength(3))

    fireEvent.doubleClick(stage().querySelector('.dialogue-overlay')!, { clientX: 200, clientY: 300 })
    await userEvent.type(textBox(), 'Hey{Enter}')
    await waitFor(() => expect(updates(calls)).toHaveLength(4))

    await waitFor(() => expect(stored.dialogue).toHaveLength(3))
    act(() => bubble(1).focus())
    fireEvent.keyDown(bubble(1), { key: 'Delete' })
    await waitFor(() => expect(updates(calls)).toHaveLength(5))
    await waitFor(() => expect(stored.dialogue).toHaveLength(2))

    expect([...new Set(calls.map((c) => c.channel))].sort()).toEqual(['panels:list', 'panels:update'])
    for (const { channel } of calls) expect(channel).not.toMatch(/^(panelChat|agent):|^panels:(generate|editImage|upload)/)
  })
})
