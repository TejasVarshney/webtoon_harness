import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ModelRegistryView, ProjectMeta } from '@shared/types'
import { continueStoryPrompt } from '@shared/prompts'
import { startEventSync } from '../../events'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { useChatStore } from '../../stores/chat-store'
import { useModelsStore } from '../../stores/models-store'
import { installFakeApi } from '../../test/fake-api'
import { ChatHeader } from './ChatHeader'
import { ChatPane } from './ChatPane'

const P = 'prj_aaaaaaaaaa'
const S = 'ses_0000000001'
const NOW = '2026-10-21T10:00:00.000Z'
const PROMPT = 'Continue the story: plan the next beats and draw the next 4 panels.'

const view: ModelRegistryView = {
  endpoints: [{ id: 'end_0000000000', name: 'Mock (offline)', kind: 'mock', baseUrl: 'mock://local', options: {}, hasKey: false }],
  models: [{ id: 'mdl_000000000a', endpointId: 'end_0000000000', modelId: 'mock-text', label: 'Mock text', capabilities: ['text', 'vision'], params: {}, maxReferenceImages: 4 }],
  roles: { agent: 'mdl_000000000a' },
  effectiveRoles: { agent: 'mdl_000000000a', panelChat: 'mdl_000000000a', vision: null, image: null, imageEdit: null }
}

function meta(o: Partial<ProjectMeta> = {}): ProjectMeta {
  return {
    id: P,
    title: 'Moon Diary',
    logline: '',
    stylePreset: 'Clean',
    defaultAspect: '2:3',
    autopilotPanels: 4,
    consistencyRetries: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...o
  }
}

// Continue story lives in the top bar (ChatHeader), over the chat it sends into.
function renderChat(): void {
  render(
    <>
      <ChatHeader />
      <ChatPane />
    </>
  )
}

let stopSync: (() => void) | undefined
beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projects: [meta()], projectId: P, sessionId: S, activeEpisodeId: 'epi_0000000001' })
  useChatStore.setState({ messages: {}, streaming: {}, notices: {}, draft: '' })
  useModelsStore.setState({ view })
})
afterEach(() => stopSync?.())

describe('continueStoryPrompt', () => {
  it('is pinned to the spec wording', () => {
    expect(continueStoryPrompt(4)).toBe(PROMPT)
    expect(continueStoryPrompt(1)).toBe('Continue the story: plan the next beats and draw the next 1 panels.')
  })

  it('the continue prompt has no mode', () => {
    expect(continueStoryPrompt(4)).not.toMatch(/mode|-led/i)
  })
})

describe('continue button', () => {
  it('shows on any project with a session and sends the pinned prompt', async () => {
    const { calls } = installFakeApi({ 'sessions:load': () => [], 'agent:send': () => ({ runId: 'run_0000000001' }) })
    renderChat()
    await userEvent.click(await screen.findByTestId('continue-story'))
    expect(calls.find((c) => c.channel === 'agent:send')?.req).toEqual({ projectId: P, sessionId: S, text: PROMPT, imagePaths: [], activeEpisodeId: 'epi_0000000001' })
    // Shown at once, like a message typed in the composer.
    expect(screen.getByTestId('message-user')).toHaveTextContent(PROMPT)
  })

  it('uses the project autopilot panel count', async () => {
    useAppStore.setState({ projects: [meta({ autopilotPanels: 7 })] })
    const { calls } = installFakeApi({ 'sessions:load': () => [], 'agent:send': () => ({ runId: 'run_0000000001' }) })
    renderChat()
    await userEvent.click(screen.getByTestId('continue-story'))
    expect((calls.find((c) => c.channel === 'agent:send')?.req as { text: string }).text).toBe('Continue the story: plan the next beats and draw the next 7 panels.')
  })

  it('is disabled while the session runs and without a session, and does not send then', async () => {
    useAppStore.setState({ runningThreads: { [S]: 'run_0000000009' } })
    const { calls } = installFakeApi({ 'sessions:load': () => [] })
    renderChat()
    expect(screen.getByTestId('continue-story')).toBeDisabled()
    act(() => useAppStore.setState({ runningThreads: {}, sessionId: null }))
    expect(screen.getByTestId('continue-story')).toBeDisabled()
    act(() => useAppStore.setState({ sessionId: S }))
    expect(screen.getByTestId('continue-story')).toBeEnabled()
    expect(calls.filter((c) => c.channel === 'agent:send')).toEqual([])
  })

  it('is disabled in a session Claude Code drives', async () => {
    useAppStore.setState({
      sessions: [{ id: S, title: 'Claude Code', createdAt: NOW, updatedAt: NOW, messageCount: 0, driver: 'claude-code', claudeSessionId: null, bookmarked: false }]
    })
    const { calls } = installFakeApi({ 'sessions:load': () => [] })
    renderChat()
    expect(screen.getByTestId('continue-story')).toBeDisabled()
    await userEvent.click(screen.getByTestId('continue-story'))
    expect(calls.filter((c) => c.channel === 'agent:send')).toEqual([])
  })

  it('takes a rejected send back out of the thread and says why', async () => {
    installFakeApi({
      'sessions:load': () => [],
      'agent:send': () => {
        throw new Error("Error invoking remote method 'agent:send': Error: No model assigned to role 'agent'. Open Settings → Models.")
      }
    })
    renderChat()
    await userEvent.click(screen.getByTestId('continue-story'))
    expect(await screen.findByRole('alert')).toHaveTextContent("No model assigned to role 'agent'. Open Settings → Models.")
    expect(screen.queryByTestId('message-user')).toBeNull()
  })

  it('makes no IPC call on mount, and shows nothing without a project', () => {
    const { calls } = installFakeApi({})
    useAppStore.setState({ projects: [], projectId: null, sessionId: null })
    render(<ChatHeader />)
    expect(screen.queryByTestId('continue-story')).toBeNull()
    expect(calls).toEqual([])
  })

  it('follows a project change made elsewhere through project.changed', async () => {
    const { emit, calls } = installFakeApi({ 'projects:open': () => ({ meta: meta({ title: 'Renamed' }), problems: [] }) })
    stopSync = startEventSync()
    render(<ChatHeader />)
    act(() => emit({ type: 'project.changed', projectId: P }))
    await waitFor(() => expect(useAppStore.getState().projects[0].title).toBe('Renamed'))
    // The header also reads the style library when it opens; that is not a reaction to the change.
    const reactions = () => calls.filter((c) => c.channel !== 'styles:list').map((c) => c.channel)
    expect(reactions()).toEqual(['projects:open'])
    // Another project's change is none of this project's business.
    act(() => emit({ type: 'project.changed', projectId: 'prj_bbbbbbbbbb' }))
    expect(reactions()).toHaveLength(1)
  })
})
