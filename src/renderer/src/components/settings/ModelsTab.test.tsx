import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ModelRegistryView } from '@shared/types'
import { useModelsStore } from '../../stores/models-store'
import { installFakeApi } from '../../test/fake-api'
import { ModelsTab } from './ModelsTab'

function view(over: Partial<ModelRegistryView> = {}): ModelRegistryView {
  return {
    endpoints: [{ id: 'end_0000000000', name: 'Mock (offline)', kind: 'mock', baseUrl: 'mock://local', options: {}, hasKey: false }],
    models: [
      { id: 'mdl_000000000a', endpointId: 'end_0000000000', modelId: 'mock-text', label: 'Mock text', capabilities: ['text', 'vision'], params: {}, maxReferenceImages: 4 },
      { id: 'mdl_000000000b', endpointId: 'end_0000000000', modelId: 'mock-image', label: 'Mock image', capabilities: ['image-gen', 'image-edit'], params: {}, maxReferenceImages: 4 },
      { id: 'mdl_000000000c', endpointId: 'end_0000000000', modelId: 'text-only', label: 'Text only', capabilities: ['text'], params: {}, maxReferenceImages: 4 }
    ],
    roles: { agent: 'mdl_000000000a', image: 'mdl_000000000b' },
    effectiveRoles: { agent: 'mdl_000000000a', panelChat: 'mdl_000000000a', vision: null, image: 'mdl_000000000b', imageEdit: 'mdl_000000000b' },
    ...over
  }
}

beforeEach(() => {
  useModelsStore.setState({ view: view() })
})

describe('ModelsTab', () => {
  it('adds an endpoint from a preset and stores key write-only', async () => {
    const { calls } = installFakeApi({
      'models:addEndpoint': (req: { name: string; kind: string; baseUrl: string }) => ({ id: 'end_1111111111', options: {}, ...req }),
      'models:setApiKey': () => undefined,
      'models:addModel': (req: { endpointId: string; modelId: string; label: string }) => ({
        id: 'mdl_1111111111',
        params: {},
        maxReferenceImages: 4,
        capabilities: ['text'],
        ...req
      }),
      'models:get': () => view()
    })
    render(<ModelsTab />)
    await userEvent.click(screen.getByRole('button', { name: 'Add endpoint' }))
    await userEvent.selectOptions(screen.getByLabelText('Preset'), 'Anthropic')
    expect(screen.getByLabelText('Base URL')).toHaveValue('https://api.anthropic.com')
    const key = screen.getByLabelText('API key')
    expect(key).toHaveAttribute('type', 'password')
    expect(key).toHaveValue('')
    await userEvent.type(key, 'sk-ant-SECRET')
    await userEvent.click(screen.getByRole('button', { name: 'Save endpoint' }))
    await waitFor(() => expect(calls.some((c) => c.channel === 'models:setApiKey')).toBe(true))
    const channels = calls.map((c) => c.channel)
    expect(channels.indexOf('models:addEndpoint')).toBeLessThan(channels.indexOf('models:setApiKey'))
    expect(calls.find((c) => c.channel === 'models:addEndpoint')?.req).toMatchObject({ kind: 'anthropic', baseUrl: 'https://api.anthropic.com' })
    expect(calls.find((c) => c.channel === 'models:setApiKey')?.req).toEqual({ endpointId: 'end_1111111111', key: 'sk-ant-SECRET' })
    // The suggested models are added after the key.
    await waitFor(() => expect(calls.filter((c) => c.channel === 'models:addModel')).toHaveLength(3))
    expect(calls.filter((c) => c.channel === 'models:addModel').map((c) => (c.req as { modelId: string }).modelId)).toEqual([
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5'
    ])
  })

  it('role selects only offer capable models', () => {
    installFakeApi({})
    render(<ModelsTab />)
    const options = (label: string): string => within(screen.getByLabelText(label)).getAllByRole('option').map((o) => o.textContent ?? '').join('|')
    expect(options('image role')).toContain('Mock image')
    expect(options('image role')).not.toContain('Text only')
    expect(options('image role')).not.toContain('Mock text')
    expect(options('vision role')).toContain('Mock text')
    expect(options('vision role')).not.toContain('Text only')
    expect(options('agent role')).toContain('Text only')
  })

  it('shows which roles were cleared on removal', async () => {
    installFakeApi({ 'models:removeModel': () => ({ clearedRoles: ['agent'] }), 'models:get': () => view() })
    render(<ModelsTab />)
    const row = screen.getByTestId('model-row-mdl_000000000a')
    await userEvent.click(within(row).getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('Unassigned roles: agent')).toBeInTheDocument()
  })

  it('reports a model test result', async () => {
    installFakeApi({ 'models:test': () => ({ ok: false, message: 'bad key' }) })
    render(<ModelsTab />)
    await userEvent.click(within(screen.getByTestId('model-row-mdl_000000000a')).getByRole('button', { name: 'Test' }))
    expect(await screen.findByText(/bad key/)).toBeInTheDocument()
  })
})
