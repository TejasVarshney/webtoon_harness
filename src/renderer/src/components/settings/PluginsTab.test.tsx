import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginView } from '@shared/types'
import { initialPluginsState, usePluginsStore } from '../../stores/plugins-store'
import { installFakeApi } from '../../test/fake-api'
import { PluginsTab } from './PluginsTab'

function plugin(over: Partial<PluginView> = {}): PluginView {
  return {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Lets Claude Code drive this app.',
    enabled: false,
    status: { state: 'off', message: '' },
    config: {},
    ...over
  }
}

const running = plugin({ enabled: true, status: { state: 'running', message: 'Listening on 127.0.0.1:7880' }, config: { port: 7880 } })

const writeText = vi.fn<(text: string) => Promise<void>>()

beforeEach(() => {
  usePluginsStore.setState({ ...initialPluginsState })
  writeText.mockReset()
  writeText.mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

describe('PluginsTab', () => {
  it('lists the plugin with its description, switch and status; the extra controls wait for it to be on', async () => {
    installFakeApi({ 'plugins:list': () => [plugin()], 'plugins:loadError': () => null })
    render(<PluginsTab />)
    expect(await screen.findByText('Claude Code')).toBeInTheDocument()
    expect(screen.getByText('Lets Claude Code drive this app.')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Claude Code' })).not.toBeChecked()
    expect(screen.getByTestId('plugin-status-claude-code')).toHaveTextContent('Off')
    expect(screen.queryByLabelText('Port')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Copy command' })).not.toBeInTheDocument()
  })

  it('shows the running status and the port field when the plugin is on', async () => {
    installFakeApi({ 'plugins:list': () => [running], 'plugins:loadError': () => null })
    render(<PluginsTab />)
    expect(await screen.findByTestId('plugin-status-claude-code')).toHaveTextContent('Listening on 127.0.0.1:7880')
    expect(screen.getByRole('switch', { name: 'Claude Code' })).toBeChecked()
    expect(screen.getByLabelText('Port')).toHaveValue(7880)
  })

  it('shows an error status line', async () => {
    const failed = plugin({ enabled: true, status: { state: 'error', message: 'Port 7880 is in use' } })
    installFakeApi({ 'plugins:list': () => [failed], 'plugins:loadError': () => null })
    render(<PluginsTab />)
    expect(await screen.findByTestId('plugin-status-claude-code')).toHaveTextContent('Port 7880 is in use')
  })

  it('toggling the switch calls plugins:setEnabled and shows the new state', async () => {
    const { calls } = installFakeApi({
      'plugins:list': () => [plugin()],
      'plugins:loadError': () => null,
      'plugins:setEnabled': () => running
    })
    render(<PluginsTab />)
    await userEvent.click(await screen.findByRole('switch', { name: 'Claude Code' }))
    await waitFor(() => expect(calls.find((c) => c.channel === 'plugins:setEnabled')?.req).toEqual({ id: 'claude-code', enabled: true }))
    expect(await screen.findByLabelText('Port')).toHaveValue(7880)
    expect(screen.getByTestId('plugin-status-claude-code')).toHaveTextContent('Listening on 127.0.0.1:7880')
  })

  it('shows why a switch could not be flipped', async () => {
    installFakeApi({
      'plugins:list': () => [plugin()],
      'plugins:loadError': () => null,
      'plugins:setEnabled': () => {
        throw new Error('Plugin settings were not saved.')
      }
    })
    render(<PluginsTab />)
    await userEvent.click(await screen.findByRole('switch', { name: 'Claude Code' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Plugin settings were not saved.')
    expect(screen.getByRole('switch', { name: 'Claude Code' })).not.toBeChecked()
  })

  it('saves the port as a number', async () => {
    const { calls } = installFakeApi({
      'plugins:list': () => [running],
      'plugins:loadError': () => null,
      'plugins:setConfig': () => plugin({ ...running, config: { port: 7900 } })
    })
    render(<PluginsTab />)
    const port = await screen.findByLabelText('Port')
    await userEvent.clear(port)
    await userEvent.type(port, '7900')
    await userEvent.click(screen.getByRole('button', { name: 'Save port' }))
    await waitFor(() => expect(calls.find((c) => c.channel === 'plugins:setConfig')?.req).toEqual({ id: 'claude-code', patch: { port: 7900 } }))
    expect(await screen.findByLabelText('Port')).toHaveValue(7900)
  })

  it('shows the refusal for a bad port inline and keeps what was typed', async () => {
    installFakeApi({
      'plugins:list': () => [running],
      'plugins:loadError': () => null,
      'plugins:setConfig': () => {
        throw new Error('Port must be between 1024 and 65535')
      }
    })
    render(<PluginsTab />)
    const port = await screen.findByLabelText('Port')
    await userEvent.clear(port)
    await userEvent.type(port, '80')
    await userEvent.click(screen.getByRole('button', { name: 'Save port' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Port must be between 1024 and 65535')
    expect(screen.getByLabelText('Port')).toHaveValue(80)
  })

  it('Copy command asks main for the command and writes it to the clipboard', async () => {
    const command = 'claude mcp add --transport http webtoon http://127.0.0.1:7880/mcp --header "Authorization: Bearer tok"'
    const { calls } = installFakeApi({
      'plugins:list': () => [running],
      'plugins:loadError': () => null,
      'claudeCode:connectCommand': () => ({ command })
    })
    render(<PluginsTab />)
    await userEvent.click(await screen.findByRole('button', { name: 'Copy command' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(command))
    expect(calls.some((c) => c.channel === 'claudeCode:connectCommand')).toBe(true)
    expect(await screen.findByRole('status')).toHaveTextContent('Command copied')
    // The token is never put on the page.
    expect(document.body).not.toHaveTextContent('Bearer tok')
  })

  it('Regenerate token calls claudeCode:regenerateToken', async () => {
    const { calls } = installFakeApi({
      'plugins:list': () => [running],
      'plugins:loadError': () => null,
      'claudeCode:regenerateToken': () => undefined
    })
    render(<PluginsTab />)
    await userEvent.click(await screen.findByRole('button', { name: 'Regenerate token' }))
    await waitFor(() => expect(calls.some((c) => c.channel === 'claudeCode:regenerateToken')).toBe(true))
    expect(await screen.findByRole('status')).toHaveTextContent('Token replaced')
  })

  it('shows a corrupt plugins.json at the top, naming the problem', async () => {
    installFakeApi({ 'plugins:list': () => [plugin()], 'plugins:loadError': () => 'Unexpected token o' })
    render(<PluginsTab />)
    expect(await screen.findByTestId('plugins-load-error')).toHaveTextContent(
      'plugins.json could not be read: Unexpected token o. All plugins are off until it is fixed.'
    )
  })

  it('shows no load error when the file is fine', async () => {
    installFakeApi({ 'plugins:list': () => [plugin()], 'plugins:loadError': () => null })
    render(<PluginsTab />)
    await screen.findByText('Claude Code')
    expect(screen.queryByTestId('plugins-load-error')).not.toBeInTheDocument()
  })
})
