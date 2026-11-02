import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ModelRegistryView, PluginView } from '@shared/types'
import { useModelsStore } from '../../stores/models-store'
import { initialPluginsState, usePluginsStore } from '../../stores/plugins-store'
import { ModelPicker } from './ModelPicker'

const view: ModelRegistryView = {
  endpoints: [{ id: 'end_0000000000', name: 'Mock (offline)', kind: 'mock', baseUrl: 'mock://local', options: {}, hasKey: false }],
  models: [{ id: 'mdl_000000000a', endpointId: 'end_0000000000', modelId: 'mock-text', label: 'Mock text', capabilities: ['text', 'vision'], params: {}, maxReferenceImages: 4 }],
  roles: { agent: 'mdl_000000000a' },
  effectiveRoles: { agent: 'mdl_000000000a', panelChat: 'mdl_000000000a', vision: null, image: null, imageEdit: null }
}

function claudeCode(over: Partial<PluginView> = {}): PluginView {
  return {
    id: 'claude-code',
    name: 'Claude Code',
    description: '',
    enabled: true,
    status: { state: 'running', message: 'Listening on 127.0.0.1:7880' },
    config: { useAsAgent: true },
    ...over
  }
}

beforeEach(() => {
  useModelsStore.setState({ view })
  usePluginsStore.setState({ ...initialPluginsState })
})

describe('ModelPicker', () => {
  it('offers the agent models before the plugins have loaded', () => {
    render(<ModelPicker />)
    const picker = screen.getByTestId('model-picker')
    expect(picker).toBeEnabled()
    expect(picker).toHaveValue('mdl_000000000a')
  })

  it('stays a normal picker when Claude Code is on but not the agent', () => {
    usePluginsStore.setState({ plugins: [claudeCode({ config: { useAsAgent: false } })] })
    render(<ModelPicker />)
    expect(screen.getByTestId('model-picker')).toBeEnabled()
    expect(screen.queryByText('Claude Code')).not.toBeInTheDocument()
  })

  it('stays a normal picker when useAsAgent is set but the plugin is off', () => {
    usePluginsStore.setState({ plugins: [claudeCode({ enabled: false, status: { state: 'off', message: '' } })] })
    render(<ModelPicker />)
    expect(screen.getByTestId('model-picker')).toBeEnabled()
  })

  it('shows Claude Code and disables the picker while the backend is active', () => {
    usePluginsStore.setState({ plugins: [claudeCode()] })
    render(<ModelPicker />)
    const picker = screen.getByTestId('model-picker')
    expect(picker).toBeDisabled()
    expect(picker).toHaveDisplayValue('Claude Code')
    expect(screen.queryByText(/Mock text/)).not.toBeInTheDocument()
  })

  it('shows Claude Code even before the model registry has loaded', () => {
    useModelsStore.setState({ view: null })
    usePluginsStore.setState({ plugins: [claudeCode()] })
    render(<ModelPicker />)
    expect(screen.getByTestId('model-picker')).toHaveDisplayValue('Claude Code')
  })
})
