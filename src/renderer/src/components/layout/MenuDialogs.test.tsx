import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ProjectMeta } from '@shared/types'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { runMenuCommand, startMenuSync, useMenuStore } from '../../stores/menu-store'
import { installFakeApi } from '../../test/fake-api'
import { MenuDialogs } from './MenuDialogs'

const NOW = '2026-10-21T10:00:00.000Z'

function project(id: string, title: string): ProjectMeta {
  return { id, title, createdAt: NOW, updatedAt: NOW } as unknown as ProjectMeta
}

const MOON = project('prj_aaaaaaaaaa', 'Moon')
const SUN = project('prj_bbbbbbbbbb', 'Sun')

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projects: [MOON, SUN], projectId: MOON.id })
  useMenuStore.setState({ dialog: null, error: null })
})

describe('the File menu in the window menu bar', () => {
  it('New project opens the dialog, and creating closes it', async () => {
    installFakeApi({
      'styles:list': () => ({ styles: [], loadError: null }),
      'projects:create': () => project('prj_cccccccccc', 'Star'),
      'projects:open': () => ({ meta: project('prj_cccccccccc', 'Star'), problems: [] }),
      'sessions:list': () => []
    })
    render(<MenuDialogs />)
    act(() => runMenuCommand({ kind: 'newProject' }))
    await userEvent.type(screen.getByLabelText('Title'), 'Star')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(useAppStore.getState().projectId).toBe('prj_cccccccccc'))
    expect(screen.queryByLabelText('Title')).toBeNull()
  })

  it('Settings opens the dialog, on the home page too', async () => {
    installFakeApi({})
    useAppStore.setState({ projectId: null })
    render(<MenuDialogs />)
    act(() => runMenuCommand({ kind: 'settings' }))
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
  })

  it('opens the project chosen', async () => {
    const { calls } = installFakeApi({ 'projects:open': () => ({ meta: SUN, problems: [] }), 'sessions:list': () => [] })
    runMenuCommand({ kind: 'openProject', projectId: SUN.id })
    await waitFor(() => expect(useAppStore.getState().projectId).toBe(SUN.id))
    expect(calls.filter((c) => c.channel === 'projects:open').map((c) => c.req)).toEqual([{ projectId: SUN.id }])
  })

  it('does nothing for the project already open', () => {
    const { calls } = installFakeApi({})
    runMenuCommand({ kind: 'openProject', projectId: MOON.id })
    expect(calls).toEqual([])
  })

  it('says why a project would not open, until dismissed', async () => {
    installFakeApi({
      'projects:open': () => {
        throw new Error('Project not found')
      }
    })
    render(<MenuDialogs />)
    act(() => runMenuCommand({ kind: 'openProject', projectId: SUN.id }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Project not found')
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('Home closes the project and reloads the list', async () => {
    const { calls } = installFakeApi({ 'projects:list': () => ({ projects: [MOON, SUN], problems: [] }) })
    runMenuCommand({ kind: 'home' })
    expect(useAppStore.getState().projectId).toBeNull()
    await waitFor(() => expect(calls.some((c) => c.channel === 'projects:list')).toBe(true))
  })
})

describe('startMenuSync', () => {
  let stop: (() => void) | null = null
  afterEach(() => stop?.())

  it('reports the projects and the open one, then each change, once', () => {
    const { calls } = installFakeApi({ 'app:setMenu': () => undefined })
    stop = startMenuSync()
    useAppStore.setState({ projectId: SUN.id })
    useAppStore.setState({ projects: [MOON, SUN] })
    useAppStore.setState({ projects: [project(MOON.id, 'Moon Diary'), SUN] })
    expect(calls.filter((c) => c.channel === 'app:setMenu').map((c) => c.req)).toEqual([
      { projects: [{ id: MOON.id, title: 'Moon' }, { id: SUN.id, title: 'Sun' }], projectId: MOON.id },
      { projects: [{ id: MOON.id, title: 'Moon' }, { id: SUN.id, title: 'Sun' }], projectId: SUN.id },
      { projects: [{ id: MOON.id, title: 'Moon Diary' }, { id: SUN.id, title: 'Sun' }], projectId: SUN.id }
    ])
  })
})
