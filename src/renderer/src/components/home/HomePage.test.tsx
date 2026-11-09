import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectMeta } from '@shared/types'
import { App } from '../../App'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { installFakeApi } from '../../test/fake-api'
import { HomePage } from './HomePage'

// The harness itself is not under test here, only that App leaves the home page for it.
vi.mock('../layout/WorkspaceLayout', () => ({ WorkspaceLayout: () => <div data-testid="harness" /> }))
vi.mock('../chat/ChatHeader', () => ({ ChatHeader: () => null }))
vi.mock('../chat/ChatPane', () => ({ ChatPane: () => null }))
vi.mock('../layout/StudioPane', () => ({ StudioPane: () => null }))
vi.mock('../sessions/SessionSidebar', () => ({ SessionSidebar: () => null }))

const project = (id: string, title: string, updatedAt: string): ProjectMeta => ({ id, title, updatedAt }) as unknown as ProjectMeta
const older = project('prj_aaaaaaaaaa', 'Moon Diary', '2026-11-01T10:00:00.000Z')
const newer = project('prj_bbbbbbbbbb', 'Sun Ledger', '2026-11-08T10:00:00.000Z')

beforeEach(() => {
  useAppStore.setState({ ...initialAppState })
})

describe('HomePage', () => {
  it('shows a card per project, newest first', () => {
    installFakeApi({})
    useAppStore.setState({ projects: [older, newer] })
    render(<HomePage />)
    expect(screen.getByRole('heading', { name: 'Your projects' })).toBeInTheDocument()
    const cards = screen.getAllByTestId('project-card')
    expect(cards.map((c) => within(c).getByText(/Moon Diary|Sun Ledger/).textContent)).toEqual(['Sun Ledger', 'Moon Diary'])
  })

  it('clicking a card opens that project', async () => {
    const { calls } = installFakeApi({
      'projects:open': (req: { projectId: string }) => ({ meta: req.projectId === older.id ? older : newer, problems: [] }),
      'sessions:list': () => []
    })
    useAppStore.setState({ projects: [older, newer] })
    render(<HomePage />)
    await userEvent.click(screen.getAllByTestId('project-card')[1])
    await waitFor(() => expect(useAppStore.getState().projectId).toBe(older.id))
    expect(calls.find((c) => c.channel === 'projects:open')?.req).toEqual({ projectId: older.id })
  })

  it('with no projects invites the first one', () => {
    installFakeApi({})
    render(<HomePage />)
    expect(screen.getByRole('heading', { name: 'Start your first project' })).toBeInTheDocument()
    expect(screen.getByTestId('new-project')).toBeInTheDocument()
    expect(screen.queryByTestId('project-card')).toBeNull()
  })

  it('creating a project enters the harness', async () => {
    installFakeApi({
      'projects:list': () => ({ projects: [], problems: [] }),
      'projects:create': () => newer,
      'projects:open': () => ({ meta: newer, problems: [] }),
      'sessions:list': () => [],
      'styles:list': () => ({ styles: [], loadError: null }),
      'app:setActiveContext': () => undefined
    })
    // App also loads the models and plugins; this fake answers neither, and App only logs that.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(<App />)
    await userEvent.click(await screen.findByTestId('new-project'))
    await userEvent.type(screen.getByLabelText('Title'), 'Sun Ledger')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(useAppStore.getState().projectId).toBe(newer.id))
    expect(await screen.findByTestId('harness')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Your projects' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Start your first project' })).toBeNull()
    logged.mockRestore()
  })
})
