import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ProjectMeta, SessionSummary } from '@shared/types'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { installFakeApi } from '../../test/fake-api'
import { SessionSidebar } from './SessionSidebar'

const NOW = '2026-10-21T10:00:00.000Z'

function project(id: string, title: string): ProjectMeta {
  return {
    id,
    title,
    logline: '',
    stylePreset: '',
    storyMode: 'off',
    defaultAspect: '3:4',
    autopilotPanels: 1,
    consistencyRetries: 1,
    createdAt: NOW,
    updatedAt: NOW
  } as unknown as ProjectMeta
}

function session(id: string, title: string): SessionSummary {
  return { id, title, createdAt: NOW, updatedAt: NOW, messageCount: 0 }
}

beforeEach(() => {
  useAppStore.setState({ ...initialAppState })
  localStorage.clear()
})

function seed(sessions: SessionSummary[]): void {
  useAppStore.setState({ projects: [project('prj_aaaaaaaaaa', 'Moon')], projectId: 'prj_aaaaaaaaaa', sessions })
}

describe('SessionSidebar', () => {
  it('creates and selects a new session', async () => {
    seed([])
    installFakeApi({
      'sessions:create': () => session('ses_0000000001', 'New session'),
      'sessions:list': () => [session('ses_0000000001', 'New session')]
    })
    render(<SessionSidebar />)
    await userEvent.click(screen.getByTestId('new-session'))
    await waitFor(() => expect(useAppStore.getState().sessionId).toBe('ses_0000000001'))
    expect(screen.getAllByTestId('session-item')).toHaveLength(1)
  })

  it('renames on double-click + Enter', async () => {
    seed([session('ses_0000000001', 'Old')])
    const { calls } = installFakeApi({ 'sessions:rename': () => undefined, 'sessions:list': () => [session('ses_0000000001', 'Fresh')] })
    render(<SessionSidebar />)
    await userEvent.dblClick(screen.getByTestId('session-item'))
    const input = screen.getByRole('textbox', { name: 'Session title' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Fresh{Enter}')
    await waitFor(() =>
      expect(calls.find((c) => c.channel === 'sessions:rename')?.req).toEqual({ projectId: 'prj_aaaaaaaaaa', sessionId: 'ses_0000000001', title: 'Fresh' })
    )
  })

  it('deletes after confirm', async () => {
    seed([session('ses_0000000001', 'Old')])
    const { calls } = installFakeApi({ 'sessions:delete': () => undefined, 'sessions:list': () => [] })
    render(<SessionSidebar />)
    await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByTestId('session-item') })
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(calls.some((c) => c.channel === 'sessions:delete')).toBe(false)
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls.some((c) => c.channel === 'sessions:delete')).toBe(true))
    expect(calls.find((c) => c.channel === 'sessions:delete')?.req).toEqual({ projectId: 'prj_aaaaaaaaaa', sessionId: 'ses_0000000001' })
  })

  it('shows running dot for running sessions', () => {
    seed([session('ses_0000000001', 'A'), session('ses_0000000002', 'B')])
    useAppStore.setState({ runningThreads: { ses_0000000001: 'run_1' } })
    installFakeApi({})
    render(<SessionSidebar />)
    const items = screen.getAllByTestId('session-item')
    expect(items[0]).toHaveAttribute('data-running', 'true')
    expect(items[1]).not.toHaveAttribute('data-running', 'true')
  })

  it('creates a project from the empty state', async () => {
    const created = project('prj_bbbbbbbbbb', 'Moon Diary')
    const { calls } = installFakeApi({
      'projects:create': () => created,
      'projects:open': () => ({ meta: created, problems: [] }),
      'sessions:list': () => []
    })
    render(<SessionSidebar />)
    await userEvent.click(screen.getByTestId('new-project'))
    await userEvent.type(screen.getByLabelText('Title'), 'Moon Diary')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(useAppStore.getState().projectId).toBe('prj_bbbbbbbbbb'))
    expect(calls.find((c) => c.channel === 'projects:create')?.req).toEqual({ title: 'Moon Diary' })
    expect(calls.some((c) => c.channel === 'projects:open')).toBe(true)
  })
})
