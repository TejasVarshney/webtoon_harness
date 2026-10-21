import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
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
})
