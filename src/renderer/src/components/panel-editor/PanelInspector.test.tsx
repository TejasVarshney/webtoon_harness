import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DialogueLine, Panel, PanelCharacter, PanelItem, PanelPatch } from '@shared/types'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialCharactersState, useCharactersStore } from '../../stores/characters-store'
import { initialItemsState, useItemsStore } from '../../stores/items-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { character, PROJECT_ID as P, variation } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { item, usage } from '../../test/item-fixtures'
import { EPISODE_ID, panel } from '../../test/panel-fixtures'
import { toDrafts } from './dialogue-edits'
import { PanelInspector } from './PanelInspector'
import { PanelStage } from './PanelStage'

const A = 'pnl_00000000aa'
const MINA = 'chr_0000000001'
const SORA = 'chr_0000000003'
const LANTERN = 'itm_0000000003'
const mina = character()
const sora = character({ id: SORA, name: 'Sora', variations: [variation({ id: 'var_00000000s1', characterId: SORA })] })
const lantern = item({ id: LANTERN, name: 'Lantern', ownerId: MINA, usages: [usage({ id: 'use_00000000l1', itemId: LANTERN, name: 'Lit' })] })
const cast: PanelCharacter[] = [{ characterId: MINA, variationId: 'var_0000000001', action: '', expression: '', position: 'left' }]
const held: PanelItem = { itemId: LANTERN, usageId: 'use_00000000l1', heldBy: MINA, action: 'lit' }
const hello: DialogueLine = { id: 'dlg_0000000001', speakerId: MINA, kind: 'speech', text: 'Hello.', placement: null }
const night: DialogueLine = { id: 'dlg_0000000002', speakerId: null, kind: 'narration', text: 'Night fell.', placement: { x: 0.5, y: 0.8 } }

/** The panel as the main process holds it: what `panels:list` returns, and what `panels:update` changes. */
let stored: Panel
let ids = 0
/** While set, `panels:update` refuses with it. */
let refusal: string | null = null
const originalScroll = Element.prototype.scrollIntoView

beforeEach(() => {
  stored = panel({ id: A, characters: cast, dialogue: [hello, night] })
  ids = 100
  refusal = null
  useAppStore.setState({ ...initialAppState, projectId: P, sessionId: 'ses_0000000001', activeEpisodeId: EPISODE_ID, selectedPanelId: A })
  usePanelsStore.setState({ ...initialPanelsState, projectId: P, episodesLoaded: true, panelsByEpisode: { [EPISODE_ID]: [stored] } })
  useCharactersStore.setState({ ...initialCharactersState, projectId: P, characters: [mina, sora], loaded: true })
  useItemsStore.setState({ ...initialItemsState, projectId: P, items: [lantern], loaded: true })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  Element.prototype.scrollIntoView = originalScroll
})

/** Puts a panel in the store and the main process, as an edit from elsewhere (the agent) would. */
function replaceStored(next: Panel): void {
  stored = next
  act(() => usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [next] } }))
}

function installApi() {
  return installFakeApi({
    'panels:update': (req: { panelId: string; patch: PanelPatch }) => {
      if (refusal !== null) throw new Error(refusal)
      const { dialogue, ...rest } = req.patch
      // Like the service: a dialogue save gives every line a new id.
      const lines = dialogue?.map((line) => ({ ...line, id: `dlg_${String((ids += 1)).padStart(10, '0')}`, placement: line.placement ?? null }))
      stored = { ...stored, ...rest, ...(lines !== undefined ? { dialogue: lines } : {}) } as Panel
      return { panel: stored, warnings: [] }
    },
    'panels:list': () => [stored]
  })
}

/** The inspector as the workspace mounts it: fed from the store, so saves and agent edits reach it. */
function Host({ selectedLine, onSelectLine }: { selectedLine: number | null; onSelectLine(i: number | null): void }) {
  const open = usePanelsStore((s) => s.panelsByEpisode[EPISODE_ID]?.find((p) => p.id === A))
  return open === undefined ? null : <PanelInspector panel={open} selectedLine={selectedLine} onSelectLine={onSelectLine} />
}

function mount({ selectedLine = null }: { selectedLine?: number | null } = {}) {
  const onSelectLine = vi.fn()
  const api = installApi()
  const view = render(<Host selectedLine={selectedLine} onSelectLine={onSelectLine} />)
  return { ...api, onSelectLine, rerender: (line: number | null) => view.rerender(<Host selectedLine={line} onSelectLine={onSelectLine} />), unmount: view.unmount }
}

const tab = (name: string): HTMLElement => screen.getByRole('tab', { name })
const open = (name: string): void => {
  fireEvent.click(tab(name))
}
const tabPanel = (): HTMLElement => screen.getByRole('tabpanel')
const rows = (): HTMLElement[] => within(tabPanel()).getAllByRole('listitem')
const text = (i: number): HTMLElement => within(rows()[i]).getByLabelText('Text')
const field = (label: string): HTMLElement => within(tabPanel()).getByLabelText(label)
const updates = (calls: { channel: string; req: unknown }[]): PanelPatch[] =>
  calls.filter((c) => c.channel === 'panels:update').map((c) => (c.req as { patch: PanelPatch }).patch)

/** Runs the autosave's timers, then hands back real ones, so `waitFor` can see the save that follows. */
async function wait(ms: number): Promise<void> {
  await act(() => vi.advanceTimersByTimeAsync(ms))
}
function fakeTimers(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
}

describe('PanelInspector', () => {
  it('has the Lines, Cast, Items and Scene tabs, and opens on Lines', () => {
    mount()
    expect(within(screen.getByRole('tablist')).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Lines', 'Cast', 'Items', 'Scene'])
    expect(tab('Lines')).toHaveAttribute('aria-selected', 'true')
    expect(tab('Scene')).toHaveAttribute('aria-selected', 'false')
    expect(tabPanel()).toHaveAccessibleName('Lines')
  })

  it('marks the line the stage selected, and scrolls it into view', () => {
    const scrolled: Element[] = []
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this)
    })
    mount({ selectedLine: 1 })
    const [first, second] = rows()
    expect(second).toHaveAttribute('aria-current', 'true')
    expect(first).not.toHaveAttribute('aria-current')
    expect(scrolled).toEqual([second])
  })

  it('selects the line of a row the user goes into', () => {
    const { onSelectLine } = mount()
    act(() => text(1).focus())
    expect(onSelectLine).toHaveBeenLastCalledWith(1)
  })

  it('opens Lines when the stage selects a line', () => {
    const { rerender } = mount()
    open('Scene')
    expect(tab('Scene')).toHaveAttribute('aria-selected', 'true')
    rerender(0)
    expect(tab('Lines')).toHaveAttribute('aria-selected', 'true')
    expect(rows()[0]).toHaveAttribute('aria-current', 'true')
  })

  it('says how to add a line when there is none, and keeps Add line', () => {
    stored = { ...stored, dialogue: [] }
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [stored] } })
    mount()
    expect(tabPanel()).toHaveTextContent('No lines yet. Double-click the panel to place one.')
    expect(within(tabPanel()).getByRole('button', { name: 'Add line' })).toBeInTheDocument()
  })

  describe('Lines', () => {
    it('saves a retyped line 600ms after the last key, as the whole dialogue, and keeps the spaces being typed', async () => {
      fakeTimers()
      const { calls } = mount()
      act(() => text(0).focus())
      fireEvent.change(text(0), { target: { value: 'Hi there. ' } })
      await wait(599)
      expect(updates(calls)).toEqual([])
      await wait(1)
      vi.useRealTimers()
      await waitFor(() => expect(updates(calls)).toHaveLength(1))
      expect(updates(calls)[0]).toEqual({ dialogue: [{ ...toDrafts([hello])[0], text: 'Hi there.' }, toDrafts([night])[0]] })
      // Still typing: the space after the saved text stays until the field is left.
      await waitFor(() => expect(stored.dialogue[0].text).toBe('Hi there.'))
      expect(text(0)).toHaveValue('Hi there. ')
      act(() => text(0).blur())
      expect(text(0)).toHaveValue('Hi there.')
    })

    it('saves a second pause in typing on top of the first', async () => {
      fakeTimers()
      const { calls } = mount()
      fireEvent.change(text(0), { target: { value: 'Hi' } })
      await wait(600)
      fireEvent.change(text(0), { target: { value: 'Hi you' } })
      await wait(600)
      vi.useRealTimers()
      await waitFor(() => expect(updates(calls)).toHaveLength(2))
      expect(updates(calls)[1].dialogue?.[0].text).toBe('Hi you')
      expect(within(tabPanel()).queryByRole('alert')).toBeNull()
    })

    it('saves a line typed just before the editor closes (Review Focus 3)', async () => {
      fakeTimers()
      const { calls, unmount } = mount()
      fireEvent.change(text(1), { target: { value: 'Dawn.' } })
      await wait(100)
      unmount()
      vi.useRealTimers()
      await waitFor(() => expect(updates(calls)).toHaveLength(1))
      expect(updates(calls)[0].dialogue?.[1].text).toBe('Dawn.')
    })

    it('keeps the old text when the new one is empty', async () => {
      const { calls } = mount()
      act(() => text(0).focus())
      fireEvent.change(text(0), { target: { value: '   ' } })
      act(() => text(0).blur())
      expect(text(0)).toHaveValue('Hello.')
      await act(async () => undefined)
      expect(updates(calls)).toEqual([])
    })

    it('changes who speaks, and how', async () => {
      const { calls } = mount()
      act(() => within(rows()[0]).getByLabelText('Kind').focus())
      fireEvent.change(within(rows()[0]).getByLabelText('Speaker'), { target: { value: '' } })
      fireEvent.change(within(rows()[0]).getByLabelText('Kind'), { target: { value: 'thought' } })
      act(() => within(rows()[0]).getByLabelText('Kind').blur())
      await waitFor(() => expect(updates(calls)).toHaveLength(1))
      expect(updates(calls)[0]).toEqual({ dialogue: [{ ...toDrafts([hello])[0], speakerId: null, kind: 'thought' }, toDrafts([night])[0]] })
      expect(within(rows()[0]).getByLabelText('Speaker')).toHaveValue('')
    })

    it('resets a placed line to auto, and offers it only on placed lines', async () => {
      const { calls } = mount()
      expect(within(rows()[0]).queryByRole('button', { name: 'Reset to auto' })).toBeNull()
      fireEvent.click(within(rows()[1]).getByRole('button', { name: 'Reset to auto' }))
      await waitFor(() => expect(updates(calls)).toHaveLength(1))
      expect(updates(calls)[0]).toEqual({ dialogue: [toDrafts([hello])[0], { ...toDrafts([night])[0], placement: null }] })
      await waitFor(() => expect(within(rows()[1]).queryByRole('button', { name: 'Reset to auto' })).toBeNull())
    })

    it('removes a line', async () => {
      const { calls } = mount()
      fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Remove' }))
      await waitFor(() => expect(updates(calls)).toHaveLength(1))
      expect(updates(calls)[0]).toEqual({ dialogue: toDrafts([night]) })
      await waitFor(() => expect(rows()).toHaveLength(1))
      expect(text(0)).toHaveValue('Night fell.')
    })

    it('adds an automatic line spoken by the first of the cast, saved once it is left with text in it', async () => {
      const { calls } = mount()
      fireEvent.click(within(tabPanel()).getByRole('button', { name: 'Add line' }))
      expect(rows()).toHaveLength(3)
      expect(text(2)).toHaveFocus()
      expect(within(rows()[2]).getByLabelText('Speaker')).toHaveValue(MINA)
      // Left empty, it goes again.
      act(() => text(2).blur())
      expect(rows()).toHaveLength(2)
      expect(updates(calls)).toEqual([])

      fireEvent.click(within(tabPanel()).getByRole('button', { name: 'Add line' }))
      fireEvent.change(text(2), { target: { value: ' Later. ' } })
      act(() => text(2).blur())
      await waitFor(() => expect(updates(calls)).toHaveLength(1))
      expect(updates(calls)[0]).toEqual({ dialogue: [...toDrafts([hello, night]), { speakerId: MINA, kind: 'speech', text: 'Later.', placement: null }] })
      await waitFor(() => expect(stored.dialogue).toHaveLength(3))
      expect(rows()).toHaveLength(3)
      expect(text(2)).toHaveValue('Later.')
    })

    it('keeps a new line open while it is empty, as the app mounts it (StrictMode replays the effects)', () => {
      installApi()
      render(
        <StrictMode>
          <Host selectedLine={null} onSelectLine={() => undefined} />
        </StrictMode>
      )
      fireEvent.click(within(tabPanel()).getByRole('button', { name: 'Add line' }))
      expect(rows()).toHaveLength(3)
      expect(text(2)).toHaveFocus()
    })

    it('sends nothing when the line changed while it was typed, and says so', async () => {
      fakeTimers()
      const { calls } = mount()
      fireEvent.change(text(0), { target: { value: 'Hi.' } })
      replaceStored({ ...stored, dialogue: [{ ...hello, id: 'dlg_0000000009', text: 'Goodbye.' }, night] })
      await wait(600)
      vi.useRealTimers()
      expect(await within(tabPanel()).findByText('This line changed while you were editing it.')).toBeInTheDocument()
      expect(updates(calls)).toEqual([])
      expect(text(0)).toHaveValue('Goodbye.')
    })

    it('shows a refused save with Undo my change, which puts the stored line back and sends nothing', async () => {
      refusal = 'Dialogue is too long'
      const { calls } = mount()
      act(() => text(0).focus())
      fireEvent.change(text(0), { target: { value: 'Hi.' } })
      act(() => text(0).blur())
      const alert = await within(tabPanel()).findByRole('alert')
      expect(alert).toHaveTextContent('Dialogue is too long')
      expect(text(0)).toHaveValue('Hi.')
      fireEvent.click(within(alert).getByRole('button', { name: 'Undo my change' }))
      expect(text(0)).toHaveValue('Hello.')
      expect(within(tabPanel()).queryByRole('alert')).toBeNull()
      await act(async () => undefined)
      expect(updates(calls)).toHaveLength(1)
    })
  })

  describe('Cast and Items', () => {
    it('saves an added character 600ms later, and only the cast', async () => {
      fakeTimers()
      const { calls } = mount()
      open('Cast')
      fireEvent.click(within(tabPanel()).getByRole('button', { name: 'Add character' }))
      await wait(599)
      expect(updates(calls)).toEqual([])
      await wait(1)
      vi.useRealTimers()
      await waitFor(() => expect(updates(calls)).toHaveLength(1))
      expect(updates(calls)).toEqual([{ characters: [...cast, { characterId: SORA, variationId: 'var_00000000s1', action: '', expression: '', position: 'center' }] }])
      await act(async () => undefined)
      expect(updates(calls)).toHaveLength(1)
    })

    it('lets go of what a removed cast member held, in an items save sent before the cast', async () => {
      stored = { ...stored, items: [held] }
      usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [stored] } })
      fakeTimers()
      const { calls } = mount()
      open('Cast')
      fireEvent.click(within(tabPanel()).getByRole('button', { name: 'Remove cast member' }))
      await wait(600)
      vi.useRealTimers()
      await waitFor(() => expect(updates(calls)).toHaveLength(2))
      // The service refuses a cast without someone an item is still held by, so the items go first.
      expect(updates(calls)).toEqual([{ items: [{ ...held, heldBy: null }] }, { characters: [] }])
      open('Items')
      expect(field('Held by')).toHaveValue('')
    })

    it('trims the actions it saves, and saves an item change on its own', async () => {
      stored = { ...stored, items: [held] }
      usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [stored] } })
      const { calls } = mount()
      open('Items')
      act(() => field('Item action').focus())
      fireEvent.change(field('Item action'), { target: { value: ' swung ' } })
      act(() => field('Item action').blur())
      await waitFor(() => expect(updates(calls)).toHaveLength(1))
      expect(updates(calls)[0]).toEqual({ items: [{ ...held, action: 'swung' }] })
    })

    it('waits to save a cast row that has no ready look yet', async () => {
      const ghost = character({ id: 'chr_0000000004', name: 'Ghost', variations: [variation({ id: 'var_00000000g1', characterId: 'chr_0000000004', status: 'pending', imagePath: null })] })
      useCharactersStore.setState({ characters: [mina, ghost] })
      const { calls } = mount()
      open('Cast')
      fireEvent.click(within(tabPanel()).getByRole('button', { name: 'Add character' }))
      act(() => within(tabPanel()).getAllByLabelText('Character')[1].focus())
      act(() => within(tabPanel()).getAllByLabelText('Character')[1].blur())
      expect(within(tabPanel()).getByText(/no ready variation/i)).toBeInTheDocument()
      await act(async () => undefined)
      expect(updates(calls)).toEqual([])
    })
  })

  describe('Scene', () => {
    it('holds the description, setting, shot, aspect and the layout', () => {
      mount()
      open('Scene')
      for (const label of ['Description', 'Setting', 'Shot', 'Aspect']) expect(field(label)).toBeInTheDocument()
      const layout = within(tabPanel()).getByRole('group', { name: 'Layout' })
      for (const label of ['Frame', 'Gap after', 'Gutter', 'Beside the previous panel']) expect(within(layout).getByLabelText(label)).toBeInTheDocument()
      expect(field('Setting')).toHaveValue('Rooftop at dusk')
    })

    it('saves exactly the layout field that changed, and never redraws', async () => {
      fakeTimers()
      const { calls } = mount()
      open('Scene')
      fireEvent.change(field('Gap after'), { target: { value: 'long' } })
      await wait(600)
      vi.useRealTimers()
      await waitFor(() => expect(updates(calls)).toHaveLength(1))
      expect(updates(calls)).toEqual([{ gapAfter: 'long' }])
      expect(calls.some((c) => c.channel === 'panels:generate')).toBe(false)
    })

    it('replaces the frame with a note for a tall aspect', async () => {
      const { calls } = mount()
      open('Scene')
      act(() => field('Aspect').focus())
      fireEvent.change(field('Aspect'), { target: { value: '1:3' } })
      expect(field('Frame')).toBeDisabled()
      expect(field('Frame')).toHaveAccessibleDescription('Tall panels fade instead of a frame')
      act(() => field('Aspect').blur())
      await waitFor(() => expect(updates(calls)).toEqual([{ aspect: '1:3' }]))
    })

    it('saves the description typed just before the editor closes, trimmed (Review Focus 3)', async () => {
      fakeTimers()
      const { calls, unmount } = mount()
      open('Scene')
      fireEvent.change(field('Description'), { target: { value: '  Mina waves.  ' } })
      await wait(50)
      unmount()
      vi.useRealTimers()
      await waitFor(() => expect(updates(calls)).toHaveLength(1))
      expect(updates(calls)).toEqual([{ description: 'Mina waves.' }])
    })

    it("shows the agent's Setting while nothing is pending, and the typed one while it is", async () => {
      fakeTimers()
      const { calls } = mount()
      open('Scene')
      replaceStored({ ...stored, setting: 'Harbour at night' })
      expect(field('Setting')).toHaveValue('Harbour at night')
      fireEvent.change(field('Setting'), { target: { value: 'Roof' } })
      replaceStored({ ...stored, setting: 'Somewhere else' })
      expect(field('Setting')).toHaveValue('Roof')
      await wait(600)
      vi.useRealTimers()
      await waitFor(() => expect(updates(calls)).toEqual([{ setting: 'Roof' }]))
    })

    it('shows a refused save in the tab with Undo my change, which puts the stored value back and sends nothing', async () => {
      refusal = 'Disk is full'
      fakeTimers()
      const { calls } = mount()
      open('Scene')
      fireEvent.change(field('Setting'), { target: { value: 'Roof' } })
      await wait(600)
      vi.useRealTimers()
      const alert = await within(tabPanel()).findByRole('alert')
      expect(alert).toHaveTextContent('Disk is full')
      // The refused value stays, for the user to change or undo.
      expect(field('Setting')).toHaveValue('Roof')
      fireEvent.click(within(alert).getByRole('button', { name: 'Undo my change' }))
      expect(field('Setting')).toHaveValue('Rooftop at dusk')
      expect(within(tabPanel()).queryByRole('alert')).toBeNull()
      await act(async () => undefined)
      expect(updates(calls)).toHaveLength(1)
    })

    it('saves nothing for a panel that left the episode (R2)', async () => {
      const onSelectLine = vi.fn()
      const { calls } = installApi()
      // The workspace passes the panel it last had, and the store no longer has it.
      const view = render(<PanelInspector panel={stored} selectedLine={null} onSelectLine={onSelectLine} />)
      open('Scene')
      fireEvent.change(field('Setting'), { target: { value: 'Roof' } })
      act(() => usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [] } }))
      view.unmount()
      await act(async () => undefined)
      expect(updates(calls)).toEqual([])
    })
  })

  describe('with the stage', () => {
    function rect(left: number, top: number, width: number, height: number): DOMRect {
      return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect
    }

    beforeEach(() => {
      // jsdom has no layout: the panel is 400x600 at the origin, and every bubble is 100x50 at its top left corner.
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        return this.classList.contains('bubble') ? rect(0, 0, 100, 50) : rect(0, 0, 400, 600)
      })
    })

    /** The stage and the inspector, sharing the selected line as the workspace has them do. */
    function Editor() {
      const current = usePanelsStore((s) => s.panelsByEpisode[EPISODE_ID]?.find((p) => p.id === A))
      const [line, setLine] = useState<number | null>(null)
      if (current === undefined) return null
      return (
        <>
          <PanelStage panel={current} share={1} selectedLine={line} onSelectLine={setLine} />
          <PanelInspector panel={current} selectedLine={line} onSelectLine={setLine} />
        </>
      )
    }

    const stage = (): HTMLElement => screen.getByTestId('panel-stage')
    const bubble = (i: number): HTMLElement => within(stage()).getByLabelText(`Line ${i + 1}`)

    it('selects the bubble of a row the user goes into, and the row of a bubble selected on the stage', async () => {
      installApi()
      render(<Editor />)
      act(() => text(1).focus())
      expect(bubble(1)).toHaveAttribute('data-selected', 'true')
      await userEvent.click(bubble(0))
      expect(bubble(1)).toHaveAttribute('data-selected', 'false')
      expect(rows()[0]).toHaveAttribute('aria-current', 'true')
      expect(rows()[1]).not.toHaveAttribute('aria-current')
    })

    it('shows a conflict on the stage once, in Lines, and opens Lines for it', async () => {
      const { calls } = installApi()
      render(<Editor />)
      await userEvent.click(bubble(0))
      open('Cast')
      fireEvent.pointerDown(bubble(0), { clientX: 50, clientY: 25, buttons: 1 })
      fireEvent.pointerMove(stage(), { clientX: 300, clientY: 150, buttons: 1 })
      // The agent rewrites the line while the user holds it.
      replaceStored({ ...stored, dialogue: [{ ...hello, id: 'dlg_0000000009', text: 'Goodbye.' }, night] })
      fireEvent.pointerUp(stage(), { clientX: 300, clientY: 150 })
      await waitFor(() => expect(tab('Lines')).toHaveAttribute('aria-selected', 'true'))
      expect(screen.getAllByText('This line changed while you were editing it.')).toHaveLength(1)
      expect(within(tabPanel()).getByRole('alert')).toHaveTextContent('This line changed while you were editing it.')
      expect(within(stage()).queryByRole('alert')).toBeNull()
      expect(updates(calls)).toEqual([])
    })

    it('shows a save the service refused on the stage in Lines, with Undo my change', async () => {
      refusal = 'Dialogue is too long'
      render(<Editor />)
      installApi()
      act(() => bubble(0).focus())
      open('Scene')
      fireEvent.keyDown(bubble(0), { key: 'Delete' })
      await waitFor(() => expect(tab('Lines')).toHaveAttribute('aria-selected', 'true'))
      const alert = within(tabPanel()).getByRole('alert')
      expect(alert).toHaveTextContent('Dialogue is too long')
      expect(screen.getAllByText('Dialogue is too long')).toHaveLength(1)
      fireEvent.click(within(alert).getByRole('button', { name: 'Undo my change' }))
      expect(within(tabPanel()).queryByRole('alert')).toBeNull()
      expect(bubble(1)).toBeInTheDocument()
    })
  })
})
