import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { ProjectProblems } from './ProjectProblems'

beforeEach(() => {
  useAppStore.setState({ ...initialAppState, projectId: 'prj_aaaaaaaaaa' })
})

describe('ProjectProblems (I1)', () => {
  it('shows nothing while the project has no problems', () => {
    render(<ProjectProblems />)
    expect(screen.queryByTestId('project-problems')).not.toBeInTheDocument()
  })

  it('lists every problem with its path and message', async () => {
    useAppStore.setState({
      problems: [
        { path: 'panels/pnl_0000000bad.json', message: 'Unexpected token } in JSON at position 12' },
        { path: 'episodes/epi_0000000bad.json', message: 'Invalid input: title' }
      ]
    })
    render(<ProjectProblems />)
    const box = screen.getByTestId('project-problems')
    expect(within(box).getByText('2 files could not be read')).toBeInTheDocument()
    await userEvent.click(within(box).getByText('2 files could not be read'))
    expect(within(box).getByText('panels/pnl_0000000bad.json')).toBeInTheDocument()
    expect(within(box).getByText('Unexpected token } in JSON at position 12')).toBeInTheDocument()
    expect(within(box).getByText('episodes/epi_0000000bad.json')).toBeInTheDocument()
  })

  it('follows the store when problems change', () => {
    const { rerender } = render(<ProjectProblems />)
    useAppStore.setState({ problems: [{ path: 'characters/chr_0000000bad.json', message: 'Invalid JSON' }] })
    rerender(<ProjectProblems />)
    expect(screen.getByTestId('project-problems')).toHaveTextContent('1 file could not be read')
  })
})
