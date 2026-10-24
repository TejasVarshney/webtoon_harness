import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { useModelsStore } from '../../stores/models-store'
import { installFakeApi } from '../../test/fake-api'
import { SettingsDialog } from './SettingsDialog'

describe('SettingsDialog', () => {
  it('closes on Escape', async () => {
    useModelsStore.setState({ view: { endpoints: [], models: [], roles: {}, effectiveRoles: { agent: null, panelChat: null, vision: null, image: null, imageEdit: null } } })
    installFakeApi({})
    const onClose = vi.fn()
    render(<SettingsDialog onClose={onClose} />)
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('opens on Models and switches to the Workflow docs tab', async () => {
    useModelsStore.setState({ view: { endpoints: [], models: [], roles: {}, effectiveRoles: { agent: null, panelChat: null, vision: null, image: null, imageEdit: null } } })
    useAppStore.setState({ ...initialAppState, projectId: 'prj_0000000001' })
    installFakeApi({ 'docs:list': () => [{ name: 'AGENTS', title: 'Webtoon Agent' }] })
    render(<SettingsDialog onClose={() => undefined} />)
    expect(screen.getByRole('tab', { name: 'Models' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('agent role')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Workflow docs' }))
    expect(screen.getByRole('tab', { name: 'Workflow docs' })).toHaveAttribute('aria-selected', 'true')
    expect(await screen.findByText('Webtoon Agent')).toBeInTheDocument()
    expect(screen.queryByLabelText('agent role')).not.toBeInTheDocument()
  })
})
