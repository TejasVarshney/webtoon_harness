import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DialogueLine, Panel, PanelCharacter, PanelItem, PanelPatch } from '@shared/types'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialCharactersState, useCharactersStore } from '../../stores/characters-store'
import { initialItemsState, useItemsStore } from '../../stores/items-store'
import { initialLocationsState, useLocationsStore } from '../../stores/locations-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { character, PROJECT_ID as P, variation } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { item, usage } from '../../test/item-fixtures'
import { location, locationState } from '../../test/location-fixtures'
import { EPISODE_ID, panel } from '../../test/panel-fixtures'
import { toDrafts } from './dialogue-edits'
import { PanelInspector } from './PanelInspector'
import { PanelStage, type StylePreview } from './PanelStage'

const A = 'pnl_00000000aa'
const MINA = 'chr_0000000001'
const SORA = 'chr_0000000003'
const LANTERN = 'itm_0000000003'
const mina = character()
const sora = character({ id: SORA, name: 'Sora', variations: [variation({ id: 'var_00000000s1', characterId: SORA })] })
const lantern = item({ id: LANTERN, name: 'Lantern', ownerId: MINA, usages: [usage({ id: 'use_00000000l1', itemId: LANTERN, name: 'Lit' })] })
const stockroom = location({
  states: [locationState({ id: 'lst_base' }), locationState({ id: 'lst_night', name: 'Night', kind: 'state', delta: 'only embers glowing', status: 'failed', imagePath: null })]
})
const alley = location({ id: 'loc_0000000002', name: 'Back alley', archived: true })
const cast: PanelCharacter[] = [{ characterId: MINA, variationId: 'var_0000000001', action: '', expression: '', position: 'left' }]
const held: PanelItem = { itemId: LANTERN, usageId: 'use_00000000l1', heldBy: MINA, action: 'lit' }
const hello: DialogueLine = { id: 'dlg_0000000001', speakerId: MINA, kind: 'speech', text: 'Hello.', placement: null, style: null, tail: null }
const night: DialogueLine = { id: 'dlg_0000000002', speakerId: null, kind: 'narration', text: 'Night fell.', placement: { x: 0.5, y: 0.8 }, style: null, tail: null }

/** The panel as the main process holds it: what `panels:list` returns, and what `panels:update` changes. */
let stored: Panel
let ids = 0
/** While set, `panels:update` refuses with it. */
let refusal: string | null = null
/** The next `panels:update` refuses with it, and the ones after it do not. */
let refuseOnce: string | null = null
/** While set, `panels:update` waits for it before answering: a save still in flight. */
let hold: Promise<void> | null = null
/** What the next `panels:update` warns about (the service checks the whole panel on every save). */
let warnings: string[] = []
const originalScroll = Element.prototype.scrollIntoView

beforeEach(() => {
  stored = panel({ id: A, characters: cast, dialogue: [hello, night] })
  ids = 100
  refusal = null
  refuseOnce = null
  hold = null
  warnings = []
  useAppStore.setState({ ...initialAppState, projectId: P, sessionId: 'ses_0000000001', activeEpisodeId: EPISODE_ID, selectedPanelId: A })
  usePanelsStore.setState({ ...initialPanelsState, projectId: P, episodesLoaded: true, panelsByEpisode: { [EPISODE_ID]: [stored] } })
  useCharactersStore.setState({ ...initialCharactersState, projectId: P, characters: [mina, sora], loaded: true })
  useItemsStore.setState({ ...initialItemsState, projectId: P, items: [lantern], loaded: true })
  useLocationsStore.setState({ ...initialLocationsState, projectId: P, locations: [stockroom, alley], loaded: true })
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
    'panels:update': async (req: { panelId: string; patch: PanelPatch }) => {
      if (hold !== null) await hold
      if (refuseOnce !== null) {
        const message = refuseOnce
        refuseOnce = null
        throw new Error(message)
      }
      if (refusal !== null) throw new Error(refusal)
      const { dialogue, ...rest } = req.patch
      // Like the service: a dialogue save gives every line a new id.
      const lines = dialogue?.map((line) => ({ ...line, id: `dlg_${String((ids += 1)).padStart(10, '0')}`, placement: line.placement ?? null, style: line.style ?? null, tail: line.tail ?? null }))
      stored = { ...stored, ...rest, ...(lines !== undefined ? { dialogue: lines } : {}) } as Panel
      return { panel: stored, warnings }
    },
    'panels:list': () => [stored]
  })
}

/** The inspector as the workspace mounts it: fed from the store, so saves and agent edits reach it. */
function Host({ selectedLine, onSelectLine, onPreviewStyle }: { selectedLine: number | null; onSelectLine(i: number | null): void; onPreviewStyle?(preview: StylePreview | null): void }) {
  const open = usePanelsStore((s) => s.panelsByEpisode[EPISODE_ID]?.find((p) => p.id === A))
  return open === undefined ? null : <PanelInspector panel={open} selectedLine={selectedLine} onSelectLine={onSelectLine} onPreviewStyle={onPreviewStyle} />
}

function mount({ selectedLine = null, onPreviewStyle }: { selectedLine?: number | null; onPreviewStyle?(preview: StylePreview | null): void } = {}) {
  const onSelectLine = vi.fn()
  const api = installApi()
  const view = render(<Host selectedLine={selectedLine} onSelectLine={onSelectLine} onPreviewStyle={onPreviewStyle} />)
  return { ...api, onSelectLine, rerender: (line: number | null) => view.rerender(<Host selectedLine={line} onSelectLine={onSelectLine} onPreviewStyle={onPreviewStyle} />), unmount: view.unmount }
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

/**
 * Lays the tab panel and its rows out, as jsdom has no layout: the panel spans `area` (top, bottom) on screen, and row
 * `i` starts `rowTop + i * rowHeight` down it, less what the panel is scrolled by. Hands back what `scrollIntoView` was
 * called on, which must stay empty: it would scroll the column above the panel too.
 */
function layOutRows({ area, rowTop, rowHeight }: { area: [number, number]; rowTop: number; rowHeight: number }): Element[] {
  const box = (top: number, height: number): DOMRect =>
    ({ left: 0, top, width: 400, height, x: 0, y: top, right: 400, bottom: top + height, toJSON: () => ({}) }) as DOMRect
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.getAttribute('role') === 'tabpanel') return box(area[0], area[1] - area[0])
    if (this.classList.contains('line-row')) {
      const panelEl = this.closest('[role="tabpanel"]') as HTMLElement
      const i = Array.from(this.parentElement!.children).indexOf(this)
      return box(area[0] + rowTop + i * rowHeight - panelEl.scrollTop, rowHeight)
    }
    if (this.classList.contains('bubble')) return box(0, 50)
    return box(0, 600)
  })
  const scrolled: Element[] = []
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this)
  })
  return scrolled
}

describe('PanelInspector', () => {
  it('has the Lines, Cast, Items and Scene tabs, and opens on Lines', () => {
    mount()
    expect(within(screen.getByRole('tablist')).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Lines', 'Cast', 'Items', 'Scene'])
    expect(tab('Lines')).toHaveAttribute('aria-selected', 'true')
    expect(tab('Scene')).toHaveAttribute('aria-selected', 'false')
    expect(tabPanel()).toHaveAccessibleName('Lines')
  })

  it('marks the line the stage selected, and scrolls its row into view inside the tab panel only', () => {
    const scrolled = layOutRows({ area: [0, 100], rowTop: 50, rowHeight: 200 })
    const { rerender } = mount({ selectedLine: 1 })
    const [first, second] = rows()
    expect(second).toHaveAttribute('aria-current', 'true')
    expect(first).not.toHaveAttribute('aria-current')
    // The row is 250-450 under an area of 0-100: its top is brought to the area's top.
    expect(tabPanel().scrollTop).toBe(250)
    expect(scrolled).toEqual([])
    expect(document.documentElement.scrollTop).toBe(0)
    // Back up to the first row, now 200 above the area's top: the panel scrolls back by that much.
    rerender(0)
    expect(tabPanel().scrollTop).toBe(50)
  })

  it('leaves the row the user is in where it is', () => {
    layOutRows({ area: [0, 100], rowTop: 50, rowHeight: 200 })
    const { rerender } = mount()
    act(() => text(1).focus())
    rerender(1)
    expect(tabPanel().scrollTop).toBe(0)
  })

  it('selects the line of a row the user goes into', () => {
    const { onSelectLine } = mount()
    act(() => text(1).focus())
    expect(onSelectLine).toHaveBeenLastCalledWith(1)
  })

  it("leaves the selection alone when the focus lands on a row's buttons: a block opening or closing would move them from under the press", () => {
    stored = { ...stored, dialogue: [night, { ...night, id: 'dlg_0000000005' }] }
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [stored] } })
    const { onSelectLine } = mount({ selectedLine: 0 })
    act(() => within(rows()[1]).getByRole('button', { name: 'Remove' }).focus())
    act(() => within(rows()[1]).getByRole('button', { name: 'Reset to auto' }).focus())
    expect(onSelectLine).not.toHaveBeenCalled()
    act(() => text(1).focus())
    expect(onSelectLine).toHaveBeenLastCalledWith(1)
  })

  it('scrolls to the selected row once it exists: the stage selects a new line before its save lands', () => {
    layOutRows({ area: [0, 100], rowTop: 50, rowHeight: 200 })
    const { rerender } = mount()
    rerender(2)
    expect(tabPanel().scrollTop).toBe(0)
    replaceStored({ ...stored, dialogue: [hello, night, { ...hello, id: 'dlg_0000000003', text: 'Added.' }] })
    // The new row is 450-650 under an area of 0-100: its top is brought to the area's top.
    expect(tabPanel().scrollTop).toBe(450)
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

    it('saves a line typed just before the editor closes', async () => {
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

    it('keeps every change to a row while the user moves between its fields, even with the text emptied, until the row is left', async () => {
      fakeTimers()
      const { calls } = mount()
      const row = (): HTMLElement => rows()[0]
      act(() => within(row()).getByLabelText('Kind').focus())
      fireEvent.change(within(row()).getByLabelText('Kind'), { target: { value: 'thought' } })
      act(() => text(0).focus())
      fireEvent.change(text(0), { target: { value: '' } })
      act(() => within(row()).getByLabelText('Speaker').focus())
      fireEvent.change(within(row()).getByLabelText('Speaker'), { target: { value: '' } })
      expect(within(row()).getByLabelText('Kind')).toHaveValue('thought')
      expect(within(row()).getByLabelText('Speaker')).toHaveValue('')
      expect(text(0)).toHaveValue('')
      act(() => text(0).focus())
      fireEvent.change(text(0), { target: { value: 'Hm.' } })
      expect(updates(calls)).toEqual([])
      vi.useRealTimers()
      act(() => text(0).blur())
      await waitFor(() => expect(updates(calls)).toHaveLength(1))
      expect(updates(calls)[0]).toEqual({ dialogue: [{ ...toDrafts([hello])[0], speakerId: null, kind: 'thought', text: 'Hm.' }, toDrafts([night])[0]] })
    })

    it('resets a placed line to auto, and offers it only on placed lines', async () => {
      const { calls } = mount()
      expect(within(rows()[0]).queryByRole('button', { name: 'Reset to auto' })).toBeNull()
      fireEvent.click(within(rows()[1]).getByRole('button', { name: 'Reset to auto' }))
      await waitFor(() => expect(updates(calls)).toHaveLength(1))
      expect(updates(calls)[0]).toEqual({ dialogue: [toDrafts([hello])[0], { ...toDrafts([night])[0], placement: null }] })
      await waitFor(() => expect(within(rows()[1]).queryByRole('button', { name: 'Reset to auto' })).toBeNull())
    })

    describe('the style block', () => {
      const shape = (i: number, name: string): HTMLElement => within(within(rows()[i]).getByRole('group', { name: 'Shape' })).getByRole('button', { name })
      const tailButton = (name: string): HTMLElement => within(within(rows()[0]).getByRole('group', { name: 'Tail' })).getByRole('button', { name })

      it('shows the style block only under the selected row', () => {
        mount({ selectedLine: 1 })
        expect(within(rows()[0]).queryByRole('group', { name: 'Shape' })).toBeNull()
        expect(within(rows()[1]).getByRole('group', { name: 'Shape' })).toBeInTheDocument()
      })

      it("draws the block after the row's buttons, so opening it moves neither them nor the fields", () => {
        mount({ selectedLine: 0 })
        const actions = rows()[0].querySelector('.form-actions')!
        const block = rows()[0].querySelector('.bubble-style')!
        expect(actions.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      })

      it('Reset style leaves the focus on the Font select of the same row, and the style goes', async () => {
        const styled = { ...hello, style: { fill: '#ff0000' } }
        stored = { ...stored, dialogue: [styled, night] }
        usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [stored] } })
        mount({ selectedLine: 0 })
        await userEvent.click(within(rows()[0]).getByRole('button', { name: 'Reset style' }))
        expect(within(rows()[0]).queryByRole('button', { name: 'Reset style' })).toBeNull()
        expect(within(rows()[0]).getByLabelText('Font')).toHaveFocus()
        await waitFor(() => expect(stored.dialogue[0].style).toBeNull(), { timeout: 2000 })
        expect(within(rows()[0]).getByLabelText('Font')).toHaveFocus()
      })

      it("a row's save landing leaves another row's waiting preview on the stage", async () => {
        fakeTimers()
        let shown: StylePreview | null = null
        const { rerender } = mount({ selectedLine: 0, onPreviewStyle: (preview) => (shown = preview) })
        fireEvent.click(shape(0, 'Shout'))
        expect(shown).toEqual({ index: 0, style: { shape: 'shout' } })
        await wait(300)
        rerender(1)
        fireEvent.click(shape(1, 'Whisper'))
        expect(shown).toEqual({ index: 1, style: { shape: 'whisper' } })
        // The first row's save is sent and lands here; the second row's is still waiting, for another 300 ms.
        await wait(300)
        expect(stored.dialogue[0].style).toEqual({ shape: 'shout' })
        expect(stored.dialogue[1].style).toBeNull()
        expect(shown).toEqual({ index: 1, style: { shape: 'whisper' } })
        await wait(300)
        expect(stored.dialogue[1].style).toEqual({ shape: 'whisper' })
        expect(shown).toBeNull()
      })

      it('saves a style after the wait, with the rest of the dialogue untouched', async () => {
        fakeTimers()
        const { calls } = mount({ selectedLine: 0 })
        fireEvent.click(shape(0, 'Shout'))
        await wait(599)
        expect(updates(calls)).toEqual([])
        await wait(1)
        vi.useRealTimers()
        await waitFor(() => expect(updates(calls)).toHaveLength(1))
        expect(updates(calls)[0]).toEqual({ dialogue: [{ ...toDrafts([hello])[0], style: { shape: 'shout' } }, toDrafts([night])[0]] })
        await waitFor(() => expect(stored.dialogue[0].style).toEqual({ shape: 'shout' }))
        expect(shape(0, 'Shout')).toHaveAttribute('aria-pressed', 'true')
      })

      it('saves a waiting style when the row is left', async () => {
        fakeTimers()
        const { calls } = mount({ selectedLine: 0 })
        act(() => shape(0, 'Shout').focus())
        fireEvent.click(shape(0, 'Shout'))
        expect(updates(calls)).toEqual([])
        vi.useRealTimers()
        act(() => shape(0, 'Shout').blur())
        await waitFor(() => expect(updates(calls)).toHaveLength(1))
        expect(updates(calls)[0].dialogue?.[0].style).toEqual({ shape: 'shout' })
      })

      it('a style and typed text in the same row both land', async () => {
        fakeTimers()
        const { calls } = mount({ selectedLine: 0 })
        fireEvent.change(text(0), { target: { value: 'Hi.' } })
        fireEvent.click(shape(0, 'Shout'))
        await wait(1200)
        vi.useRealTimers()
        await waitFor(() => expect(stored.dialogue[0]).toMatchObject({ text: 'Hi.', style: { shape: 'shout' } }))
        expect(updates(calls)).toHaveLength(2)
        expect(within(tabPanel()).queryByRole('alert')).toBeNull()
      })

      it('a refused style save says so, and Undo my change drops it', async () => {
        refusal = 'Dialogue is too long'
        const { calls } = mount({ selectedLine: 0 })
        act(() => shape(0, 'Shout').focus())
        fireEvent.click(shape(0, 'Shout'))
        act(() => shape(0, 'Shout').blur())
        const alert = await within(tabPanel()).findByRole('alert')
        expect(alert).toHaveTextContent('Dialogue is too long')
        expect(shape(0, 'Shout')).toHaveAttribute('aria-pressed', 'true')
        fireEvent.click(within(alert).getByRole('button', { name: 'Undo my change' }))
        expect(shape(0, 'Shout')).toHaveAttribute('aria-pressed', 'false')
        expect(shape(0, 'Auto')).toHaveAttribute('aria-pressed', 'true')
        await act(async () => undefined)
        expect(updates(calls)).toHaveLength(1)
      })

      const dawn: DialogueLine = { id: 'dlg_0000000003', speakerId: null, kind: 'narration', text: 'Dawn broke.', placement: null, style: null, tail: null }

      it('a style picked before Remove does not land on the next line', async () => {
        fakeTimers()
        const { calls } = mount({ selectedLine: 0 })
        fireEvent.click(shape(0, 'Shout'))
        fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Remove' }))
        await wait(1200)
        vi.useRealTimers()
        await waitFor(() => expect(rows()).toHaveLength(1))
        expect(text(0)).toHaveValue('Night fell.')
        expect(stored.dialogue.map((l) => l.style)).toEqual([null])
        expect(updates(calls)).toHaveLength(1)
        expect(within(tabPanel()).queryByRole('alert')).toBeNull()
      })

      it('a style picked before a line above it is deleted does not land on the wrong line', async () => {
        fakeTimers()
        stored = { ...stored, dialogue: [hello, night, dawn] }
        usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [stored] } })
        const { calls } = mount({ selectedLine: 1 })
        fireEvent.click(shape(1, 'Shout'))
        // The line above is deleted elsewhere (the stage, or the agent): the styled row now shows the third line.
        replaceStored({ ...stored, dialogue: [{ ...night, id: 'dlg_0000000011' }, { ...dawn, id: 'dlg_0000000012' }] })
        await wait(1200)
        vi.useRealTimers()
        expect(await within(tabPanel()).findByText('This line changed while you were editing it.')).toBeInTheDocument()
        expect(updates(calls)).toEqual([])
        expect(stored.dialogue.map((l) => l.style)).toEqual([null, null])
        expect(shape(1, 'Shout')).toHaveAttribute('aria-pressed', 'false')
      })

      it('a style pending while the text is refused still saves', async () => {
        fakeTimers()
        const { calls } = mount({ selectedLine: 0 })
        fireEvent.change(text(0), { target: { value: 'Hi.' } })
        await wait(100)
        fireEvent.click(shape(0, 'Shout'))
        let release = (): void => undefined
        hold = new Promise<void>((resolve) => (release = resolve))
        refuseOnce = 'Dialogue is too long'
        // The text save is sent at 600 ms and held; the style is sent at 700 ms behind it.
        await wait(700)
        release()
        vi.useRealTimers()
        await waitFor(() => expect(stored.dialogue[0].style).toEqual({ shape: 'shout' }))
        expect(stored.dialogue[0].text).toBe('Hello.')
        expect(updates(calls)).toHaveLength(2)
        expect(within(tabPanel()).queryByText('This line changed while you were editing it.')).toBeNull()
      })

      /** Types text and lets its save be sent and held, then picks a style: the pick is made while the text is saving. */
      async function pickWhileTextSaves(): Promise<{ release(): void; calls: { channel: string; req: unknown }[] }> {
        fakeTimers()
        const { calls } = mount({ selectedLine: 0 })
        fireEvent.change(text(0), { target: { value: 'Hi.' } })
        let release = (): void => undefined
        hold = new Promise<void>((resolve) => (release = resolve))
        await wait(600)
        expect(updates(calls)).toHaveLength(1)
        fireEvent.click(shape(0, 'Shout'))
        await wait(600)
        return { release, calls }
      }

      it('a style picked while the text is saving still saves when the text lands', async () => {
        const { release, calls } = await pickWhileTextSaves()
        release()
        vi.useRealTimers()
        await waitFor(() => expect(stored.dialogue[0]).toMatchObject({ text: 'Hi.', style: { shape: 'shout' } }))
        expect(updates(calls)).toHaveLength(2)
        expect(within(tabPanel()).queryByText('This line changed while you were editing it.')).toBeNull()
      })

      it('a style picked while the text is saving still saves when the text is refused', async () => {
        refuseOnce = 'Dialogue is too long'
        const { release, calls } = await pickWhileTextSaves()
        release()
        vi.useRealTimers()
        await waitFor(() => expect(stored.dialogue[0].style).toEqual({ shape: 'shout' }))
        expect(stored.dialogue[0].text).toBe('Hello.')
        expect(updates(calls)).toHaveLength(2)
        expect(within(tabPanel()).queryByText('This line changed while you were editing it.')).toBeNull()
      })

      it('style first, then text, both land', async () => {
        fakeTimers()
        const { calls } = mount({ selectedLine: 0 })
        fireEvent.click(shape(0, 'Shout'))
        await wait(100)
        fireEvent.change(text(0), { target: { value: 'Hi.' } })
        await wait(1200)
        vi.useRealTimers()
        await waitFor(() => expect(stored.dialogue[0]).toMatchObject({ text: 'Hi.', style: { shape: 'shout' } }))
        expect(updates(calls)).toHaveLength(2)
        expect(within(tabPanel()).queryByRole('alert')).toBeNull()
        expect(within(tabPanel()).queryByText('This line changed while you were editing it.')).toBeNull()
      })

      it('Tail buttons save at once', async () => {
        const { calls } = mount({ selectedLine: 0 })
        fireEvent.click(tailButton('None'))
        await waitFor(() => expect(updates(calls)).toHaveLength(1))
        expect(updates(calls)[0]).toEqual({ dialogue: [{ ...toDrafts([hello])[0], tail: 'none' }, toDrafts([night])[0]] })
        await waitFor(() => expect(tailButton('None')).toHaveAttribute('aria-pressed', 'true'))
      })
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
      expect(updates(calls)[0]).toEqual({ dialogue: [...toDrafts([hello, night]), { speakerId: MINA, kind: 'speech', text: 'Later.', placement: null, style: null, tail: null }] })
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

    it('drops a refused line once a later save clears its message, so no unsaved text is left unsaid', async () => {
      refusal = 'Dialogue is too long'
      const { calls } = mount()
      act(() => text(0).focus())
      fireEvent.change(text(0), { target: { value: 'Hi.' } })
      act(() => text(0).blur())
      await within(tabPanel()).findByRole('alert')
      expect(text(0)).toHaveValue('Hi.')
      refusal = null
      fireEvent.click(within(rows()[1]).getByRole('button', { name: 'Reset to auto' }))
      await waitFor(() => expect(updates(calls)).toHaveLength(2))
      await waitFor(() => expect(within(tabPanel()).queryByRole('alert')).toBeNull())
      expect(text(0)).toHaveValue('Hello.')
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

    it('takes a position as free text, saved trimmed', async () => {
      fakeTimers()
      const { calls } = mount()
      open('Cast')
      const position = within(tabPanel()).getByRole('textbox', { name: 'Position' })
      fireEvent.change(position, { target: { value: ' far left, half in shadow ' } })
      await wait(600)
      vi.useRealTimers()
      await waitFor(() => expect(updates(calls)).toHaveLength(1))
      expect(updates(calls)).toEqual([{ characters: [{ ...cast[0], position: 'far left, half in shadow' }] }])
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

  describe('warnings', () => {
    const warningList = (): HTMLElement | null => tabPanel().querySelector('.inspector-warnings')

    it("shows the last save's warnings in the tab that made it, and drops them on the next save, whoever makes it", async () => {
      const { calls } = mount()
      open('Scene')
      warnings = ['Mentioned but not attached: Sora. Attach them to characters or list them in offPanelMentions.']
      act(() => field('Description').focus())
      fireEvent.change(field('Description'), { target: { value: 'Mina waves at Sora.' } })
      act(() => field('Description').blur())
      await waitFor(() => expect(warningList()).toHaveTextContent('Mentioned but not attached: Sora.'))

      // Sora is cast: that save checks the panel again, and has nothing to say.
      warnings = []
      open('Cast')
      expect(warningList()).toBeNull()
      act(() => within(tabPanel()).getByRole('button', { name: 'Add character' }).focus())
      fireEvent.click(within(tabPanel()).getByRole('button', { name: 'Add character' }))
      act(() => within(tabPanel()).getByRole('button', { name: 'Add character' }).blur())
      await waitFor(() => expect(updates(calls)).toHaveLength(2))
      open('Scene')
      await waitFor(() => expect(warningList()).toBeNull())
    })

    it("shows a dialogue save's warnings in Lines", async () => {
      const { calls } = mount()
      warnings = ['Unknown speaker: chr_ffffffffff']
      act(() => text(0).focus())
      fireEvent.change(text(0), { target: { value: 'Hi.' } })
      act(() => text(0).blur())
      await waitFor(() => expect(updates(calls)).toHaveLength(1))
      await waitFor(() => expect(warningList()).toHaveTextContent('Unknown speaker: chr_ffffffffff'))
      open('Scene')
      expect(warningList()).toBeNull()
    })
  })

  describe('Scene', () => {
    it('has no Beside, Gap after or Gutter field: the strip places panels', () => {
      mount()
      open('Scene')
      for (const label of ['Gap after', 'Gutter', 'Beside the previous panel']) expect(within(tabPanel()).queryByLabelText(label)).toBeNull()
      expect(field('Frame')).toBeInTheDocument()
    })

    it('holds the description, setting, shot, aspect and the frame', () => {
      mount()
      open('Scene')
      for (const label of ['Description', 'Setting', 'Shot', 'Aspect']) expect(field(label)).toBeInTheDocument()
      const layout = within(tabPanel()).getByRole('group', { name: 'Layout' })
      expect(within(layout).getByLabelText('Frame')).toBeInTheDocument()
      expect(field('Setting')).toHaveValue('Rooftop at dusk')
    })

    it('saves exactly the frame that changed, and never redraws', async () => {
      fakeTimers()
      const { calls } = mount()
      open('Scene')
      fireEvent.change(field('Frame'), { target: { value: 'borderless' } })
      await wait(600)
      vi.useRealTimers()
      await waitFor(() => expect(updates(calls)).toHaveLength(1))
      expect(updates(calls)).toEqual([{ frame: 'borderless' }])
      expect(calls.some((c) => c.channel === 'panels:generate')).toBe(false)
    })

    it('sets a saved location at its base state and main angle, and offers no archived one', async () => {
      const { calls } = mount()
      open('Scene')
      expect(field('Location')).toHaveValue('')
      expect(field('State')).toBeDisabled()
      expect(field('Camera')).toBeDisabled()
      expect(within(field('Location')).getAllByRole('option').map((o) => o.textContent)).toEqual(['None', 'Back stockroom'])
      act(() => field('Location').focus())
      fireEvent.change(field('Location'), { target: { value: stockroom.id } })
      act(() => field('Location').blur())
      await waitFor(() => expect(updates(calls)).toEqual([{ location: { locationId: stockroom.id, stateId: 'lst_base', camera: 'main' } }]))
      expect(calls.some((c) => c.channel === 'panels:generate')).toBe(false)
    })

    it("changes a located panel's state and camera, takes the user's own words for another angle, and clears it with None", async () => {
      replaceStored({ ...stored, location: { locationId: stockroom.id, stateId: 'lst_base', camera: 'main' } })
      const { calls } = mount()
      open('Scene')
      expect(within(field('State')).getAllByRole('option').map((o) => o.textContent)).toEqual(['Default', 'Night'])
      act(() => field('State').focus())
      fireEvent.change(field('State'), { target: { value: 'lst_night' } })
      act(() => field('State').blur())
      await waitFor(() => expect(updates(calls)).toEqual([{ location: { locationId: stockroom.id, stateId: 'lst_night', camera: 'main' } }]))
      act(() => field('Camera').focus())
      fireEvent.change(field('Camera'), { target: { value: 'other' } })
      act(() => field('Camera').blur())
      act(() => field('Camera angle').focus())
      fireEvent.change(field('Camera angle'), { target: { value: ' low, from the doorway ' } })
      act(() => field('Camera angle').blur())
      await waitFor(() => expect(updates(calls).at(-1)).toEqual({ location: { locationId: stockroom.id, stateId: 'lst_night', camera: 'low, from the doorway' } }))
      act(() => field('Location').focus())
      fireEvent.change(field('Location'), { target: { value: '' } })
      act(() => field('Location').blur())
      await waitFor(() => expect(updates(calls).at(-1)).toEqual({ location: null }))
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

    it('saves the description typed just before the editor closes, trimmed', async () => {
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

    it('saves nothing for a panel that left the episode', async () => {
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

    it('scrolls to the row of a pressed bubble at once, inside the tab panel, so the stage never moves', async () => {
      const scrolled = layOutRows({ area: [600, 700], rowTop: 100, rowHeight: 200 })
      installApi()
      render(
        <div data-testid="column">
          <Editor />
        </div>
      )
      fireEvent.pointerDown(bubble(1), { clientX: 50, clientY: 25, buttons: 1 })
      // Held, as a drag may follow: the row is brought into view already, as nothing above the panel moves.
      expect(rows()[1]).toHaveAttribute('aria-current', 'true')
      expect(tabPanel().scrollTop).toBe(300)
      expect(scrolled).toEqual([])
      expect(screen.getByTestId('column').scrollTop).toBe(0)
      expect(stage().scrollTop).toBe(0)
      fireEvent.pointerUp(stage(), { clientX: 50, clientY: 25 })
      expect(tabPanel().scrollTop).toBe(300)
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
