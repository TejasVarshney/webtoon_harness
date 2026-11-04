import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { visualFields } from '@shared/visual-fields'
import type { Panel, PanelPatch } from '@shared/types'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialCharactersState, useCharactersStore } from '../../stores/characters-store'
import { useChatStore } from '../../stores/chat-store'
import { initialItemsState, useItemsStore } from '../../stores/items-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { character, PROJECT_ID as P } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { EPISODE_ID, panel, panelVersion } from '../../test/panel-fixtures'
import { PanelWorkspace } from './PanelWorkspace'

const NOW = '2026-10-21T10:00:00.000Z'
const A = 'pnl_00000000aa'
const B = 'pnl_00000000bb'
const C = 'pnl_00000000cc'

function withImage(id: string, o: Partial<Panel> = {}): Panel {
  const version = panelVersion({ id: `ver_00000000${id.slice(-2)}`, imagePath: `panels/${id}/ver.png` })
  return panel({ id, versions: [version], currentVersionId: version.id, ...o })
}

const first = withImage(A)
const second = withImage(B)
const third = withImage(C)

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId: P, sessionId: 'ses_0000000001', activeEpisodeId: EPISODE_ID, selectedPanelId: B })
  usePanelsStore.setState({ ...initialPanelsState, projectId: P, episodesLoaded: true, panelsByEpisode: { [EPISODE_ID]: [first, second, third] } })
  useChatStore.setState({ messages: {}, streaming: {}, notices: {}, draft: '' })
  useCharactersStore.setState({ ...initialCharactersState, projectId: P, characters: [character()], loaded: true })
  useItemsStore.setState({ ...initialItemsState, projectId: P, items: [], loaded: true })
})
afterEach(async () => {
  // Back focuses the card a frame later; let that frame pass, so it cannot land in the next test.
  await new Promise((resolve) => requestAnimationFrame(resolve))
})

/** The workspace as App mounts it, beside a stand-in for the strip's cards, which Back focuses again. */
function Host() {
  const selected = useAppStore((s) => s.selectedPanelId)
  return (
    <>
      {[A, B, C].map((id) => (
        <article key={id} data-panel-id={id} tabIndex={0} />
      ))}
      {selected !== null && <PanelWorkspace panelId={selected} />}
    </>
  )
}

function mount(handlers: Parameters<typeof installFakeApi>[0] = {}) {
  const api = installFakeApi({ 'panelChat:load': () => [], 'panels:list': () => usePanelsStore.getState().panelsByEpisode[EPISODE_ID] ?? [], ...handlers })
  render(<Host />)
  return api
}

const workspace = (): HTMLElement => screen.getByTestId('panel-workspace')
const header = (): HTMLElement => within(workspace()).getByTestId('workspace-header')

/**
 * Focuses a field without clicking it first. jsdom lays everything out at 0x0, so the resizable group takes
 * a pointer-down anywhere inside it for a grab of the divider and moves focus there; a real browser has real geometry.
 */
function focus(field: HTMLElement): void {
  act(() => field.focus())
}

describe('PanelWorkspace', () => {
  it('titles the panel by its place in the episode', () => {
    mount()
    expect(within(workspace()).getByRole('heading', { level: 1 })).toHaveTextContent('Panel 2 of 3')
  })

  it('shows the version switcher, and the panel chat with its composer', async () => {
    mount()
    expect(within(workspace()).getByRole('group', { name: 'Image versions' })).toBeInTheDocument()
    const chat = within(workspace()).getByRole('region', { name: 'Panel chat' })
    expect(within(chat).getByRole('heading', { name: 'Panel chat' })).toBeInTheDocument()
    expect(within(chat).getByTestId('composer-input')).toBeInTheDocument()
  })

  it('takes the focus when it opens, and leaves it where it is when stepping to another panel', () => {
    mount()
    expect(within(header()).getByRole('button', { name: 'Back to the strip' })).toHaveFocus()
    const next = within(header()).getByRole('button', { name: 'Next panel' })
    focus(next)
    act(() => useAppStore.getState().selectPanel(A))
    expect(next).toHaveFocus()
  })

  it('goes back to the strip, and focuses the card it came from', async () => {
    mount()
    await userEvent.click(within(header()).getByRole('button', { name: 'Back to the strip' }))
    expect(useAppStore.getState().selectedPanelId).toBeNull()
    expect(screen.queryByTestId('panel-workspace')).toBeNull()
    await waitFor(() => expect(document.querySelector(`[data-panel-id="${B}"]`)).toHaveFocus())
  })

  it('steps to the next and previous panel, and stops at the ends', async () => {
    mount()
    const next = (): HTMLElement => within(header()).getByRole('button', { name: 'Next panel' })
    const previous = (): HTMLElement => within(header()).getByRole('button', { name: 'Previous panel' })
    expect(within(header()).getByRole('button', { name: 'Back to the strip' })).toHaveTextContent('Strip')
    await userEvent.click(next())
    expect(useAppStore.getState().selectedPanelId).toBe(C)
    expect(within(workspace()).getByRole('heading', { level: 1 })).toHaveTextContent('Panel 3 of 3')
    expect(next()).toBeDisabled()
    expect(previous()).toBeEnabled()
    act(() => useAppStore.getState().selectPanel(A))
    expect(previous()).toBeDisabled()
    expect(next()).toBeEnabled()
  })

  it('uploads an image, and regenerates without saving the panel', async () => {
    const { calls } = mount({ 'panels:uploadImage': () => null, 'panels:generate': () => undefined })
    await userEvent.click(within(header()).getByRole('button', { name: 'Upload image…' }))
    expect(calls.find((c) => c.channel === 'panels:uploadImage')?.req).toEqual({ projectId: P, panelId: B })
    const regenerate = within(header()).getByRole('button', { name: 'Regenerate' })
    expect(regenerate).toHaveClass('btn-primary')
    await userEvent.click(regenerate)
    await waitFor(() => expect(calls.find((c) => c.channel === 'panels:generate')?.req).toEqual({ projectId: P, panelId: B }))
    expect(calls.some((c) => c.channel === 'panels:update')).toBe(false)
  })

  describe.each([
    ['Regenerate in the header', 'panels:generate', () => within(header()).getByRole('button', { name: 'Regenerate' })],
    ["the stale notice's Regenerate", 'panels:generate', () => within(within(workspace()).getByTestId('stale-notice')).getByRole('button', { name: 'Regenerate' })],
    ['Upload image…', 'panels:uploadImage', () => within(header()).getByRole('button', { name: 'Upload image…' })]
  ] as const)('%s', (_, channel, button) => {
    // An image drawn from other fields, so the notice shows.
    const stale = (): Panel => {
      const version = panelVersion({ id: 'ver_00000000b9', drawnFrom: { ...visualFields(second), setting: 'Street' } })
      return { ...second, versions: [version], currentVersionId: version.id }
    }

    it('waits for the save of a field just left, so it works from what the user typed', async () => {
      usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [first, stale(), third] } })
      let release: () => void = () => undefined
      const { calls } = mount({
        'panels:update': () => new Promise((resolve) => (release = () => resolve({ panel: stale(), warnings: [] }))),
        'panels:generate': () => undefined,
        'panels:uploadImage': () => null
      })
      fireEvent.click(within(workspace()).getByRole('tab', { name: 'Scene' }))
      focus(within(workspace()).getByLabelText('Description'))
      await userEvent.keyboard('A wider view')
      await userEvent.click(button())
      await act(async () => undefined)
      const saving = calls.filter((c) => c.channel === 'panels:update').length
      const ranMeanwhile = calls.some((c) => c.channel === channel)
      // Released before anything is asserted, so a save left waiting cannot hold up the next test's.
      await act(async () => release())
      expect(saving).toBe(1)
      expect(ranMeanwhile).toBe(false)
      await waitFor(() => expect(calls.some((c) => c.channel === channel)).toBe(true))
      const order = calls.map((c) => c.channel)
      // After the save, and after the reload that follows it.
      const reload = order.indexOf('panels:list', order.indexOf('panels:update'))
      expect(reload).toBeGreaterThan(-1)
      expect(order.indexOf(channel)).toBeGreaterThan(reload)
    })

    it('does not run when that save is refused, and says why', async () => {
      usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [first, stale(), third] } })
      const { calls } = mount({
        'panels:update': () => {
          throw new Error('Description is too long')
        },
        'panels:generate': () => undefined,
        'panels:uploadImage': () => null
      })
      fireEvent.click(within(workspace()).getByRole('tab', { name: 'Scene' }))
      focus(within(workspace()).getByLabelText('Description'))
      await userEvent.keyboard('A wider view')
      await userEvent.click(button())
      // Said above the stage, as well as by the field.
      await waitFor(() => expect(workspace().querySelector('.editing-error')).toHaveTextContent('Description is too long'))
      expect(within(within(workspace()).getByRole('tabpanel')).getByRole('alert')).toHaveTextContent('Description is too long')
      expect(within(header()).getByRole('button', { name: 'Upload image…' })).toBeEnabled()
      expect(calls.some((c) => c.channel === channel)).toBe(false)
    })
  })

  it('shows a failed regeneration', async () => {
    mount({
      'panels:generate': () => {
        throw new Error('No image model is set')
      }
    })
    await userEvent.click(within(header()).getByRole('button', { name: 'Regenerate' }))
    expect(await within(workspace()).findByRole('alert')).toHaveTextContent('No image model is set')
  })

  it('leaves a panel its own failure and its own busy state when stepping to the next one', async () => {
    let finish: () => void = () => undefined
    mount({
      'panels:generate': (req: { panelId: string }) => {
        if (req.panelId === B) throw new Error('No image model is set')
        return new Promise<void>((resolve) => (finish = resolve))
      }
    })
    await userEvent.click(within(header()).getByRole('button', { name: 'Regenerate' }))
    expect(await within(workspace()).findByRole('alert')).toHaveTextContent('No image model is set')
    await userEvent.click(within(header()).getByRole('button', { name: 'Next panel' }))
    expect(within(workspace()).queryByRole('alert')).toBeNull()

    // A run still going on panel 3 does not hold panel 2's buttons.
    await userEvent.click(within(header()).getByRole('button', { name: 'Regenerate' }))
    expect(within(header()).getByRole('button', { name: 'Upload image…' })).toBeDisabled()
    await userEvent.click(within(header()).getByRole('button', { name: 'Previous panel' }))
    expect(within(header()).getByRole('button', { name: 'Upload image…' })).toBeEnabled()
    await act(async () => finish())
  })

  it('leaves a panel its own failed or pending revert when stepping to the next one', async () => {
    // Two ready versions each, the newest current, so each panel can step back on its own.
    const twoVersions = (id: string): Panel => {
      const older = panelVersion({ id: `ver_000000${id.slice(-2)}01`, imagePath: `panels/${id}/1.png` })
      const newer = panelVersion({ id: `ver_000000${id.slice(-2)}02`, imagePath: `panels/${id}/2.png` })
      return panel({ id, versions: [older, newer], currentVersionId: newer.id })
    }
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [first, twoVersions(B), twoVersions(C)] } })
    let release: () => void = () => undefined
    mount({
      'panels:revert': (req: { panelId: string }) => {
        if (req.panelId === B) throw new Error('Version is not ready')
        return new Promise<never>((_, reject) => (release = () => reject(new Error('gone'))))
      }
    })
    await userEvent.click(within(header()).getByTestId('version-prev'))
    expect(await within(workspace()).findByRole('alert')).toHaveTextContent('Version is not ready')
    await userEvent.click(within(header()).getByRole('button', { name: 'Next panel' }))
    expect(within(workspace()).queryByRole('alert')).toBeNull()
    expect(within(header()).getByTestId('panel-version-label')).toHaveTextContent('v2 / 2')

    // A revert still going on panel 3 does not hold panel 2's version buttons.
    await userEvent.click(within(header()).getByTestId('version-prev'))
    expect(within(header()).getByTestId('version-prev')).toBeDisabled()
    await userEvent.click(within(header()).getByRole('button', { name: 'Previous panel' }))
    expect(within(header()).getByTestId('version-prev')).toBeEnabled()
    expect(within(header()).getByTestId('version-next')).toBeDisabled()
    await act(async () => release())
    expect(within(workspace()).queryByRole('alert')).toBeNull()
  })

  it('says which fields changed since the image was drawn, and regenerates from the notice', async () => {
    const cast = [{ characterId: 'chr_0000000001', variationId: 'var_0000000001', action: '', expression: '', position: 'center' as const }]
    const drawn = panel({ id: B, characters: cast })
    const version = panelVersion({ id: 'ver_00000000b9', drawnFrom: { ...visualFields(drawn), characters: [] } })
    const stale = { ...drawn, versions: [version], currentVersionId: version.id }
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [first, stale, third] } })
    const { calls } = mount({ 'panels:generate': () => undefined })
    const notice = within(workspace()).getByTestId('stale-notice')
    expect(notice).toHaveTextContent('Cast changed since this image was drawn.')
    await userEvent.click(within(notice).getByRole('button', { name: 'Regenerate' }))
    await waitFor(() => expect(calls.find((c) => c.channel === 'panels:generate')?.req).toEqual({ projectId: P, panelId: B }))
    expect(calls.some((c) => c.channel === 'panels:update')).toBe(false)
  })

  it('shows no notice when the image matches the panel', () => {
    const version = panelVersion({ id: 'ver_00000000b9', drawnFrom: visualFields(second) })
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [first, { ...second, versions: [version], currentVersionId: version.id }, third] } })
    mount()
    expect(within(workspace()).queryByTestId('stale-notice')).toBeNull()
  })

  it('goes back on Escape', async () => {
    mount()
    focus(document.body)
    await userEvent.keyboard('{Escape}')
    expect(useAppStore.getState().selectedPanelId).toBeNull()
  })

  it('leaves Escape to its own composer and to an open dialog', async () => {
    mount()
    focus(within(workspace()).getByTestId('composer-input'))
    await userEvent.keyboard('{Escape}')
    expect(useAppStore.getState().selectedPanelId).toBe(B)

    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    // A button, not an input: only the dialog check can tell this one apart from the bare workspace.
    const button = document.createElement('button')
    dialog.append(button)
    document.body.append(dialog)
    focus(button)
    await userEvent.keyboard('{Escape}')
    expect(useAppStore.getState().selectedPanelId).toBe(B)
    dialog.remove()

    // An input elsewhere (a rename box) owns Escape too.
    const rename = document.createElement('input')
    document.body.append(rename)
    focus(rename)
    await userEvent.keyboard('{Escape}')
    expect(useAppStore.getState().selectedPanelId).toBe(B)
    rename.remove()
  })

  it('keeps its frame when the panel leaves the episode, and saves nothing', async () => {
    const { calls } = mount()
    act(() => usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [first, third] } }))
    expect(workspace()).toHaveTextContent('Panel not in the current episode')
    expect(useAppStore.getState().selectedPanelId).toBe(B)
    expect(within(workspace()).queryByRole('button', { name: 'Regenerate' })).toBeNull()
    await userEvent.click(within(header()).getByRole('button', { name: 'Back to the strip' }))
    expect(useAppStore.getState().selectedPanelId).toBeNull()
    expect(calls.some((c) => c.channel === 'panels:update')).toBe(false)
  })

  it('does not load a thread for a panel that is not in the episode', () => {
    useAppStore.setState({ selectedPanelId: 'pnl_00000000ff' })
    const { calls } = mount()
    expect(workspace()).toHaveTextContent('Panel not in the current episode')
    expect(within(workspace()).queryByTestId('composer-input')).toBeNull()
    expect(calls.some((c) => c.channel === 'panelChat:load')).toBe(false)
  })

  it('loads the episode itself when the strip has not been opened yet', async () => {
    usePanelsStore.setState({ ...initialPanelsState })
    const { calls } = mount({
      'episodes:list': () => [{ id: EPISODE_ID, number: 1, title: 'Episode 1', synopsis: '', panelIds: [A, B, C], createdAt: NOW, updatedAt: NOW }],
      'panels:list': () => [first, second, third]
    })
    expect(workspace()).toHaveTextContent('Loading panel')
    expect(workspace()).not.toHaveTextContent('Panel not in the current episode')
    expect(await within(workspace()).findByRole('heading', { level: 1 })).toHaveTextContent('Panel 2 of 3')
    expect(calls.map((c) => c.channel)).toContain('episodes:list')
  })

  it('shows a failed load', async () => {
    usePanelsStore.setState({ ...initialPanelsState })
    mount({
      'episodes:list': () => {
        throw new Error('disk is gone')
      }
    })
    expect(await within(workspace()).findByRole('alert')).toHaveTextContent('disk is gone')
  })

  it('lays the stage out at its share of the strip row, leaning as the strip has it', () => {
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [first, { ...second, beside: true, frame: 'slanted' }, third] } })
    mount()
    const shape = within(workspace()).getByTestId('panel-stage').querySelector<HTMLElement>('.panel-shape')!
    expect(shape.style.getPropertyValue('--share')).toBe('0.5')
    expect(shape).toHaveAttribute('data-frame', 'slanted')
    expect(shape).toHaveAttribute('data-slant', 'left')
  })

  it('cancels the text of a bubble on Escape and stays open, and clears a selected bubble before going back (Review Focus 4)', async () => {
    const line = { id: 'dlg_0000000001', speakerId: null, kind: 'narration' as const, text: 'Night fell.', placement: null }
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [first, { ...second, dialogue: [line] }, third] } })
    const { calls } = mount()
    const stage = within(workspace()).getByTestId('panel-stage')
    const bubble = (): HTMLElement => within(stage).getByLabelText('Line 1')
    fireEvent.doubleClick(bubble())
    expect(within(stage).getByRole('textbox', { name: 'Line text' })).toHaveFocus()
    await userEvent.keyboard(' Later.{Escape}')
    expect(within(stage).queryByRole('textbox')).toBeNull()
    expect(bubble()).toHaveTextContent('Night fell.')
    expect(useAppStore.getState().selectedPanelId).toBe(B)

    // The bubble keeps the selection and the focus: the first Escape clears it, and only the next one goes back.
    expect(bubble()).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(bubble()).toHaveAttribute('data-selected', 'false')
    expect(useAppStore.getState().selectedPanelId).toBe(B)
    await userEvent.keyboard('{Escape}')
    expect(useAppStore.getState().selectedPanelId).toBeNull()
    expect(calls.some((c) => c.channel === 'panels:update')).toBe(false)
  })

  it('closes the open text of a line the agent removed, says so in Lines, and reopens no old draft when a line comes back there', () => {
    const line = (id: string, text: string) => ({ id, speakerId: null, kind: 'narration' as const, text, placement: null })
    const night = line('dlg_0000000001', 'Night fell.')
    const withLines = (dialogue: Panel['dialogue']): void => usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [first, { ...second, dialogue }, third] } })
    withLines([night, line('dlg_0000000002', 'Dawn.')])
    const { calls } = mount()
    const stage = (): HTMLElement => within(workspace()).getByTestId('panel-stage')
    const textBox = (): HTMLElement | null => within(stage()).queryByRole('textbox', { name: 'Line text' })
    fireEvent.doubleClick(within(stage()).getByLabelText('Line 2'))
    fireEvent.change(textBox()!, { target: { value: 'Dusk.' } })

    act(() => withLines([night]))
    expect(textBox()).toBeNull()
    expect(within(workspace()).getByRole('tabpanel')).toHaveTextContent('This line changed while you were editing it.')

    // A line that comes back at that place is not opened with the old draft, and the focus stays where the user put it.
    const composer = within(workspace()).getByTestId('composer-input')
    focus(composer)
    act(() => withLines([night, line('dlg_0000000003', 'Morning.')]))
    expect(textBox()).toBeNull()
    expect(within(stage()).getByLabelText('Line 2')).toHaveTextContent('Morning.')
    expect(composer).toHaveFocus()
    expect(calls.some((c) => c.channel === 'panels:update')).toBe(false)
  })

  it('puts the tabs under the stage, on Lines, and selects the bubble of the row the user goes into', () => {
    const line = { id: 'dlg_0000000001', speakerId: null, kind: 'narration' as const, text: 'Night fell.', placement: null }
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [first, { ...second, dialogue: [line] }, third] } })
    mount()
    const tabs = within(workspace()).getByRole('tablist')
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Lines', 'Cast', 'Items', 'Scene'])
    expect(within(tabs).getByRole('tab', { name: 'Lines' })).toHaveAttribute('aria-selected', 'true')
    const row = within(within(workspace()).getByRole('tabpanel')).getByRole('listitem')
    focus(within(row).getByLabelText('Text'))
    expect(within(within(workspace()).getByTestId('panel-stage')).getByLabelText('Line 1')).toHaveAttribute('data-selected', 'true')
    expect(row).toHaveAttribute('aria-current', 'true')
  })

  it('keeps one stage when stepping, and saves what was typed in a bubble and a nudge still waiting', async () => {
    const keyWarnings = vi.spyOn(console, 'error')
    // jsdom has no layout: the panel is 400x600 at the origin, and every bubble is 100x50 at its top left corner.
    const rect = (width: number, height: number): DOMRect => ({ left: 0, top: 0, width, height, x: 0, y: 0, right: width, bottom: height, toJSON: () => ({}) }) as DOMRect
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return this.classList.contains('bubble') ? rect(100, 50) : rect(400, 600)
    })
    const line = (text: string) => ({ id: 'dlg_0000000001', speakerId: null, kind: 'narration' as const, text, placement: { x: 0.5, y: 0.8 } })
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [first, { ...second, dialogue: [line('Night fell.')] }, { ...third, dialogue: [line('Dawn.')] }] } })
    const { calls } = mount({ 'panels:update': (req: { panelId: string }) => ({ panel: req.panelId === B ? second : third, warnings: [] }) })
    const stage = (): HTMLElement => within(workspace()).getByTestId('panel-stage')
    const saved = (): { panelId: string; patch: PanelPatch }[] => calls.filter((c) => c.channel === 'panels:update').map((c) => c.req as { panelId: string; patch: PanelPatch })

    // Text typed into a bubble, then a step with the button.
    fireEvent.doubleClick(within(stage()).getByLabelText('Line 1'))
    fireEvent.change(within(stage()).getByRole('textbox', { name: 'Line text' }), { target: { value: 'Night came.' } })
    await userEvent.click(within(header()).getByRole('button', { name: 'Next panel' }))
    expect(within(workspace()).getAllByTestId('panel-stage')).toHaveLength(1)
    expect(within(stage()).getByLabelText('Line 1')).toHaveTextContent('Dawn.')
    await waitFor(() => expect(saved()).toHaveLength(1))
    expect(saved()[0]).toMatchObject({ panelId: B, patch: { dialogue: [{ text: 'Night came.' }] } })

    // A nudge still waiting, then a step from elsewhere (a chat thumbnail): the stage it was made on saves it as it goes.
    focus(within(stage()).getByLabelText('Line 1'))
    fireEvent.keyDown(within(stage()).getByLabelText('Line 1'), { key: 'ArrowRight' })
    act(() => useAppStore.getState().selectPanel(A))
    expect(within(workspace()).getAllByTestId('panel-stage')).toHaveLength(1)
    await waitFor(() => expect(saved()).toHaveLength(2))
    expect(saved()[1]).toMatchObject({ panelId: C, patch: { dialogue: [{ placement: { x: 0.51, y: 0.8 } }] } })
    expect(keyWarnings.mock.calls.filter((args) => String(args[0]).includes('same key'))).toEqual([])
    vi.restoreAllMocks()
  })

  it('saves what was typed in Scene when stepping to the next panel (Review Focus 3)', async () => {
    const { calls } = mount({ 'panels:update': () => ({ panel: second, warnings: [] }) })
    fireEvent.click(within(workspace()).getByRole('tab', { name: 'Scene' }))
    fireEvent.change(within(workspace()).getByLabelText('Setting'), { target: { value: 'Roof ' } })
    await userEvent.click(within(header()).getByRole('button', { name: 'Next panel' }))
    await waitFor(() => expect(calls.filter((c) => c.channel === 'panels:update')).toHaveLength(1))
    expect(calls.find((c) => c.channel === 'panels:update')?.req).toEqual({ projectId: P, panelId: B, patch: { setting: 'Roof' } satisfies PanelPatch })
    // The next panel starts on Lines, with nothing of the last one's editing.
    expect(within(workspace()).getByRole('tab', { name: 'Lines' })).toHaveAttribute('aria-selected', 'true')
  })

  it('follows the panel when its list reloads', () => {
    mount()
    act(() => usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [second, first] } }))
    expect(within(workspace()).getByRole('heading', { level: 1 })).toHaveTextContent('Panel 1 of 2')
  })
})
