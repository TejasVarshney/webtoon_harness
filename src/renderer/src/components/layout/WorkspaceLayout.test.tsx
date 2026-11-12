import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WorkspaceLayout } from './WorkspaceLayout'

describe('WorkspaceLayout', () => {
  it('puts the visualizer before the chat', () => {
    render(<WorkspaceLayout header={<div>H</div>} left={<div>L</div>} right={<div>R</div>} />)
    const visualizer = screen.getByTestId('pane-visualizer')
    const chat = screen.getByTestId('pane-chat')
    expect(visualizer).toHaveTextContent('L')
    expect(chat).toHaveTextContent('R')
    expect(visualizer.compareDocumentPosition(chat) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('H').closest('header')).not.toBeNull()
  })

  it('makes the panes inert under the overlay, keeping them mounted', () => {
    const { rerender } = render(<WorkspaceLayout left={<div>L</div>} right={<input data-testid="draft" />} overlay={null} />)
    const draft = screen.getByTestId('draft')
    expect(document.querySelector('.sheet-panes')).not.toHaveAttribute('inert')

    rerender(<WorkspaceLayout left={<div>L</div>} right={<input data-testid="draft" />} overlay={<div data-testid="overlay">O</div>} />)
    expect(document.querySelector('.sheet')).toContainElement(screen.getByTestId('overlay'))
    expect(document.querySelector('.sheet-panes')).toHaveAttribute('inert')
    expect(screen.getByTestId('draft')).toBe(draft)

    rerender(<WorkspaceLayout left={<div>L</div>} right={<input data-testid="draft" />} />)
    expect(screen.queryByTestId('overlay')).toBeNull()
    expect(document.querySelector('.sheet-panes')).not.toHaveAttribute('inert')
    expect(screen.getByTestId('draft')).toBe(draft)
  })
})
