import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ProjectMeta, SessionSummary } from '@shared/types'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { installFakeApi } from '../../test/fake-api'
import { ChatSessions } from './ChatSessions'

const NOW = '2026-10-21T10:00:00.000Z'
const P = 'prj_aaaaaaaaaa'

function project(id: string, title: string): ProjectMeta {
  return { id, title, createdAt: NOW, updatedAt: NOW } as unknown as ProjectMeta
}

function session(id: string, title: string, bookmarked = false): SessionSummary {
  return { id, title, createdAt: NOW, updatedAt: NOW, messageCount: 0, driver: null, claudeSessionId: null, bookmarked }
}

beforeEach(() => {
  useAppStore.setState({ ...initialAppState })
  localStorage.clear()
})

function seed(sessions: SessionSummary[], sessionId: string | null = null): void {
  useAppStore.setState({ projects: [project(P, 'Moon')], projectId: P, sessions, sessionId })
}

async function openList(): Promise<void> {
  await userEvent.click(screen.getByTestId('sessions-toggle'))
}

describe('ChatSessions', () => {
  it('shows the current title on the toggle and keeps the list closed until it is clicked', async () => {
    seed([session('ses_0000000001', 'Night walk')], 'ses_0000000001')
    installFakeApi({})
    render(<ChatSessions />)
    expect(screen.getByTestId('sessions-toggle')).toHaveTextContent('Night walk')
    expect(screen.queryByTestId('session-item')).toBeNull()
    await openList()
    expect(screen.getAllByTestId('session-item')).toHaveLength(1)
  })

  it('lists bookmarked sessions first under their own heading', async () => {
    seed([session('ses_0000000001', 'Plain one'), session('ses_0000000002', 'Pinned one', true), session('ses_0000000003', 'Plain two')])
    installFakeApi({})
    render(<ChatSessions />)
    await openList()
    const headings = screen.getAllByRole('heading').map((h) => h.textContent)
    expect(headings).toEqual(['Bookmarked', 'Previous sessions'])
    const titles = screen.getAllByTestId('session-item').map((li) => li.querySelector('.session-title')?.textContent)
    expect(titles).toEqual(['Pinned one', 'Plain one', 'Plain two'])
  })

  it('the star toggles the bookmark', async () => {
    seed([session('ses_0000000001', 'Old')])
    const { calls } = installFakeApi({ 'sessions:bookmark': () => undefined })
    render(<ChatSessions />)
    await openList()
    await userEvent.click(screen.getByRole('button', { name: 'Bookmark' }))
    await waitFor(() =>
      expect(calls.find((c) => c.channel === 'sessions:bookmark')?.req).toEqual({ projectId: P, sessionId: 'ses_0000000001', bookmarked: true })
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove bookmark' })).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Bookmarked' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove bookmark' }))
    await waitFor(() => expect(calls.filter((c) => c.channel === 'sessions:bookmark').at(-1)?.req).toMatchObject({ bookmarked: false }))
    // Starring does not open the session.
    expect(useAppStore.getState().sessionId).toBeNull()
  })

  it('New session and Ctrl+N make a session', async () => {
    seed([])
    const { calls } = installFakeApi({ 'sessions:create': () => session('ses_0000000001', 'New session') })
    render(<ChatSessions />)
    await userEvent.click(screen.getByTestId('new-session'))
    await waitFor(() => expect(useAppStore.getState().sessionId).toBe('ses_0000000001'))
    expect(screen.getByTestId('sessions-toggle')).toHaveTextContent('New session')
    await userEvent.keyboard('{Control>}n{/Control}')
    await waitFor(() => expect(calls.filter((c) => c.channel === 'sessions:create')).toHaveLength(2))
  })

  it('rename and delete still work', async () => {
    seed([session('ses_0000000001', 'Old')])
    const { calls } = installFakeApi({ 'sessions:rename': () => undefined, 'sessions:delete': () => undefined })
    render(<ChatSessions />)
    await openList()
    await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTestId('session-item') })
    await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'Session title' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Fresh{Enter}')
    await waitFor(() => expect(calls.find((c) => c.channel === 'sessions:rename')?.req).toEqual({ projectId: P, sessionId: 'ses_0000000001', title: 'Fresh' }))

    await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTestId('session-item') })
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(calls.some((c) => c.channel === 'sessions:delete')).toBe(false)
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls.find((c) => c.channel === 'sessions:delete')?.req).toEqual({ projectId: P, sessionId: 'ses_0000000001' }))
  })

  it('does not leave a rename open when the list closes', async () => {
    seed([session('ses_0000000001', 'Old')])
    installFakeApi({})
    render(<ChatSessions />)
    for (const close of [() => userEvent.keyboard('{Escape}'), () => userEvent.click(document.body)]) {
      await openList()
      await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTestId('session-item') })
      await userEvent.click(screen.getByRole('menuitem', { name: 'Rename' }))
      expect(screen.getByRole('textbox', { name: 'Session title' })).toBeInTheDocument()
      await close()
      expect(screen.queryByTestId('session-item')).toBeNull()
      await openList()
      expect(screen.queryByRole('textbox', { name: 'Session title' })).toBeNull()
      await userEvent.click(screen.getByTestId('sessions-toggle'))
    }
  })

  it('shows a running dot for running sessions', async () => {
    seed([session('ses_0000000001', 'A'), session('ses_0000000002', 'B')])
    useAppStore.setState({ runningThreads: { ses_0000000001: 'run_1' } })
    installFakeApi({})
    render(<ChatSessions />)
    await openList()
    const items = screen.getAllByTestId('session-item')
    expect(items[0]).toHaveAttribute('data-running', 'true')
    expect(items[1]).not.toHaveAttribute('data-running', 'true')
  })
})
