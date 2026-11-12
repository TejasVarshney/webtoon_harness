import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { DialogueLine, Panel, PanelPatch } from '@shared/types'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialCharactersState, useCharactersStore } from '../../stores/characters-store'
import { initialItemsState, useItemsStore } from '../../stores/items-store'
import { initialLocationsState, useLocationsStore } from '../../stores/locations-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { character, PROJECT_ID as P } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { EPISODE_ID, panel, panelVersion } from '../../test/panel-fixtures'
import { PanelTools } from './PanelTools'

const A = 'pnl_0000000001'
const hello: DialogueLine = { id: 'dlg_0000000001', speakerId: null, kind: 'narration', text: 'Hello.', placement: null, style: null, tail: null }
const v1 = panelVersion({ id: 'ver_00000000a1', imagePath: `panels/${A}/ver_00000000a1.png` })
const v2 = panelVersion({ id: 'ver_00000000a2', imagePath: `panels/${A}/ver_00000000a2.png` })

let stored: Panel

beforeEach(() => {
  stored = panel({ id: A, dialogue: [hello], versions: [v1, v2], currentVersionId: v2.id })
  useAppStore.setState({ ...initialAppState, projectId: P, activeEpisodeId: EPISODE_ID, selectedPanelId: A, selectedPanelIds: [A] })
  usePanelsStore.setState({ ...initialPanelsState, projectId: P, episodesLoaded: true, panelsByEpisode: { [EPISODE_ID]: [stored] } })
  useCharactersStore.setState({ ...initialCharactersState, projectId: P, characters: [character()], loaded: true })
  useItemsStore.setState({ ...initialItemsState, projectId: P, items: [], loaded: true })
  useLocationsStore.setState({ ...initialLocationsState, projectId: P, locations: [], loaded: true })
})

/** The tools as a card hands them the panel: fed from the store, so a save or a revert reaches them. */
function Host() {
  const p = usePanelsStore((s) => s.panelsByEpisode[EPISODE_ID]?.find((x) => x.id === A))
  const [line, setLine] = useState<number | null>(null)
  return p === undefined ? null : <PanelTools panel={p} selectedLine={line} onSelectLine={setLine} linesRequest={null} onAddBubble={() => undefined} addingBubble={false} />
}

function mount(handlers: Parameters<typeof installFakeApi>[0] = {}) {
  const api = installFakeApi({
    'panels:list': () => [stored],
    'panels:update': (req: { patch: PanelPatch }) => {
      stored = { ...stored, ...req.patch } as Panel
      return { panel: stored, warnings: [] }
    },
    ...handlers
  })
  render(<Host />)
  return api
}

const tool = (name: string): HTMLElement => screen.getByRole('button', { name })

describe('PanelTools', () => {
  it('has the tools in order, each with its name', () => {
    mount()
    const bar = screen.getByRole('toolbar', { name: 'Panel tools' })
    expect(within(bar).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim())).toEqual(['Lines', 'Crop', 'Versions', 'Layout', 'Add bubble', 'Upload image', 'Redraw', 'Sketch', 'Focus', 'Delete'])
  })

  it('Redraw starts a generation', async () => {
    const { calls } = mount({ 'panels:generate': () => undefined })
    await userEvent.click(tool('Redraw'))
    await waitFor(() => expect(calls.some((c) => c.channel === 'panels:generate')).toBe(true))
    expect(calls.find((c) => c.channel === 'panels:generate')?.req).toEqual({ projectId: P, panelId: A })
    expect(useAppStore.getState().focusedPanelId).toBeNull()
  })

  it('does not start a second generation while one is pending', () => {
    stored = panel({ id: A, versions: [v1, panelVersion({ id: 'ver_00000000a3', status: 'pending', imagePath: null })], currentVersionId: v1.id })
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [stored] } })
    mount()
    expect(tool('Redraw')).toBeDisabled()
  })

  it("shows a failed redraw's message", async () => {
    mount({
      'panels:generate': () => {
        throw new Error('Unknown panel: pnl_0000000001')
      }
    })
    await userEvent.click(tool('Redraw'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown panel: pnl_0000000001')
  })

  it('has no cast, items or scene: Lines holds the lines alone, and the rest is in focus mode', async () => {
    mount()
    for (const name of ['Cast', 'Items', 'Scene']) expect(screen.queryByRole('button', { name })).toBeNull()
    await userEvent.click(tool('Lines'))
    const popover = screen.getByRole('dialog', { name: 'Lines' })
    expect(within(popover).queryByRole('tablist')).toBeNull()
    expect(within(popover).getAllByRole('listitem')).toHaveLength(1)
  })

  it('Lines edits a line in place', async () => {
    const { calls } = mount()
    await userEvent.click(tool('Lines'))
    const popover = screen.getByRole('dialog', { name: 'Lines' })
    const text = within(within(popover).getAllByRole('listitem')[0]).getByLabelText('Text')
    act(() => text.focus())
    fireEvent.change(text, { target: { value: 'Hi.' } })
    act(() => text.blur())
    await waitFor(() => expect(calls.some((c) => c.channel === 'panels:update')).toBe(true))
    const patch = (calls.find((c) => c.channel === 'panels:update')?.req as { patch: PanelPatch }).patch
    expect(patch.dialogue?.[0]).toMatchObject({ text: 'Hi.' })
    expect(useAppStore.getState().focusedPanelId).toBeNull()
  })

  it('closes the open tool on Escape, and when another is opened', async () => {
    mount()
    await userEvent.click(tool('Lines'))
    expect(screen.getByRole('dialog', { name: 'Lines' })).toBeInTheDocument()
    await userEvent.click(tool('Versions'))
    expect(screen.queryByRole('dialog', { name: 'Lines' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Versions' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes the open tool when the press lands anywhere else', async () => {
    mount()
    await userEvent.click(tool('Lines'))
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Upload image stores a new version without opening focus mode', async () => {
    const { calls } = mount({ 'panels:uploadImage': () => v2 })
    await userEvent.click(tool('Upload image'))
    await waitFor(() => expect(calls.some((c) => c.channel === 'panels:uploadImage')).toBe(true))
    expect(calls.find((c) => c.channel === 'panels:uploadImage')?.req).toEqual({ projectId: P, panelId: A })
    await waitFor(() => expect(calls.some((c) => c.channel === 'panels:list')).toBe(true))
    expect(useAppStore.getState().focusedPanelId).toBeNull()
  })

  it('Versions switches the current image in place', async () => {
    const reverted = { ...stored, currentVersionId: v1.id }
    const { calls } = mount({ 'panels:revert': () => reverted, 'panels:list': () => [reverted] })
    await userEvent.click(tool('Versions'))
    const popover = screen.getByRole('dialog', { name: 'Versions' })
    expect(within(popover).getByTestId('panel-version-label')).toHaveTextContent('v2 / 2')
    await userEvent.click(within(popover).getByRole('button', { name: 'Previous version' }))
    expect(calls.find((c) => c.channel === 'panels:revert')?.req).toEqual({ projectId: P, panelId: A, versionId: v1.id })
    await waitFor(() => expect(within(screen.getByRole('dialog', { name: 'Versions' })).getByTestId('panel-version-label')).toHaveTextContent('v1 / 2'))
    expect(useAppStore.getState().focusedPanelId).toBeNull()
  })

  it('Crop opens the crop dialog on the current picture, and Cancel closes it', async () => {
    mount()
    await userEvent.click(tool('Crop'))
    const dialog = screen.getByRole('dialog', { name: 'Crop panel' })
    expect(dialog.querySelector('img')?.getAttribute('src')).toContain(`panels/${A}/ver_00000000a2.png`)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('cannot crop a panel whose picture is still being drawn', () => {
    stored = panel({ id: A, versions: [panelVersion({ id: 'ver_00000000a3', status: 'pending', imagePath: null })], currentVersionId: null })
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [stored] } })
    mount()
    expect(tool('Crop')).toBeDisabled()
    expect(tool('Crop')).toHaveAttribute('title', 'Crop (the panel has no picture yet)')
  })

  it('cannot crop a WebP picture', () => {
    const webp = panelVersion({ id: 'ver_00000000a4', imagePath: `panels/${A}/ver_00000000a4.webp` })
    stored = panel({ id: A, versions: [webp], currentVersionId: webp.id })
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [stored] } })
    mount()
    expect(tool('Crop')).toBeDisabled()
    expect(tool('Crop')).toHaveAttribute('title', "Crop (a WebP or GIF picture can't be cropped)")
  })

  it('Layout changes the shape at once, without opening focus mode', async () => {
    const { calls } = mount()
    await userEvent.click(tool('Layout'))
    const popover = screen.getByRole('dialog', { name: 'Layout' })
    const shapes = within(popover).getByRole('group', { name: 'Panel shape' })
    expect(within(shapes).getByRole('button', { name: '2:3' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(shapes).getByRole('button', { name: '16:9' }))
    await waitFor(() => expect(calls.some((c) => c.channel === 'panels:update')).toBe(true))
    expect((calls.find((c) => c.channel === 'panels:update')?.req as { patch: PanelPatch }).patch).toEqual({ aspect: '16:9' })
    expect(useAppStore.getState().focusedPanelId).toBeNull()
  })

  it('Layout sets the width on the strip, keeping the corner and the strip edge, and the side', async () => {
    stored = { ...stored, placement: { x: 20, y: 0, width: 220 } }
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [stored] } })
    const { calls } = mount({ 'panels:place': () => undefined })
    await userEvent.click(tool('Layout'))
    const popover = screen.getByRole('dialog', { name: 'Layout' })
    const widths = within(popover).getByRole('group', { name: 'Panel width' })
    expect(within(widths).getByRole('button', { name: 'Half' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(widths).getByRole('button', { name: 'One third' }))
    await userEvent.click(within(widths).getByRole('button', { name: 'Full width' }))
    await userEvent.click(within(within(popover).getByRole('group', { name: 'Panel position' })).getByRole('button', { name: 'Right' }))
    await waitFor(() => expect(calls.filter((c) => c.channel === 'panels:place')).toHaveLength(3))
    expect(calls.filter((c) => c.channel === 'panels:place').map((c) => (c.req as { moves: unknown }).moves)).toEqual([
      [{ panelId: A, placement: { x: 20, y: 0, width: 147 } }],
      [{ panelId: A, placement: { x: 0, y: 0, width: 440 } }],
      [{ panelId: A, placement: { x: 220, y: 0, width: 220 } }]
    ])
  })

  it('Layout sets a slanted cut, or a straight frame that keeps it, in place', async () => {
    const { calls } = mount()
    await userEvent.click(tool('Layout'))
    const frames = within(screen.getByRole('dialog', { name: 'Layout' })).getByRole('group', { name: 'Panel frame' })
    expect(within(frames).getByRole('button', { name: 'Straight' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(frames).getByRole('button', { name: 'Top falls' }))
    await waitFor(() => expect(within(frames).getByRole('button', { name: 'Top falls' })).toHaveAttribute('aria-pressed', 'true'))
    await userEvent.click(within(frames).getByRole('button', { name: 'Straight' }))
    await waitFor(() => expect(calls.filter((c) => c.channel === 'panels:update')).toHaveLength(2))
    expect(calls.filter((c) => c.channel === 'panels:update').map((c) => (c.req as { patch: PanelPatch }).patch)).toEqual([{ frame: 'slanted', cut: 'top-down' }, { frame: 'bordered' }])
    expect(useAppStore.getState().focusedPanelId).toBeNull()
  })

  it('offers no frame to a tall panel, which fades instead', async () => {
    stored = { ...stored, aspect: '1:3' }
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [stored] } })
    mount()
    await userEvent.click(tool('Layout'))
    const frames = within(screen.getByRole('dialog', { name: 'Layout' })).getByRole('group', { name: 'Panel frame' })
    expect(within(frames).getByRole('button', { name: 'Top falls' })).toBeDisabled()
  })

  it('Layout offers only the layouts there are panels enough for, from this one', async () => {
    mount()
    await userEvent.click(tool('Layout'))
    const layouts = within(screen.getByRole('dialog', { name: 'Layout' })).getByRole('group', { name: 'Layouts' })
    expect(within(layouts).getByRole('button', { name: 'Full width' })).toBeEnabled()
    expect(within(layouts).getByRole('button', { name: 'Two across' })).toBeDisabled()
    expect(within(layouts).getByRole('button', { name: 'Two across' })).toHaveAttribute('title', 'Two across needs 1 more panel after this one')
  })

  it('Focus opens focus mode', async () => {
    mount()
    await userEvent.click(tool('Focus'))
    expect(useAppStore.getState().focusedPanelId).toBe(A)
    expect(useAppStore.getState().focusSketch).toBe(false)
  })

  it('Sketch opens focus mode on the canvas', async () => {
    mount()
    await userEvent.click(tool('Sketch'))
    expect(useAppStore.getState().focusedPanelId).toBe(A)
    expect(useAppStore.getState().focusSketch).toBe(true)
  })

  it('Delete asks first', async () => {
    const { calls } = mount({ 'panels:delete': () => undefined, 'panels:list': () => [] })
    await userEvent.click(tool('Delete'))
    const confirm = screen.getByRole('dialog', { name: 'Delete panel' })
    expect(calls.some((c) => c.channel === 'panels:delete')).toBe(false)

    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(calls.some((c) => c.channel === 'panels:delete')).toBe(false)

    await userEvent.click(tool('Delete'))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete panel' })).getByRole('button', { name: 'Delete panel' }))
    await waitFor(() => expect(calls.some((c) => c.channel === 'panels:delete')).toBe(true))
    expect(calls.find((c) => c.channel === 'panels:delete')?.req).toEqual({ projectId: P, panelId: A })
  })

  it('keeps presses, clicks and double clicks inside its tools and popovers from the card and the strip', async () => {
    installFakeApi({ 'panels:list': () => [stored] })
    const seen: string[] = []
    const record = (e: { type: string }): void => void seen.push(e.type)
    render(
      <div onClick={record} onDoubleClick={record} onPointerDown={record}>
        <Host />
      </div>
    )
    const bar = screen.getByRole('toolbar', { name: 'Panel tools' })
    await userEvent.click(within(bar).getByRole('button', { name: 'Lines' }))
    const field = within(screen.getByRole('dialog', { name: 'Lines' })).getByLabelText('Text')
    await userEvent.click(field)
    fireEvent.doubleClick(field)
    fireEvent.pointerDown(bar)
    expect(seen).toEqual([])
  })
})
