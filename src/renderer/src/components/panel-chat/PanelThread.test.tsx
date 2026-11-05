import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ChatMessage } from '@shared/types'
import { startEventSync } from '../../events'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { useChatStore } from '../../stores/chat-store'
import { PROJECT_ID as P } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { PanelThread } from './PanelThread'

const NOW = '2026-10-21T10:00:00.000Z'
const A = 'pnl_00000000aa'
const B = 'pnl_00000000bb'
const KEY_A = `panel:${A}`

let stopSync: (() => void) | undefined

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId: P, sessionId: 'ses_0000000001' })
  useChatStore.setState({ messages: {}, streaming: {}, notices: {}, draft: '' })
})
afterEach(() => stopSync?.())

function assistant(id: string, text: string): ChatMessage {
  return { id, role: 'assistant', text, toolCalls: [], stopReason: 'end', model: { endpointId: 'end_0000000000', modelId: 'mock-text' }, raw: null, createdAt: NOW }
}

function mount(handlers: Parameters<typeof installFakeApi>[0] = {}, panelId = A) {
  const api = installFakeApi({ 'panelChat:load': () => [], ...handlers })
  stopSync = startEventSync()
  const view = render(<PanelThread projectId={P} panelId={panelId} />)
  return { ...api, rerender: (id: string) => view.rerender(<PanelThread key={id} projectId={P} panelId={id} />) }
}

describe('PanelThread', () => {
  it('loads the panel thread, and the next one when the panel changes', async () => {
    const { calls, rerender } = mount({
      'panelChat:load': (req: { panelId: string }) => (req.panelId === A ? [assistant('msg_00000000a1', 'About panel one')] : [assistant('msg_00000000b1', 'About panel two')])
    })
    expect(await screen.findByText('About panel one')).toBeInTheDocument()
    rerender(B)
    expect(await screen.findByText('About panel two')).toBeInTheDocument()
    expect(screen.queryByText('About panel one')).toBeNull()
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
    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown panel: pnl_00000000aa')
    expect(screen.getByRole('alert')).not.toHaveTextContent('Error invoking')
  })

  it('sends through panelChat and shows streamed replies', async () => {
    const { calls, emit } = mount({ 'panelChat:send': () => ({ runId: 'run_0000000001' }) })
    await userEvent.type(screen.getByTestId('composer-input'), 'make her smile{Enter}')
    expect(calls.find((c) => c.channel === 'panelChat:send')?.req).toEqual({ projectId: P, panelId: A, text: 'make her smile' })
    expect(calls.some((c) => c.channel === 'agent:send')).toBe(false)
    expect(screen.getByTestId('message-user')).toHaveTextContent('make her smile')

    act(() => emit({ type: 'agent.event', projectId: P, threadKey: KEY_A, event: { kind: 'run-started', runId: 'run_0000000001' } }))
    expect(screen.getByTestId('composer-stop')).toBeInTheDocument()
    act(() => emit({ type: 'agent.event', projectId: P, threadKey: KEY_A, event: { kind: 'text-delta', runId: 'run_0000000001', text: 'Giving her a smile' } }))
    expect(screen.getByText('Giving her a smile')).toBeInTheDocument()
    act(() => emit({ type: 'agent.event', projectId: P, threadKey: KEY_A, event: { kind: 'message', runId: 'run_0000000001', message: assistant('msg_00000000a9', 'Updated.') } }))
    act(() => emit({ type: 'agent.event', projectId: P, threadKey: KEY_A, event: { kind: 'run-finished', runId: 'run_0000000001', outcome: 'end', error: null } }))
    expect(screen.getByTestId('message-assistant')).toHaveTextContent('Updated.')
    expect(screen.getByTestId('composer-send')).toBeInTheDocument()
    // The reply belongs to the panel's thread; the main thread did not get it.
    expect(useChatStore.getState().messages['ses_0000000001'] ?? []).toEqual([])
  })

  it('sends to the panel it now shows, after the panel changed', async () => {
    const { calls, rerender } = mount({ 'panelChat:send': () => ({ runId: 'run_0000000001' }) })
    rerender(B)
    await userEvent.type(screen.getByTestId('composer-input'), 'zoom out{Enter}')
    expect(calls.find((c) => c.channel === 'panelChat:send')?.req).toEqual({ projectId: P, panelId: B, text: 'zoom out' })
  })

  it('has no way to attach images, which panelChat:send cannot carry', () => {
    mount()
    expect(screen.queryByTestId('composer-attach')).toBeNull()
  })

  it('stops the running panel run with its run id', async () => {
    const { calls } = mount({ 'panelChat:cancel': () => undefined })
    act(() => useAppStore.setState({ runningThreads: { [KEY_A]: 'run_0000000007', ses_0000000001: 'run_0000000008' } }))
    await userEvent.click(screen.getByTestId('composer-stop'))
    await waitFor(() => expect(calls.find((c) => c.channel === 'panelChat:cancel')?.req).toEqual({ runId: 'run_0000000007' }))
  })

  it('does not take the main chat run as its own', () => {
    useAppStore.setState({ runningThreads: { ses_0000000001: 'run_0000000008' } })
    mount()
    expect(screen.getByTestId('composer-send')).toBeInTheDocument()
    expect(screen.queryByTestId('composer-stop')).toBeNull()
  })

  it('shows a rejected send as a cleaned notice and takes the message back', async () => {
    mount({
      'panelChat:send': () => {
        throw new Error("Error invoking remote method 'panelChat:send': Error: A run is already in progress for panel pnl_00000000aa")
      }
    })
    await userEvent.type(screen.getByTestId('composer-input'), 'again{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('A run is already in progress for panel pnl_00000000aa')
    expect(screen.getByRole('alert')).not.toHaveTextContent('Error invoking')
    expect(screen.queryByTestId('message-user')).toBeNull()
  })

  it('shows a failed stop as a notice', async () => {
    useAppStore.setState({ runningThreads: { [KEY_A]: 'run_0000000007' } })
    mount({
      'panelChat:cancel': () => {
        throw new Error("Error invoking remote method 'panelChat:cancel': Error: nope")
      }
    })
    await userEvent.click(screen.getByTestId('composer-stop'))
    expect(await screen.findByRole('alert')).toHaveTextContent('nope')
  })
})
