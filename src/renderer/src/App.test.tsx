import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelRegistryView, ProjectMeta, SessionSummary } from '@shared/types'
import { App } from './App'
import { initialAppState, useAppStore } from './stores/app-store'
import { useChatStore } from './stores/chat-store'
import { useModelsStore } from './stores/models-store'
import { initialPluginsState, usePluginsStore } from './stores/plugins-store'
import { installFakeApi } from './test/fake-api'

// The panes beside the chat are not under test here.
vi.mock('./components/chat/ChatHeader', () => ({ ChatHeader: () => null }))
vi.mock('./components/layout/StudioPane', () => ({ StudioPane: () => null }))
vi.mock('./components/panel-editor/PanelWorkspace', () => ({ PanelWorkspace: () => null }))

const NOW = '2026-10-21T10:00:00.000Z'
const P = 'prj_aaaaaaaaaa'
const S = 'ses_0000000001'
const emptyView: ModelRegistryView = { endpoints: [], models: [], roles: {}, effectiveRoles: { agent: null, panelChat: null, vision: null, image: null, imageEdit: null } }

beforeEach(() => {
  useAppStore.setState({ ...initialAppState })
  useChatStore.setState({ messages: {}, streaming: {}, notices: {} })
  useModelsStore.setState({ view: emptyView })
  usePluginsStore.setState({ ...initialPluginsState })
})

describe('App', () => {
  it('has no sessions sidebar: the sessions live only in the chat', async () => {
    const meta = { id: P, title: 'Moon', createdAt: NOW, updatedAt: NOW } as unknown as ProjectMeta
    const session: SessionSummary = { id: S, title: 'Night walk', createdAt: NOW, updatedAt: NOW, messageCount: 0, driver: null, claudeSessionId: null, bookmarked: false }
    installFakeApi({
      'projects:list': () => ({ projects: [meta], problems: [] }),
      'models:get': () => emptyView,
      'plugins:list': () => [],
      'plugins:loadError': () => null,
      'sessions:load': () => [],
      'app:setActiveContext': () => undefined
    })
    useAppStore.setState({ projects: [meta], projectId: P, sessions: [session], sessionId: S })
    render(<App />)

    expect(screen.queryByTestId('pane-sessions')).toBeNull()
    await userEvent.click(screen.getByTestId('sessions-toggle'))
    const items = screen.getAllByTestId('session-item')
    expect(items).toHaveLength(1)
    const chat = screen.getByTestId('pane-chat')
    for (const item of items) expect(chat).toContainElement(item)
    // The controls sit outside the main chat, so composer lookups there stay unambiguous.
    expect(within(chat).getByTestId('sessions-toggle').closest('.main-chat')).toBeNull()
    await waitFor(() => expect(screen.getByTestId('composer-input')).toBeInTheDocument())
  })
})
