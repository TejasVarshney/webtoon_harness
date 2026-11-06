import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DialogueLine, Panel, PanelCharacter, PanelPatch } from '@shared/types'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialCharactersState, useCharactersStore } from '../../stores/characters-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { character, PROJECT_ID as P } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { EPISODE_ID, panel, panelVersion } from '../../test/panel-fixtures'
import { NUDGE_COMMIT_MS } from './bubble-placement'
import { toDrafts } from './dialogue-edits'
import { PanelStage } from './PanelStage'
import { useDialogueSaver } from './use-dialogue-saver'

const A = 'pnl_00000000aa'
const MINA = 'chr_0000000001'
const cast: PanelCharacter[] = [{ characterId: MINA, variationId: 'var_0000000001', action: '', expression: '', position: 'left' }]
const hello: DialogueLine = { id: 'dlg_0000000001', speakerId: MINA, kind: 'speech', text: 'Hello.', placement: null, style: null, tail: null }
const night: DialogueLine = { id: 'dlg_0000000002', speakerId: null, kind: 'narration', text: 'Night fell.', placement: { x: 0.5, y: 0.8 }, style: null, tail: null }

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

/** What the panel's dialogue saver reports, as the Lines tab would show it (the stage shows no message of its own). */
function Saver() {
  const { conflict, error } = useDialogueSaver(A)
  return <output data-testid="saver">{conflict ? 'conflict' : (error ?? '')}</output>
}

/** The stage as the workspace mounts it: fed from the store, so saves and agent edits reach it. */
function Host({ onSelectLine, share = 1, slant, selectedLine }: { onSelectLine(i: number | null): void; share?: number; slant?: 'left' | 'right'; selectedLine?: number | null }) {
  const open = usePanelsStore((s) => s.panelsByEpisode[EPISODE_ID]?.find((p) => p.id === A))
  return open === undefined ? null : (
    <>
      <PanelStage panel={open} share={share} slant={slant} selectedLine={selectedLine} onSelectLine={onSelectLine} />
      <Saver />
    </>
  )
}

function mount(props: { share?: number; slant?: 'left' | 'right' } = {}) {
  const onSelectLine = vi.fn()
  const api = installFakeApi({
    'panels:update': async (req: { panelId: string; patch: PanelPatch }) => {
      const wait = gate
      gate = null
      if (wait !== null) await wait
      // Like the service: a dialogue save gives every line a new id.
      // A line sent without a look takes the stored line's at its index, so a test can catch a look moving between lines.
      const dialogue = (req.patch.dialogue ?? []).map((line, i) => ({
        ...line,
        id: `dlg_${String((ids += 1)).padStart(10, '0')}`,
        placement: line.placement ?? null,
        style: line.style === undefined ? (stored.dialogue[i]?.style ?? null) : line.style,
        tail: line.tail === undefined ? (stored.dialogue[i]?.tail ?? null) : line.tail
      }))
      stored = { ...stored, dialogue }
      return { panel: stored, warnings: [] }
    },
    'panels:list': () => [stored]
  })
  const view = render(<Host onSelectLine={onSelectLine} {...props} />)
  const select = (line: number | null): void => view.rerender(<Host onSelectLine={onSelectLine} {...props} selectedLine={line} />)
  return { ...api, onSelectLine, select, unmount: view.unmount }
}

const stage = (): HTMLElement => screen.getByTestId('panel-stage')
const bubble = (i: number): HTMLElement => within(stage()).getByLabelText(`Line ${i + 1}`)
const textBox = (): HTMLElement => within(stage()).getByRole('textbox', { name: 'Line text' })
const media = (): HTMLElement => stage().querySelector<HTMLElement>('.panel-media')!
const saver = (): HTMLElement => screen.getByTestId('saver')
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

    // The stylesheet's cap, when it gives one (it keeps room for the tabs): the panel fits that instead.
    width = 2000
    stage().style.maxHeight = '420px'
    act(() => resized())
    expect(row().style.transform).toBe('scale(0.5)')
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

  it('shows the line the workspace selects (a row of the Lines tab)', () => {
    const { onSelectLine, select, calls } = mount()
    select(1)
    expect(bubble(1)).toHaveAttribute('data-selected', 'true')
    expect(bubble(0)).toHaveAttribute('data-selected', 'false')
    expect(onSelectLine).toHaveBeenLastCalledWith(1)
    select(null)
    expect(bubble(1)).toHaveAttribute('data-selected', 'false')
    expect(updates(calls)).toEqual([])
  })

  it('treats a press that moves under 3px as a click, and saves a drag where it was released', async () => {
    const { calls } = mount()
    fireEvent.pointerDown(bubble(0), { clientX: 50, clientY: 25, buttons: 1 })
    fireEvent.pointerMove(stage(), { clientX: 52, clientY: 25, buttons: 1 })
    fireEvent.pointerUp(stage(), { clientX: 52, clientY: 25 })
    await act(async () => undefined)
    expect(updates(calls)).toEqual([])
    expect(bubble(0)).toHaveAttribute('data-selected', 'true')

    // Pressed at the bubble's centre, so it follows the pointer exactly.
    fireEvent.pointerDown(bubble(0), { clientX: 50, clientY: 25, buttons: 1 })
    fireEvent.pointerMove(stage(), { clientX: 300, clientY: 150, buttons: 1 })
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
    fireEvent.pointerDown(bubble(0), { clientX: 50, clientY: 25, buttons: 1 })
    fireEvent.pointerMove(stage(), { clientX: 900, clientY: -40, buttons: 1 })
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

  it('deleting a middle bubble leaves each look on its own line', async () => {
    const line = (n: number, fill: string | null): DialogueLine => ({ id: `dlg_000000000${n}`, speakerId: null, kind: 'narration', text: `Line ${n}`, placement: null, style: fill === null ? null : { fill }, tail: null })
    replaceStored({ ...stored, dialogue: [line(1, '#aa0000'), line(2, null), line(3, '#0000cc')] })
    const { calls } = mount()
    act(() => bubble(1).focus())
    await userEvent.keyboard('{Delete}')
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    await waitFor(() => expect(stored.dialogue).toHaveLength(2))
    expect(stored.dialogue.map((d) => d.style?.fill)).toEqual(['#aa0000', '#0000cc'])
  })

  it('adds a line where the empty panel is double-clicked, spoken by the first of the cast', async () => {
    const { calls } = mount()
    fireEvent.doubleClick(stage().querySelector('.dialogue-overlay')!, { clientX: 200, clientY: 300 })
    expect(textBox()).toHaveFocus()
    expect(bubble(2)).toHaveStyle({ left: '50%', top: '50%' })
    await userEvent.type(textBox(), 'Hey{Enter}')
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    expect(updates(calls)[0]).toEqual({
      dialogue: [...toDrafts([hello, night]), { speakerId: MINA, kind: 'speech', text: 'Hey', placement: { x: 0.5, y: 0.5 }, style: null, tail: null }]
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
    expect(updates(calls)[0]).toEqual({ dialogue: [{ speakerId: null, kind: 'narration', text: 'Later.', placement: { x: 0.25, y: 0.25 }, style: null, tail: null }] })
  })

  it('adds no line on a double-click on the panel status, or on its Retry', () => {
    const version = (status: 'pending' | 'failed') => panelVersion({ id: `ver_000000000${status === 'pending' ? 8 : 9}`, status, error: status === 'failed' ? 'Timed out' : null, imagePath: null })
    stored = { ...stored, versions: [version('pending')] }
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [stored] } })
    mount()
    fireEvent.doubleClick(within(stage()).getByText('Generating…'), { clientX: 200, clientY: 300 })
    expect(within(stage()).queryByRole('textbox')).toBeNull()

    replaceStored({ ...stored, versions: [version('failed')] })
    fireEvent.doubleClick(within(stage()).getByText('Failed: Timed out'), { clientX: 200, clientY: 300 })
    fireEvent.doubleClick(within(stage()).getByRole('button', { name: 'Retry' }), { clientX: 200, clientY: 300 })
    expect(within(stage()).queryByRole('textbox')).toBeNull()
    expect(within(stage()).queryByLabelText('Line 3')).toBeNull()
  })

  it('builds a save sent while another is still going on top of that one, and shows both meanwhile', async () => {
    let release: () => void = () => undefined
    gate = new Promise((resolve) => (release = resolve))
    const { calls } = mount()
    fireEvent.pointerDown(bubble(0), { clientX: 50, clientY: 25, buttons: 1 })
    fireEvent.pointerMove(stage(), { clientX: 300, clientY: 150, buttons: 1 })
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

  it('forgets a press released outside the stage, so a later hover and click move nothing', async () => {
    const { calls } = mount()
    fireEvent.pointerDown(bubble(0), { clientX: 50, clientY: 25, buttons: 1 })
    // Released over the header before the drag took the capture: the stage never sees the release.
    fireEvent.pointerUp(document.body, { clientX: 50, clientY: 25 })
    fireEvent.pointerMove(stage(), { clientX: 300, clientY: 150, buttons: 0 })
    expect(bubble(0)).not.toHaveAttribute('data-dragging')
    expect(bubble(0)).not.toHaveClass('bubble-placed')
    await userEvent.click(media())
    await userEvent.click(bubble(1))
    await act(async () => undefined)
    expect(updates(calls)).toEqual([])
    expect(bubble(0)).not.toHaveClass('bubble-placed')
  })

  it('saves the open text first when its bubble is dragged by its edge, then drags the new text', async () => {
    const { calls } = mount()
    await userEvent.dblClick(bubble(0))
    await userEvent.clear(textBox())
    await userEvent.type(textBox(), 'Run!')
    // On the bubble's padding, outside its text.
    fireEvent.pointerDown(bubble(0), { clientX: 50, clientY: 25, buttons: 1 })
    fireEvent.pointerMove(stage(), { clientX: 300, clientY: 150, buttons: 1 })
    fireEvent.pointerUp(stage(), { clientX: 300, clientY: 150 })
    await waitFor(() => expect(updates(calls)).toHaveLength(2))
    expect(updates(calls)[0].dialogue?.[0]).toEqual({ ...toDrafts([hello])[0], text: 'Run!' })
    expect(updates(calls)[1].dialogue?.[0]).toEqual({ ...toDrafts([hello])[0], text: 'Run!', placement: { x: 0.75, y: 0.25 } })
    expect(saver()).toBeEmptyDOMElement()
  })

  it('sends nothing when the line changed under a drag, and reports it', async () => {
    const { calls } = mount()
    fireEvent.pointerDown(bubble(0), { clientX: 50, clientY: 25, buttons: 1 })
    fireEvent.pointerMove(stage(), { clientX: 300, clientY: 150, buttons: 1 })
    // The agent rewrites the line while the user holds it.
    replaceStored({ ...stored, dialogue: [{ ...hello, id: 'dlg_0000000009', text: 'Goodbye.' }, night] })
    fireEvent.pointerUp(stage(), { clientX: 300, clientY: 150 })
    // The Lines tab says so (PanelInspector.test); the stage itself has no message.
    await waitFor(() => expect(saver()).toHaveTextContent('conflict'))
    expect(screen.queryByRole('alert')).toBeNull()
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
    await waitFor(() => expect(saver()).toHaveTextContent('conflict'))
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

  it('reports a refused save, and draws the stored lines again', async () => {
    installFakeApi({
      'panels:update': () => {
        throw new Error('Dialogue is too long')
      }
    })
    render(<Host onSelectLine={() => undefined} />)
    act(() => bubble(0).focus())
    fireEvent.keyDown(bubble(0), { key: 'Delete' })
    await waitFor(() => expect(saver()).toHaveTextContent('Dialogue is too long'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(bubble(1)).toBeInTheDocument()
  })

  it('moves a zoomed panel with Space and a drag over a bubble, without selecting, dragging or adding one', async () => {
    const { calls, onSelectLine } = mount()
    const v = screen.getByTestId('stage-viewport')
    // Zoomed past the fit: the viewport shows 300 by 200 of a 1000 by 1000 panel.
    for (const [key, value] of Object.entries({ scrollWidth: 1000, scrollHeight: 1000, clientWidth: 300, clientHeight: 200 })) Object.defineProperty(v, key, { configurable: true, value })
    Object.defineProperty(v, 'scrollLeft', { configurable: true, writable: true, value: 0 })
    Object.defineProperty(v, 'scrollTop', { configurable: true, writable: true, value: 0 })
    onSelectLine.mockClear()

    fireEvent.pointerEnter(v)
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' })
    expect(v).toHaveAttribute('data-pan', 'ready')
    fireEvent.pointerDown(bubble(0), { button: 0, clientX: 50, clientY: 25, buttons: 1 })
    fireEvent.pointerMove(v, { clientX: 10, clientY: 5, buttons: 1 })
    fireEvent.pointerUp(v, { button: 0, clientX: 10, clientY: 5 })
    fireEvent.click(bubble(0))
    expect([v.scrollLeft, v.scrollTop]).toEqual([40, 20])
    // A double-click on the empty panel with Space held is two pans, not a new line.
    fireEvent.pointerDown(media(), { button: 0, buttons: 1 })
    fireEvent.pointerUp(v, { button: 0 })
    fireEvent.doubleClick(media(), { clientX: 200, clientY: 300 })
    fireEvent.keyUp(document.body, { key: ' ', code: 'Space' })
    await act(async () => undefined)
    expect(bubble(0)).toHaveAttribute('data-selected', 'false')
    expect(within(stage()).queryByRole('textbox', { name: 'Line text' })).toBeNull()
    expect(onSelectLine).not.toHaveBeenCalled()
    expect(updates(calls)).toEqual([])

    // Without Space a press is the bubble's again.
    await userEvent.click(bubble(0))
    expect(bubble(0)).toHaveAttribute('data-selected', 'true')
  })

  it('never calls a model: selecting, dragging, nudging, retyping, adding and deleting only save the dialogue (No AI)', async () => {
    const { calls } = mount()
    await userEvent.click(bubble(1))
    fireEvent.pointerDown(bubble(0), { clientX: 50, clientY: 25, buttons: 1 })
    fireEvent.pointerMove(stage(), { clientX: 300, clientY: 150, buttons: 1 })
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

describe("the tail's dot", () => {
  const dot = (): HTMLElement => within(stage()).getByLabelText('Point of line 1')
  const dots = (): HTMLElement[] => within(stage()).queryAllByLabelText(/^Point of line/)
  const withTail = (tail: DialogueLine['tail']): void => {
    stored = { ...stored, dialogue: [{ ...hello, tail }, night] }
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [stored] } })
  }
  /** Presses the dot and drags it to (x, y), releasing there unless told not to. */
  function dragDot(x: number, y: number, release = true): void {
    fireEvent.pointerDown(dot(), { clientX: 50, clientY: 100, buttons: 1 })
    fireEvent.pointerMove(stage(), { clientX: x, clientY: y, buttons: 1 })
    if (release) fireEvent.pointerUp(stage(), { clientX: x, clientY: y })
  }

  it('shows only on the selected bubble that can have a tail', async () => {
    mount()
    expect(dots()).toHaveLength(0)
    await userEvent.click(bubble(0))
    expect(dots()).toHaveLength(1)
    await userEvent.click(bubble(1))
    expect(dots()).toHaveLength(0)
  })

  it('saves the tip as fractions of the panel when it is dragged, and nothing else', async () => {
    const { calls } = mount()
    await userEvent.click(bubble(0))
    dragDot(100, 300)
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    expect(updates(calls)[0]).toEqual({ dialogue: [{ ...toDrafts([hello])[0], tail: { x: 0.25, y: 0.5 } }, toDrafts([night])[0]] })
    expect(bubble(0)).toHaveAttribute('data-selected', 'true')
  })

  it('neither drags the bubble nor clears the selection when it is pressed', async () => {
    const { calls, onSelectLine } = mount()
    await userEvent.click(bubble(0))
    onSelectLine.mockClear()
    dragDot(100, 300, false)
    expect(bubble(0)).not.toHaveAttribute('data-dragging')
    expect(bubble(0)).not.toHaveClass('bubble-placed')
    expect(bubble(0)).toHaveAttribute('data-selected', 'true')
    fireEvent.pointerUp(stage(), { clientX: 100, clientY: 300 })
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    expect(updates(calls)[0].dialogue?.[0].placement).toBeNull()
    expect(bubble(0)).toHaveAttribute('data-selected', 'true')
    expect(onSelectLine).not.toHaveBeenCalledWith(null)
  })

  it('saves nothing for a press on it that does not move', async () => {
    const { calls } = mount()
    await userEvent.click(bubble(0))
    fireEvent.pointerDown(dot(), { clientX: 50, clientY: 100, buttons: 1 })
    fireEvent.pointerUp(stage(), { clientX: 50, clientY: 100 })
    await act(async () => undefined)
    expect(updates(calls)).toEqual([])
    expect(bubble(0)).toHaveAttribute('data-selected', 'true')
  })

  it("keeps the tip inside the panel when it is dragged past the panel's edge", async () => {
    const { calls } = mount()
    await userEvent.click(bubble(0))
    dragDot(900, -50)
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    expect(updates(calls)[0].dialogue?.[0].tail).toEqual({ x: 1, y: 0 })
  })

  it('shows the tip while it is dragged, before anything is saved', async () => {
    const { calls } = mount()
    await userEvent.click(bubble(0))
    expect(stage().querySelector('.bubble-tail path')).toBeNull()
    dragDot(100, 300, false)
    await act(async () => undefined)
    expect(updates(calls)).toEqual([])
    // The tip (100, 300) is (50, 275) from the bubble's centre.
    expect(stage().querySelector('.bubble-tail path')?.getAttribute('d')).toContain('L50 275')
    expect(bubble(0)).toHaveClass('bubble-tail-point')
  })

  it('leaves the tip where it is when the bubble is moved', async () => {
    withTail({ x: 0.5, y: 0.9 })
    const { calls } = mount()
    fireEvent.pointerDown(bubble(0), { clientX: 50, clientY: 25, buttons: 1 })
    fireEvent.pointerMove(stage(), { clientX: 300, clientY: 150, buttons: 1 })
    fireEvent.pointerUp(stage(), { clientX: 300, clientY: 150 })
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    expect(updates(calls)[0].dialogue?.[0]).toEqual({ ...toDrafts([hello])[0], tail: { x: 0.5, y: 0.9 }, placement: { x: 0.75, y: 0.25 } })
  })

  it('nudges the tip with the arrow keys, saved once, with the focus kept on the dot', async () => {
    withTail({ x: 0.5, y: 0.9 })
    const { calls } = mount()
    await userEvent.click(bubble(0))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    act(() => dot().focus())
    fireEvent.keyDown(dot(), { key: 'ArrowRight' })
    fireEvent.keyDown(dot(), { key: 'ArrowRight' })
    await act(() => vi.advanceTimersByTimeAsync(NUDGE_COMMIT_MS - 1))
    expect(updates(calls)).toEqual([])
    await act(() => vi.advanceTimersByTimeAsync(1))
    vi.useRealTimers()
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    expect(updates(calls)[0].dialogue?.[0].tail).toEqual({ x: 0.52, y: 0.9 })
    await waitFor(() => expect(stored.dialogue[0].id).not.toBe(hello.id))
    await waitFor(() => expect(dot()).toHaveFocus())
  })

  it('gives the tail back to the app on a double-click, without opening the text or adding a line', async () => {
    withTail({ x: 0.5, y: 0.9 })
    const { calls } = mount()
    await userEvent.click(bubble(0))
    fireEvent.doubleClick(dot(), { clientX: 200, clientY: 540 })
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    expect(updates(calls)[0]).toEqual({ dialogue: [{ ...toDrafts([hello])[0], tail: null }, toDrafts([night])[0]] })
    expect(within(stage()).queryByRole('textbox')).toBeNull()
    expect(within(stage()).queryByLabelText('Line 3')).toBeNull()
  })

  it('goes while the text is open', async () => {
    mount()
    await userEvent.click(bubble(0))
    expect(dots()).toHaveLength(1)
    await userEvent.dblClick(bubble(0))
    expect(textBox()).toBeInTheDocument()
    expect(dots()).toHaveLength(0)
  })

  it('creates a tail when it is dragged from a bubble with none', async () => {
    withTail('none')
    const { calls } = mount()
    await userEvent.click(bubble(0))
    expect(dot()).toHaveAttribute('data-state', 'resting')
    dragDot(100, 300)
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    expect(updates(calls)[0].dialogue?.[0].tail).toEqual({ x: 0.25, y: 0.5 })
  })

  it('draws no tail for a tip inside the bubble, and keeps the dot', async () => {
    withTail({ x: 0.125, y: 0.04 })
    mount()
    await userEvent.click(bubble(0))
    expect(stage().querySelector('.bubble-tail path')).toBeNull()
    expect(dot()).toHaveAttribute('data-state', 'pointed')
  })

  /** A double-click on the empty panel, as a user makes it: it opens the text of a new line. */
  function addLineOnEmptyPanel(): void {
    const overlay = stage().querySelector<HTMLElement>('.dialogue-overlay')!
    fireEvent.pointerDown(overlay, { clientX: 200, clientY: 300, buttons: 1 })
    fireEvent.pointerUp(overlay, { clientX: 200, clientY: 300 })
    fireEvent.doubleClick(overlay, { clientX: 200, clientY: 300 })
  }

  it('saves a tail nudge still waiting when the bubble is pressed', async () => {
    withTail({ x: 0.5, y: 0.9 })
    const { calls } = mount()
    await userEvent.click(bubble(0))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    act(() => dot().focus())
    fireEvent.keyDown(dot(), { key: 'ArrowRight' })
    fireEvent.pointerDown(bubble(0), { clientX: 50, clientY: 25, buttons: 1 })
    fireEvent.pointerUp(stage(), { clientX: 50, clientY: 25 })
    vi.useRealTimers()
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    expect(updates(calls)[0].dialogue?.[0].tail).toEqual({ x: 0.51, y: 0.9 })
  })

  it('saves a tail nudge still waiting when the stage goes away', async () => {
    withTail({ x: 0.5, y: 0.9 })
    const { calls, unmount } = mount()
    await userEvent.click(bubble(0))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    act(() => dot().focus())
    fireEvent.keyDown(dot(), { key: 'ArrowRight' })
    unmount()
    vi.useRealTimers()
    await waitFor(() => expect(updates(calls)).toHaveLength(1))
    expect(updates(calls)[0].dialogue?.[0].tail).toEqual({ x: 0.51, y: 0.9 })
  })

  it('saves a bubble nudge still waiting when the dot is pressed, then the tip on top of it', async () => {
    const { calls } = mount()
    await userEvent.click(bubble(0))
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    act(() => bubble(0).focus())
    fireEvent.keyDown(bubble(0), { key: 'ArrowRight' })
    vi.useRealTimers()
    dragDot(100, 300)
    await waitFor(() => expect(updates(calls)).toHaveLength(2))
    expect(updates(calls)[0].dialogue?.[0].placement).not.toBeNull()
    expect(updates(calls)[1].dialogue?.[0].placement).toEqual(updates(calls)[0].dialogue?.[0].placement)
    expect(updates(calls)[1].dialogue?.[0].tail).toEqual({ x: 0.25, y: 0.5 })
    expect(saver()).toBeEmptyDOMElement()
  })

  it('builds a tip dragged while a retype is still saving on the new text', async () => {
    const { calls } = mount()
    await userEvent.click(bubble(0))
    await userEvent.dblClick(bubble(0))
    let open: () => void = () => undefined
    gate = new Promise((resolve) => (open = resolve))
    await userEvent.clear(textBox())
    await userEvent.type(textBox(), 'Bye{Enter}')
    await waitFor(() => expect(within(stage()).queryByRole('textbox')).toBeNull())
    dragDot(100, 300)
    open()
    await waitFor(() => expect(updates(calls)).toHaveLength(2))
    expect(updates(calls)[1].dialogue?.[0]).toMatchObject({ text: 'Bye', tail: { x: 0.25, y: 0.5 } })
    await waitFor(() => expect(stored.dialogue[0].tail).toEqual({ x: 0.25, y: 0.5 }))
    expect(saver()).toBeEmptyDOMElement()
  })

  it('does nothing for a double-click that follows a drag of the dot', async () => {
    const { calls } = mount()
    await userEvent.click(bubble(0))
    dragDot(100, 300)
    await waitFor(() => expect(stored.dialogue[0].tail).toEqual({ x: 0.25, y: 0.5 }))
    fireEvent.doubleClick(dot(), { clientX: 100, clientY: 300 })
    fireEvent.doubleClick(stage().querySelector('.dialogue-overlay')!, { clientX: 100, clientY: 300 })
    await act(async () => undefined)
    expect(updates(calls)).toHaveLength(1)
    expect(within(stage()).queryByRole('textbox')).toBeNull()
  })

  it('gives the focus to the new line, not the dot, after the dot had it and a speech line is added', async () => {
    mount()
    await userEvent.click(bubble(0))
    act(() => dot().focus())
    addLineOnEmptyPanel()
    await userEvent.type(textBox(), 'Hey{Enter}')
    await waitFor(() => expect(stored.dialogue).toHaveLength(3))
    await waitFor(() => expect(bubble(2)).toHaveFocus())
  })

  it('gives the focus to the new line after the dot had it and a caption is added, though a caption has no dot', async () => {
    stored = { ...stored, characters: [] }
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [stored] } })
    mount()
    await userEvent.click(bubble(0))
    act(() => dot().focus())
    addLineOnEmptyPanel()
    await userEvent.type(textBox(), 'Hey{Enter}')
    await waitFor(() => expect(stored.dialogue).toHaveLength(3))
    await waitFor(() => expect(bubble(2)).toHaveFocus())
  })

  describe('Add bubble', () => {
    const addButton = (): HTMLElement => within(stage()).getByRole('button', { name: 'Add bubble' })
    async function choose(name: string): Promise<void> {
      await userEvent.click(addButton())
      await userEvent.click(within(stage()).getByRole('menuitem', { name }))
    }

    it("opens the new bubble's text", async () => {
      const { calls } = mount()
      await choose('Shout')
      expect(stage().querySelector('.bubble-editor')).toHaveFocus()
      await userEvent.type(textBox(), 'Hey{Enter}')
      await waitFor(() => expect(updates(calls)).toHaveLength(1))
      const line = updates(calls)[0].dialogue!.at(-1)!
      expect(line).toMatchObject({ kind: 'speech', text: 'Hey', speakerId: MINA, style: { shape: 'shout' }, tail: null })
      expect(line.placement).not.toBeNull()
    })

    it('a caption has no speaker and no stored style', async () => {
      const { calls } = mount()
      await choose('Caption')
      await userEvent.type(textBox(), 'Later.{Enter}')
      await waitFor(() => expect(updates(calls)).toHaveLength(1))
      expect(updates(calls)[0].dialogue!.at(-1)).toMatchObject({ kind: 'narration', speakerId: null, style: null })
    })

    it('stores each choice as the table says', async () => {
      const { calls } = mount()
      const want: [string, object][] = [
        ['Speech', { kind: 'speech', speakerId: MINA, style: null }],
        ['Whisper', { kind: 'speech', speakerId: MINA, style: { shape: 'whisper' } }],
        ['Thought', { kind: 'thought', speakerId: MINA, style: null }],
        ['Sound effect', { kind: 'sfx', speakerId: null, style: null }]
      ]
      for (const [i, [name, line]] of want.entries()) {
        await choose(name)
        await userEvent.type(textBox(), `Text ${i}{Enter}`)
        await waitFor(() => expect(updates(calls)).toHaveLength(i + 1))
        expect(updates(calls)[i].dialogue!.at(-1)).toMatchObject(line)
        await waitFor(() => expect(stored.dialogue).toHaveLength(3 + i))
      }
    })

    it('a bubble left empty is dropped', async () => {
      const { calls } = mount()
      await choose('Shout')
      await userEvent.type(textBox(), '{Enter}')
      expect(within(stage()).queryByLabelText('Line 3')).toBeNull()
      expect(updates(calls)).toHaveLength(0)
    })

    it('two new bubbles do not land on the same spot', async () => {
      const { calls } = mount()
      await choose('Speech')
      await userEvent.type(textBox(), 'One{Enter}')
      await waitFor(() => expect(stored.dialogue).toHaveLength(3))
      await choose('Speech')
      await userEvent.type(textBox(), 'Two{Enter}')
      await waitFor(() => expect(updates(calls)).toHaveLength(2))
      const [first, second] = updates(calls).map((p) => p.dialogue!.at(-1)!.placement)
      expect(first).not.toEqual(second)
    })

    it('is disabled while a new bubble is being typed', async () => {
      mount()
      await choose('Shout')
      expect(addButton()).toBeDisabled()
      await userEvent.type(textBox(), '{Escape}')
      expect(addButton()).toBeEnabled()
    })
  })
})
