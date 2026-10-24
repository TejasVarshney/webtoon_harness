import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ThreePaneLayout } from './ThreePaneLayout'

describe('ThreePaneLayout', () => {
  it('renders the three panes', () => {
    render(<ThreePaneLayout left={<div>L</div>} middle={<div>M</div>} right={<div>R</div>} />)
    expect(screen.getByTestId('pane-sessions')).toHaveTextContent('L')
    expect(screen.getByTestId('pane-chat')).toHaveTextContent('M')
    expect(screen.getByTestId('pane-visualizer')).toHaveTextContent('R')
  })
})
