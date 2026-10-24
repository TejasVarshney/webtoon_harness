import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assetUrl } from '@shared/asset-url'
import type { ChatMessage, Panel } from '@shared/types'
import { startEventSync } from '../../events'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { useChatStore } from '../../stores/chat-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { PROJECT_ID as P } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { EPISODE_ID, panel, panelVersion } from '../../test/panel-fixtures'
import { ChatPane } from '../chat/ChatPane'

const NOW = '2026-10-21T10:00:00.000Z'
const A = 'pnl_00000000aa'
const B = 'pnl_00000000bb'
const KEY_A = `panel:${A}`

/** Three attempts, the middle one failed: the ready ones are the only ones with a number (Ruling P7). */
const v1 = panelVersion({ id: 'ver_00000000a1', imagePath: `panels/${A}/ver_00000000a1.png` })
const v2 = panelVersion({ id: 'ver_00000000a2', status: 'failed', error: 'boom', imagePath: null })
const v3 = panelVersion({ id: 'ver_00000000a3', imagePath: `panels/${A}/ver_00000000a3.png` })
const first = panel({ id: A, versions: [v1, v2, v3], currentVersionId: v3.id })
const second = panel({ id: B, versions: [panelVersion({ id: 'ver_00000000b1', imagePath: `panels/${B}/ver_00000000b1.png` })], currentVersionId: 'ver_00000000b1' })

let stopSync: (() => void) | undefined

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId: P, sessionId: 'ses_0000000001', activeEpisodeId: EPISODE_ID })
  usePanelsStore.setState({ ...initialPanelsState, projectId: P, episodesLoaded: true, panelsByEpisode: { [EPISODE_ID]: [first, second] } })
  useChatStore.setState({ messages: {}, streaming: {}, notices: {}, draft: '' })
})
afterEach(() => stopSync?.())

function assistant(id: string, text: string): ChatMessage {
  return { id, role: 'assistant', text, toolCalls: [], stopReason: 'end', model: { endpointId: 'end_0000000000', modelId: 'mock-text' }, raw: null, createdAt: NOW }
}

function mount(handlers: Parameters<typeof installFakeApi>[0] = {}) {
  const api = installFakeApi({ 'sessions:load': () => [], 'panelChat:load': () => [], ...handlers })
  stopSync = startEventSync()
  render(<ChatPane />)
  return api
}

const select = (id: string | null): void => act(() => useAppStore.getState().selectPanel(id))

/**
 * Types into a field without clicking it first. jsdom lays everything out at 0x0, so the resizable group takes
 * a pointer-down anywhere inside it for a grab of the divider and moves focus there; a real browser has real geometry.
 */
async function typeInto(field: HTMLElement, text: string): Promise<void> {
  act(() => field.focus())
  await userEvent.keyboard(text)
}
const side = (): HTMLElement => screen.getByTestId('panel-side-chat')
const label = (): string | null => within(side()).getByTestId('panel-version-label').textContent

describe('PanelSideChat', () => {
  it('opens for the selected panel and closes on Escape', async () => {
    mount()
    expect(screen.queryByTestId('panel-side-chat')).toBeNull()

    select(B)
    expect(side()).toBeInTheDocument()
    expect(within(side()).getByRole('heading')).toHaveTextContent('Panel 2')

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByTestId('panel-side-chat')).toBeNull()
    expect(useAppStore.getState().selectedPanelId).toBeNull()
  })

  it('closes with the close button', async () => {
    mount()
    select(A)
    await userEvent.click(within(side()).getByRole('button', { name: 'Close panel chat' }))
    expect(screen.queryByTestId('panel-side-chat')).toBeNull()
    expect(useAppStore.getState().selectedPanelId).toBeNull()
  })

  it('leaves Escape to an open dialog and to a field that is not the side chat', async () => {
    mount()
    select(A)
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('aria-modal', 'true')
    // A button, not an input: only the dialog check can tell this one apart from the strip or the main chat.
    const button = document.createElement('button')
    dialog.append(button)
    document.body.append(dialog)
    button.focus()
    await userEvent.keyboard('{Escape}')
    expect(useAppStore.getState().selectedPanelId).toBe(A)
    dialog.remove()

    // The model picker, a rename box or any other input owns Escape while it has focus.
    const rename = document.createElement('input')
    document.body.append(rename)
    rename.focus()
    await userEvent.keyboard('{Escape}')
    expect(useAppStore.getState().selectedPanelId).toBe(A)
    rename.remove()

    // Focus on the strip, the main composer or nothing at all still closes it.
    act(() => screen.getAllByTestId('composer-input')[0].focus())
    await userEvent.keyboard('{Escape}')
    expect(useAppStore.getState().selectedPanelId).toBeNull()
  })

  it('shows the current image, and the panel number in the strip', () => {
    mount()
    select(A)
    expect(within(side()).getByRole('img')).toHaveAttribute('src', assetUrl(P, `panels/${A}/ver_00000000a3.png`))
    expect(within(side()).getByRole('heading')).toHaveTextContent('Panel 1')
  })

  it('keeps the main chat mounted while the side chat opens and closes', async () => {
    mount()
    const input = (await screen.findAllByTestId('composer-input'))[0]
    await typeInto(input, 'draft text')
    select(A)
    expect(screen.getAllByTestId('composer-input')).toHaveLength(2)
    expect(screen.getAllByTestId('composer-input')[0]).toBe(input)
    expect(input).toHaveValue('draft text')
    select(null)
    expect(screen.getAllByTestId('composer-input')).toHaveLength(1)
    expect(screen.getAllByTestId('composer-input')[0]).toBe(input)
  })

  it('opens without a session selected', () => {
    useAppStore.setState({ sessionId: null })
    mount()
    select(A)
    expect(side()).toBeInTheDocument()
    expect(screen.getByText('Select or create a session to chat.')).toBeInTheDocument()
  })

  it('loads the panel thread when the selection changes', async () => {
    const { calls } = mount({
      'panelChat:load': (req: { panelId: string }) => (req.panelId === A ? [assistant('msg_00000000a1', 'About panel one')] : [assistant('msg_00000000b1', 'About panel two')])
    })
    select(A)
    expect(await within(side()).findByText('About panel one')).toBeInTheDocument()
    select(B)
    expect(await within(side()).findByText('About panel two')).toBeInTheDocument()
    expect(within(side()).queryByText('About panel one')).toBeNull()
    expect(calls.filter((c) => c.channel === 'panelChat:load').map((c) => c.req)).toEqual([
      { projectId: P, panelId: A },
      { projectId: P, panelId: B }
    ])
    expect(useChatStore.getState().messages[`panel:${B}`]).toHaveLength(1)
  })

  it('shows a thread that fails to load as a notice', async () => {
    mount({
      'panelChat:load': () => {
        throw new Error("Error invoking remote method 'panelChat:load': Error: Unknown panel: pnl_00000000aa")
      }
    })
    select(A)
    expect(await within(side()).findByRole('alert')).toHaveTextContent('Unknown panel: pnl_00000000aa')
    expect(within(side()).getByRole('alert')).not.toHaveTextContent('Error invoking')
  })

  it('sends through panelChat and shows streamed replies', async () => {
    const { calls, emit } = mount({ 'panelChat:send': () => ({ runId: 'run_0000000001' }) })
    select(A)
    const composer = within(side())
    await typeInto(composer.getByTestId('composer-input'), 'make her smile{Enter}')
    expect(calls.find((c) => c.channel === 'panelChat:send')?.req).toEqual({ projectId: P, panelId: A, text: 'make her smile' })
    expect(calls.some((c) => c.channel === 'agent:send')).toBe(false)
    expect(composer.getByTestId('message-user')).toHaveTextContent('make her smile')

    act(() => emit({ type: 'agent.event', projectId: P, threadKey: KEY_A, event: { kind: 'run-started', runId: 'run_0000000001' } }))
    expect(composer.getByTestId('composer-stop')).toBeInTheDocument()
    act(() => emit({ type: 'agent.event', projectId: P, threadKey: KEY_A, event: { kind: 'text-delta', runId: 'run_0000000001', text: 'Giving her a smile' } }))
    expect(composer.getByText('Giving her a smile')).toBeInTheDocument()
    act(() => emit({ type: 'agent.event', projectId: P, threadKey: KEY_A, event: { kind: 'message', runId: 'run_0000000001', message: assistant('msg_00000000a9', 'Updated.') } }))
    act(() => emit({ type: 'agent.event', projectId: P, threadKey: KEY_A, event: { kind: 'run-finished', runId: 'run_0000000001', outcome: 'end', error: null } }))
    expect(composer.getByTestId('message-assistant')).toHaveTextContent('Updated.')
    expect(composer.getByTestId('composer-send')).toBeInTheDocument()
    // The reply belongs to the side chat; the main thread did not get it.
    expect(useChatStore.getState().messages['ses_0000000001'] ?? []).toEqual([])
  })

  it('sends to the panel it was opened for, after the selection moved on and back', async () => {
    const { calls } = mount({ 'panelChat:send': () => ({ runId: 'run_0000000001' }) })
    select(A)
    select(B)
    await typeInto(within(side()).getByTestId('composer-input'), 'zoom out{Enter}')
    expect(calls.find((c) => c.channel === 'panelChat:send')?.req).toEqual({ projectId: P, panelId: B, text: 'zoom out' })
  })

  it('has no way to attach images, which panelChat:send cannot carry', () => {
    mount()
    select(A)
    expect(within(side()).queryByTestId('composer-attach')).toBeNull()
    expect(screen.getAllByTestId('composer-attach')).toHaveLength(1)
  })

  it('stops the running panel run with its run id', async () => {
    const { calls } = mount({ 'panelChat:cancel': () => undefined })
    useAppStore.setState({ runningThreads: { [KEY_A]: 'run_0000000007', ses_0000000001: 'run_0000000008' } })
    select(A)
    await userEvent.click(within(side()).getByTestId('composer-stop'))
    await waitFor(() => expect(calls.find((c) => c.channel === 'panelChat:cancel')?.req).toEqual({ runId: 'run_0000000007' }))
  })

  it('does not take the main chat run as its own', () => {
    mount()
    useAppStore.setState({ runningThreads: { ses_0000000001: 'run_0000000008' } })
    select(A)
    expect(within(side()).getByTestId('composer-send')).toBeInTheDocument()
    expect(within(side()).queryByTestId('composer-stop')).toBeNull()
  })

  it('shows a rejected send as a cleaned notice and takes the message back', async () => {
    mount({
      'panelChat:send': () => {
        throw new Error("Error invoking remote method 'panelChat:send': Error: A run is already in progress for panel pnl_00000000aa")
      }
    })
    select(A)
    await typeInto(within(side()).getByTestId('composer-input'), 'again{Enter}')
    expect(await within(side()).findByRole('alert')).toHaveTextContent('A run is already in progress for panel pnl_00000000aa')
    expect(within(side()).getByRole('alert')).not.toHaveTextContent('Error invoking')
    expect(within(side()).queryByTestId('message-user')).toBeNull()
  })

  it('shows a failed stop as a notice', async () => {
    mount({
      'panelChat:cancel': () => {
        throw new Error("Error invoking remote method 'panelChat:cancel': Error: nope")
      }
    })
    useAppStore.setState({ runningThreads: { [KEY_A]: 'run_0000000007' } })
    select(A)
    await userEvent.click(within(side()).getByTestId('composer-stop'))
    expect(await within(side()).findByRole('alert')).toHaveTextContent('nope')
  })

  it('says so when the panel is not in the open episode, and can be closed', async () => {
    const { calls } = mount()
    select('pnl_00000000ff')
    expect(side()).toHaveTextContent('Panel not in the current episode')
    expect(within(side()).queryByTestId('composer-input')).toBeNull()
    expect(calls.some((c) => c.channel === 'panelChat:load')).toBe(false)
    await userEvent.click(within(side()).getByRole('button', { name: 'Close panel chat' }))
    expect(useAppStore.getState().selectedPanelId).toBeNull()
  })

  it('loads the episode itself when the strip has not been opened yet', async () => {
    usePanelsStore.setState({ ...initialPanelsState })
    const { calls } = mount({ 'episodes:list': () => [{ id: EPISODE_ID, number: 1, title: 'Episode 1', synopsis: '', panelIds: [A, B], createdAt: NOW, updatedAt: NOW }], 'panels:list': () => [first, second] })
    select(B)
    expect(side()).toHaveTextContent('Loading panel')
    expect(side()).not.toHaveTextContent('Panel not in the current episode')
    expect(await within(side()).findByRole('heading')).toHaveTextContent('Panel 2')
    expect(calls.map((c) => c.channel)).toContain('episodes:list')
  })

  it('follows the panel when its list reloads', async () => {
    mount()
    select(A)
    expect(label()).toBe('v2 / 2')
    act(() => usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [second, first] } }))
    expect(within(side()).getByRole('heading')).toHaveTextContent('Panel 2')
  })
})

describe('VersionSwitcher', () => {
  it('numbers ready versions only, and reverts to the previous ready one', async () => {
    const reverted = { ...first, currentVersionId: v1.id }
    const { calls } = mount({ 'panels:revert': () => reverted, 'panels:list': () => [reverted, second] })
    select(A)
    expect(label()).toBe('v2 / 2')

    await userEvent.click(within(side()).getByTestId('version-prev'))
    expect(calls.find((c) => c.channel === 'panels:revert')?.req).toEqual({ projectId: P, panelId: A, versionId: v1.id })
    await waitFor(() => expect(label()).toBe('v1 / 2'))
  })

  it('steps forward again with next', async () => {
    const atFirst = { ...first, currentVersionId: v1.id }
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [atFirst, second] } })
    const { calls } = mount({ 'panels:revert': () => first, 'panels:list': () => [first, second] })
    select(A)
    expect(label()).toBe('v1 / 2')
    await userEvent.click(within(side()).getByTestId('version-next'))
    expect(calls.find((c) => c.channel === 'panels:revert')?.req).toEqual({ projectId: P, panelId: A, versionId: v3.id })
    await waitFor(() => expect(label()).toBe('v2 / 2'))
  })

  it('disables the buttons at the ends of the history', () => {
    mount()
    select(A)
    expect(within(side()).getByTestId('version-next')).toBeDisabled()
    expect(within(side()).getByTestId('version-prev')).toBeEnabled()
    act(() => usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [{ ...first, currentVersionId: v1.id }, second] } }))
    expect(within(side()).getByTestId('version-prev')).toBeDisabled()
    expect(within(side()).getByTestId('version-next')).toBeEnabled()
  })

  it('has nothing to step through when the panel has one version', () => {
    mount()
    select(B)
    expect(label()).toBe('v1 / 1')
    expect(within(side()).getByTestId('version-prev')).toBeDisabled()
    expect(within(side()).getByTestId('version-next')).toBeDisabled()
  })

  it('shows no number for a panel without a ready image', () => {
    const empty = panel({ id: A, versions: [panelVersion({ id: 'ver_00000000a1', status: 'pending', imagePath: null })], currentVersionId: null })
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [empty, second] } })
    mount()
    select(A)
    expect(label()).toBe('No image yet')
    expect(within(side()).getByTestId('version-prev')).toBeDisabled()
    expect(within(side()).getByTestId('version-next')).toBeDisabled()
  })

  it('shows a failed revert and keeps the label', async () => {
    mount({
      'panels:revert': () => {
        throw new Error("Error invoking remote method 'panels:revert': Error: Version ver_00000000a1 is not ready")
      }
    })
    select(A)
    await userEvent.click(within(side()).getByTestId('version-prev'))
    expect(await within(side()).findByRole('alert')).toHaveTextContent('Version ver_00000000a1 is not ready')
    expect(label()).toBe('v2 / 2')
    expect(within(side()).getByTestId('version-prev')).toBeEnabled()
  })

  it('does not send a second revert while one is in flight', async () => {
    let release: (p: Panel) => void = () => undefined
    const { calls } = mount({
      'panels:revert': () => new Promise<Panel>((resolve) => (release = resolve)),
      'panels:list': () => [{ ...first, currentVersionId: v1.id }, second]
    })
    select(A)
    await userEvent.click(within(side()).getByTestId('version-prev'))
    expect(within(side()).getByTestId('version-prev')).toBeDisabled()
    expect(within(side()).getByTestId('version-next')).toBeDisabled()
    expect(calls.filter((c) => c.channel === 'panels:revert')).toHaveLength(1)
    await act(async () => release({ ...first, currentVersionId: v1.id }))
    await waitFor(() => expect(label()).toBe('v1 / 2'))
  })
})
