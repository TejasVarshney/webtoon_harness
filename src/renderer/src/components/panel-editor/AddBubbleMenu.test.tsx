import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AddBubbleMenu } from './AddBubbleMenu'

const button = (): HTMLElement => screen.getByRole('button', { name: 'Add bubble' })

describe('AddBubbleMenu', () => {
  it('lists the six shapes when opened', async () => {
    render(<AddBubbleMenu disabled={false} onAdd={vi.fn()} />)
    expect(button()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('menu')).toBeNull()
    await userEvent.click(button())
    expect(button()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent)).toEqual(['Speech', 'Shout', 'Whisper', 'Thought', 'Caption', 'Sound effect'])
  })

  it('choosing one reports it and closes', async () => {
    const onAdd = vi.fn()
    render(<AddBubbleMenu disabled={false} onAdd={onAdd} />)
    await userEvent.click(button())
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sound effect' }))
    expect(onAdd).toHaveBeenCalledExactlyOnceWith('sfx')
    expect(screen.queryByRole('menu')).toBeNull()
    await userEvent.click(button())
    await userEvent.click(screen.getByRole('menuitem', { name: 'Shout' }))
    expect(onAdd).toHaveBeenLastCalledWith('shout')
  })

  it('Escape closes it without leaving the editor', async () => {
    render(<AddBubbleMenu disabled={false} onAdd={vi.fn()} />)
    await userEvent.click(button())
    const item = screen.getAllByRole('menuitem')[0]
    // fireEvent says false when the event was default-prevented, which is how the workspace knows to stay.
    expect(fireEvent.keyDown(item, { key: 'Escape' })).toBe(false)
    expect(screen.queryByRole('menu')).toBeNull()
    expect(button()).toHaveFocus()
  })

  it('a press outside closes it', async () => {
    render(
      <>
        <AddBubbleMenu disabled={false} onAdd={vi.fn()} />
        <p>Elsewhere</p>
      </>
    )
    await userEvent.click(button())
    await userEvent.click(screen.getByText('Elsewhere'))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('does not open while disabled', async () => {
    render(<AddBubbleMenu disabled onAdd={vi.fn()} />)
    expect(button()).toBeDisabled()
  })

  it('keeps focus where it is when the menu re-renders', async () => {
    const { rerender } = render(<AddBubbleMenu disabled={false} onAdd={vi.fn()} />)
    await userEvent.click(button())
    await userEvent.tab()
    await userEvent.tab()
    await userEvent.tab()
    expect(screen.getByRole('menuitem', { name: 'Thought' })).toHaveFocus()
    rerender(<AddBubbleMenu disabled={false} onAdd={vi.fn()} />)
    expect(screen.getByRole('menuitem', { name: 'Thought' })).toHaveFocus()
  })

  it('closes when focus leaves it', async () => {
    render(
      <>
        <AddBubbleMenu disabled={false} onAdd={vi.fn()} />
        <button type="button">Elsewhere</button>
      </>
    )
    await userEvent.click(button())
    act(() => screen.getByRole('button', { name: 'Elsewhere' }).focus())
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes on window resize', async () => {
    render(<AddBubbleMenu disabled={false} onAdd={vi.fn()} />)
    await userEvent.click(button())
    fireEvent(window, new Event('resize'))
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
