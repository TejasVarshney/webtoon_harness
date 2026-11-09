import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ProjectMeta } from '@shared/types'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { installFakeApi } from '../../test/fake-api'
import { FileMenu } from './FileMenu'

const NOW = '2026-10-21T10:00:00.000Z'

function project(id: string, title: string): ProjectMeta {
  return { id, title, createdAt: NOW, updatedAt: NOW } as unknown as ProjectMeta
}

const MOON = project('prj_aaaaaaaaaa', 'Moon')
const SUN = project('prj_bbbbbbbbbb', 'Sun')

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projects: [MOON, SUN], projectId: MOON.id })
})

async function openMenu(): Promise<void> {
  await userEvent.click(screen.getByTestId('file-menu'))
}

describe('FileMenu', () => {
  it('lists every project and opens the one clicked', async () => {
    const { calls } = installFakeApi({ 'projects:open': () => ({ meta: SUN, problems: [] }), 'sessions:list': () => [] })
    render(<FileMenu />)
    await openMenu()
    expect(screen.getAllByTestId('file-menu-project').map((el) => el.textContent)).toEqual(['Moon', 'Sun'])
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sun' }))
    await waitFor(() => expect(useAppStore.getState().projectId).toBe(SUN.id))
    expect(calls.find((c) => c.channel === 'projects:open')?.req).toEqual({ projectId: SUN.id })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('New project opens the dialog', async () => {
    installFakeApi({ 'styles:list': () => ({ styles: [] }) })
    render(<FileMenu />)
    await openMenu()
    await userEvent.click(screen.getByTestId('new-project'))
    expect(screen.getByLabelText('Title')).toBeInTheDocument()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('Home closes the project and reloads the list', async () => {
    const { calls } = installFakeApi({ 'projects:list': () => ({ projects: [MOON, SUN], problems: [] }) })
    render(<FileMenu />)
    await openMenu()
    await userEvent.click(screen.getByTestId('file-menu-home'))
    expect(useAppStore.getState().projectId).toBeNull()
    await waitFor(() => expect(calls.some((c) => c.channel === 'projects:list')).toBe(true))
  })

  it('Settings opens the dialog', async () => {
    installFakeApi({})
    render(<FileMenu />)
    await openMenu()
    await userEvent.click(screen.getByTestId('settings-open'))
    expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
  })

  it('Ctrl+Shift+N opens the new project dialog', async () => {
    installFakeApi({ 'styles:list': () => ({ styles: [] }) })
    render(<FileMenu />)
    expect(screen.queryByLabelText('Title')).toBeNull()
    await userEvent.keyboard('{Control>}{Shift>}n{/Shift}{/Control}')
    expect(await screen.findByLabelText('Title')).toBeInTheDocument()
  })
})
