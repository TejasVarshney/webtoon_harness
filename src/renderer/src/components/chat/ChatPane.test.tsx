import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChatMessage, ModelRegistryView } from '@shared/types'
import { startEventSync } from '../../events'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { useChatStore } from '../../stores/chat-store'
import { useModelsStore } from '../../stores/models-store'
import { installFakeApi } from '../../test/fake-api'
import { ChatPane } from './ChatPane'

const P = 'prj_aaaaaaaaaa'
const S = 'ses_0000000001'
const NOW = '2026-10-21T10:00:00.000Z'

const mockView: ModelRegistryView = {
  endpoints: [{ id: 'end_0000000000', name: 'Mock (offline)', kind: 'mock', baseUrl: 'mock://local', options: {}, hasKey: false }],
  models: [{ id: 'mdl_000000000a', endpointId: 'end_0000000000', modelId: 'mock-text', label: 'Mock text', capabilities: ['text', 'vision'], params: {}, maxReferenceImages: 4 }],
  roles: { agent: 'mdl_000000000a' },
  effectiveRoles: { agent: 'mdl_000000000a', panelChat: 'mdl_000000000a', vision: null, image: null, imageEdit: null }
}

function assistant(id: string, text: string): ChatMessage {
  return { id, role: 'assistant', text, toolCalls: [], stopReason: 'end', model: { endpointId: 'end_0000000000', modelId: 'mock-text' }, raw: null, createdAt: NOW }
}

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId: P, sessionId: S, activeEpisodeId: 'epi_0000000001' })
  useChatStore.setState({ messages: {}, streaming: {}, notices: {} })
  useModelsStore.setState({ view: mockView })
})

describe('ChatPane', () => {
  it('loads the session, sends with the active episode, and follows agent events', async () => {
    const { calls, emit } = installFakeApi({
      'sessions:load': () => [assistant('msg_0000000009', 'Earlier reply')],
      'agent:send': () => ({ runId: 'run_0000000001' })
    })
    const stop = startEventSync()
    render(<ChatPane />)
    expect(await screen.findByText('Earlier reply')).toBeInTheDocument()
    expect(screen.getByTestId('mock-banner')).toHaveTextContent("You're using the offline mock model. Add a real endpoint in Settings → Models.")

    await userEvent.type(screen.getByTestId('composer-input'), 'Hi{Enter}')
    expect(screen.getByTestId('message-user')).toHaveTextContent('Hi')
    expect(calls.find((c) => c.channel === 'agent:send')?.req).toEqual({
      projectId: P,
      sessionId: S,
      text: 'Hi',
      imagePaths: [],
      activeEpisodeId: 'epi_0000000001'
    })

    act(() => emit({ type: 'agent.event', projectId: P, threadKey: S, event: { kind: 'run-started', runId: 'run_0000000001' } }))
    expect(screen.getByTestId('composer-stop')).toBeInTheDocument()
    act(() => emit({ type: 'agent.event', projectId: P, threadKey: S, event: { kind: 'message', runId: 'run_0000000001', message: assistant('msg_0000000010', 'Hello from mock') } }))
    act(() => emit({ type: 'agent.event', projectId: P, threadKey: S, event: { kind: 'run-finished', runId: 'run_0000000001', outcome: 'end', error: null } }))
    expect(screen.getAllByTestId('message-assistant').at(-1)).toHaveTextContent('Hello from mock')
    expect(screen.getByTestId('composer-send')).toBeInTheDocument()
    expect(useAppStore.getState().runningThreads).toEqual({})
    stop()
  })

  it('cancels the running run on Stop', async () => {
    const { calls } = installFakeApi({ 'sessions:load': () => [], 'agent:cancel': () => undefined })
    useAppStore.setState({ runningThreads: { [S]: 'run_0000000007' } })
    render(<ChatPane />)
    await userEvent.click(screen.getByTestId('composer-stop'))
    await waitFor(() => expect(calls.find((c) => c.channel === 'agent:cancel')?.req).toEqual({ runId: 'run_0000000007' }))
  })

  it('shows a rejected send as a cleaned error notice', async () => {
    installFakeApi({
      'sessions:load': () => [],
      'agent:send': () => {
        throw new Error("Error invoking remote method 'agent:send': Error: A run is already in progress for session ses_0000000001")
      }
    })
    render(<ChatPane />)
    await userEvent.type(await screen.findByTestId('composer-input'), 'Hi{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('A run is already in progress for session ses_0000000001')
    expect(screen.getByRole('alert')).not.toHaveTextContent('Error invoking')
    expect(screen.queryByTestId('message-user')).toBeNull()
  })

  it('shows the shared draft in the composer, follows edits, and clears it on send', async () => {
    const { calls } = installFakeApi({ 'sessions:load': () => [], 'agent:send': () => ({ runId: 'run_0000000001' }) })
    useChatStore.setState({ draft: '' })
    render(<ChatPane />)
    const input = await screen.findByTestId('composer-input')
    act(() => useChatStore.getState().setDraft('Help me design the character "a new character"'))
    expect(input).toHaveValue('Help me design the character "a new character"')
    await userEvent.type(input, '!')
    expect(useChatStore.getState().draft).toBe('Help me design the character "a new character"!')
    await userEvent.type(input, '{Enter}')
    expect(calls.find((c) => c.channel === 'agent:send')?.req).toMatchObject({ text: 'Help me design the character "a new character"!' })
    expect(useChatStore.getState().draft).toBe('')
    expect(input).toHaveValue('')
  })

  it('keeps a draft made before a session was selected until the composer appears', async () => {
    installFakeApi({ 'sessions:load': () => [] })
    useChatStore.setState({ draft: '' })
    useAppStore.setState({ sessionId: null })
    render(<ChatPane />)
    expect(screen.queryByTestId('composer-input')).toBeNull()
    act(() => useChatStore.getState().setDraft('Waiting'))
    act(() => useAppStore.setState({ sessionId: S }))
    expect(await screen.findByTestId('composer-input')).toHaveValue('Waiting')
  })

  it('reloads models when the registry changes', async () => {
    const { emit } = installFakeApi({ 'models:get': () => ({ ...mockView, effectiveRoles: { ...mockView.effectiveRoles, agent: null } }) })
    const stop = startEventSync()
    emit({ type: 'models.changed' })
    await waitFor(() => expect(useModelsStore.getState().view?.effectiveRoles.agent).toBeNull())
    stop()
  })
})
