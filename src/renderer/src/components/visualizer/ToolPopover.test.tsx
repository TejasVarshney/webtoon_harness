import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ToolPopover } from './ToolPopover'

// jsdom lays nothing out: every box is at 0,0 and the window is 1024 by 768. So a popover by its button opens at the
// margin, 8,8, and a drag moves its corner from 0,0 by as much as the pointer moved. Each test has its own label: a
// moved popover is remembered by label.

function Host({ label, onClose = () => undefined }: { label: string; onClose?(focusBack: boolean): void }) {
  const [open, setOpen] = useState(true)
  const [anchor] = useState(() => document.body.appendChild(document.createElement('button')))
  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)}>
        Toggle
      </button>
      {open && (
        <ToolPopover label={label} anchor={anchor} onClose={onClose}>
          <p>Controls</p>
        </ToolPopover>
      )}
    </>
  )
}

const popover = (label: string) => screen.getByRole('dialog', { name: label })
const head = (label: string) => screen.getByRole('button', { name: `Move ${label}` })
const corner = (label: string) => ({ left: popover(label).style.left, top: popover(label).style.top })

function drag(label: string, from: { x: number; y: number }, to: { x: number; y: number }): void {
  fireEvent.pointerDown(head(label), { button: 0, pointerId: 1, clientX: from.x, clientY: from.y })
  fireEvent.pointerMove(head(label), { pointerId: 1, clientX: to.x, clientY: to.y })
  fireEvent.pointerUp(head(label), { pointerId: 1, clientX: to.x, clientY: to.y })
}

describe('ToolPopover', () => {
  it('opens by its button, and moves anywhere by its head', () => {
    render(<Host label="Lines A" />)
    expect(corner('Lines A')).toEqual({ left: '8px', top: '8px' })
    drag('Lines A', { x: 100, y: 100 }, { x: 400, y: 350 })
    expect(corner('Lines A')).toEqual({ left: '300px', top: '250px' })
    expect(popover('Lines A')).toHaveAttribute('data-moved', 'true')
  })

  it('opens where it was put the next time, until a double-click on its head puts it back', () => {
    render(<Host label="Layout B" />)
    drag('Layout B', { x: 0, y: 0 }, { x: 500, y: 200 })
    fireEvent.click(screen.getByRole('button', { name: 'Toggle' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Toggle' }))
    expect(corner('Layout B')).toEqual({ left: '500px', top: '200px' })
    fireEvent.doubleClick(head('Layout B'))
    expect(corner('Layout B')).toEqual({ left: '8px', top: '8px' })
    expect(popover('Layout B')).not.toHaveAttribute('data-moved')
  })

  it('moves by the arrow keys on its head, five times as far with Shift', () => {
    render(<Host label="Versions C" />)
    fireEvent.keyDown(head('Versions C'), { key: 'ArrowRight' })
    expect(corner('Versions C')).toEqual({ left: '10px', top: '0px' })
    fireEvent.keyDown(head('Versions C'), { key: 'ArrowDown', shiftKey: true })
    expect(corner('Versions C')).toEqual({ left: '10px', top: '50px' })
  })

  it('keeps its head in the window, so it can always be dragged back', () => {
    render(<Host label="Background D" />)
    drag('Background D', { x: 0, y: 0 }, { x: 5000, y: -400 })
    // The window is 1024 wide: 40px of the head stay in it, and the top never goes above the window.
    expect(corner('Background D')).toEqual({ left: '984px', top: '0px' })
  })

  it('is not closed by a press on its own head', () => {
    const onClose = vi.fn()
    render(<Host label="Lines E" onClose={onClose} />)
    drag('Lines E', { x: 10, y: 10 }, { x: 60, y: 60 })
    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledWith(false)
  })
})
