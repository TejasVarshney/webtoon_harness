import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { installFakeApi } from '../../test/fake-api'
import { WorkflowDocsTab } from './WorkflowDocsTab'

const P = 'prj_0000000001'
const DOCS = [
  { name: 'AGENTS', title: 'Webtoon Agent' },
  { name: 'workflows/panel-editing', title: 'Panel Editing' }
]

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId: P })
})

describe('WorkflowDocsTab', () => {
  it('lists the docs of the open project and opens one', async () => {
    const { calls } = installFakeApi({ 'docs:list': () => DOCS, 'docs:open': () => undefined })
    render(<WorkflowDocsTab />)
    const row = (await screen.findByText('Panel Editing')).closest('li')!
    expect(within(row).getByText('agent/workflows/panel-editing.md')).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'Open' }))
    expect(calls.filter((c) => c.channel === 'docs:open').map((c) => c.req)).toEqual([{ projectId: P, name: 'workflows/panel-editing' }])
  })

  it('shows why a doc could not be opened', async () => {
    installFakeApi({
      'docs:list': () => DOCS,
      'docs:open': () => {
        throw new Error('Could not open AGENTS.md: no editor')
      }
    })
    render(<WorkflowDocsTab />)
    const row = (await screen.findByText('Webtoon Agent')).closest('li')!
    await userEvent.click(within(row).getByRole('button', { name: 'Open' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not open AGENTS.md: no editor')
  })

  it('resets only after the user confirms', async () => {
    const { calls } = installFakeApi({ 'docs:list': () => DOCS, 'docs:reset': () => undefined })
    render(<WorkflowDocsTab />)
    await screen.findByText('Webtoon Agent')
    const resets = () => calls.filter((c) => c.channel === 'docs:reset')

    await userEvent.click(screen.getByRole('button', { name: 'Reset all to defaults' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Reset workflow docs' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(resets()).toEqual([])

    await userEvent.click(screen.getByRole('button', { name: 'Reset all to defaults' }))
    await userEvent.click(within(screen.getByRole('alertdialog', { name: 'Reset workflow docs' })).getByRole('button', { name: 'Reset all' }))
    await waitFor(() => expect(resets().map((c) => c.req)).toEqual([{ projectId: P }]))
    expect(await screen.findByRole('status')).toHaveTextContent('Workflow docs reset to the defaults.')
    expect(calls.filter((c) => c.channel === 'docs:list')).toHaveLength(2)
  })

  it('asks for a project when none is open', () => {
    useAppStore.setState({ projectId: null })
    const { calls } = installFakeApi({})
    render(<WorkflowDocsTab />)
    expect(screen.getByText('Open a project to see its workflow docs.')).toBeInTheDocument()
    expect(calls).toEqual([])
  })
})
