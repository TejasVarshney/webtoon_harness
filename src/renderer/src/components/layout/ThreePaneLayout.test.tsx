import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ThreePaneLayout } from './ThreePaneLayout'

describe('ThreePaneLayout', () => {
  it('renders the three panes', () => {
    render(<ThreePaneLayout left={<div>L</div>} middle={<div>M</div>} right={<div>R</div>} />)
    expect(screen.getByTestId('pane-sessions')).toHaveTextContent('L')
    expect(screen.getByTestId('pane-chat')).toHaveTextContent('M')
    expect(screen.getByTestId('pane-visualizer')).toHaveTextContent('R')
    expect(document.querySelector('.sheet-panes')).not.toHaveAttribute('inert')
  })

  it('draws an overlay inside the sheet, over panes that stay mounted but inert', () => {
    const { rerender } = render(<ThreePaneLayout left={<div>L</div>} middle={<input data-testid="draft" />} right={<div>R</div>} overlay={null} />)
    const draft = screen.getByTestId('draft')
    expect(document.querySelector('.sheet-panes')).not.toHaveAttribute('inert')

    rerender(<ThreePaneLayout left={<div>L</div>} middle={<input data-testid="draft" />} right={<div>R</div>} overlay={<div data-testid="overlay">O</div>} />)
    expect(document.querySelector('.sheet')).toContainElement(screen.getByTestId('overlay'))
    expect(document.querySelector('.sheet-panes')).toHaveAttribute('inert')
    expect(screen.getByTestId('draft')).toBe(draft)

    rerender(<ThreePaneLayout left={<div>L</div>} middle={<input data-testid="draft" />} right={<div>R</div>} />)
    expect(screen.queryByTestId('overlay')).toBeNull()
    expect(document.querySelector('.sheet-panes')).not.toHaveAttribute('inert')
    expect(screen.getByTestId('draft')).toBe(draft)
  })
})
