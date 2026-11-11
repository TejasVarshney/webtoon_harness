import { act, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { useStagePan } from './use-stage-pan'

/** A viewport with a panel in it, and a text box, whose presses and clicks are counted as the stage's would be. */
function Stage({ onPress, onClick, onDoubleClick }: { onPress(): void; onClick(): void; onDoubleClick(): void }) {
  const viewport = useRef<HTMLDivElement>(null)
  const pan = useStagePan(viewport)
  return (
    <div data-testid="stage" onPointerDown={onPress} onClick={onClick} onDoubleClick={onDoubleClick}>
      <div ref={viewport} data-testid="viewport" data-pan={pan ?? undefined}>
        <div data-testid="panel" />
        <textarea aria-label="Line text" />
      </div>
    </div>
  )
}

/** jsdom has no layout: the viewport shows 300 by 200 of a panel `size` by `size`, scrolled to 100, 100. */
function mount(size = 1000) {
  const handlers = { onPress: vi.fn(), onClick: vi.fn(), onDoubleClick: vi.fn() }
  render(<Stage {...handlers} />)
  const v = screen.getByTestId('viewport')
  const box = { scrollWidth: size, scrollHeight: size, clientWidth: 300, clientHeight: 200 }
  for (const [key, value] of Object.entries(box)) Object.defineProperty(v, key, { configurable: true, value })
  Object.defineProperty(v, 'scrollLeft', { configurable: true, writable: true, value: 100 })
  Object.defineProperty(v, 'scrollTop', { configurable: true, writable: true, value: 100 })
  return { ...handlers, v, panel: screen.getByTestId('panel') }
}

describe('useStagePan', () => {
  it('moves a zoomed stage with a middle-button drag, and keeps the press from the stage', () => {
    const { v, panel, onPress, onClick } = mount()
    fireEvent.pointerDown(panel, { button: 1, buttons: 4, clientX: 50, clientY: 50 })
    expect(v).toHaveAttribute('data-pan', 'panning')
    // The page under the pointer follows it: dragging left and up shows more of the right and bottom.
    fireEvent.pointerMove(v, { buttons: 4, clientX: 20, clientY: 10 })
    expect(v.scrollLeft).toBe(130)
    expect(v.scrollTop).toBe(140)
    fireEvent.pointerMove(v, { buttons: 4, clientX: 70, clientY: 60 })
    expect(v.scrollLeft).toBe(80)
    expect(v.scrollTop).toBe(90)
    fireEvent.pointerUp(v, { button: 1, clientX: 70, clientY: 60 })
    fireEvent.click(v, { button: 1, detail: 1 })
    expect(v).not.toHaveAttribute('data-pan')
    expect(onPress).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
    // A move after the release moves nothing.
    fireEvent.pointerMove(v, { clientX: 0, clientY: 0 })
    expect(v.scrollLeft).toBe(80)
    // A click from the keyboard (Enter on a button in the panel) is no pan's, and reaches the stage.
    fireEvent.click(panel, { detail: 0 })
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('moves a zoomed stage with a right-button drag, with no context menu and nothing for the stage', () => {
    const { v, panel, onPress, onClick } = mount()
    fireEvent.pointerDown(panel, { button: 2, buttons: 2, clientX: 50, clientY: 50 })
    expect(v).toHaveAttribute('data-pan', 'panning')
    fireEvent.pointerMove(v, { buttons: 2, clientX: 20, clientY: 10 })
    expect(v.scrollLeft).toBe(130)
    expect(v.scrollTop).toBe(140)
    fireEvent.pointerUp(v, { button: 2 })
    expect(v).not.toHaveAttribute('data-pan')
    expect(fireEvent.contextMenu(panel)).toBe(false)
    expect(fireEvent.click(panel, { detail: 1 })).toBe(false)
    expect(onPress).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
  })

  it('keeps the context menu off the stage even when there is nothing to move', () => {
    const { panel } = mount(100)
    expect(fireEvent.contextMenu(panel)).toBe(false)
  })

  it('stops the middle press from starting the browser’s own scroll', () => {
    const { panel } = mount()
    fireEvent.pointerDown(panel, { button: 1, buttons: 4 })
    expect(fireEvent.mouseDown(panel, { button: 1 })).toBe(false)
  })

  it('moves with a left drag while Space is held over the stage, with a grab cursor until Space is let go', () => {
    const { v, panel, onPress, onClick, onDoubleClick } = mount()
    fireEvent.pointerEnter(v)
    expect(fireEvent.keyDown(document.body, { key: ' ', code: 'Space' })).toBe(false)
    expect(v).toHaveAttribute('data-pan', 'ready')
    // A held key repeats: it is still the one pan.
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space', repeat: true })
    expect(v).toHaveAttribute('data-pan', 'ready')

    fireEvent.pointerDown(panel, { button: 0, buttons: 1, clientX: 50, clientY: 50 })
    expect(v).toHaveAttribute('data-pan', 'panning')
    fireEvent.pointerMove(v, { buttons: 1, clientX: 40, clientY: 30 })
    expect([v.scrollLeft, v.scrollTop]).toEqual([110, 120])
    fireEvent.pointerUp(v, { button: 0 })
    fireEvent.click(panel, { detail: 1 })
    fireEvent.dblClick(panel, { detail: 2 })
    expect(v).toHaveAttribute('data-pan', 'ready')
    expect(onPress).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
    expect(onDoubleClick).not.toHaveBeenCalled()

    fireEvent.keyUp(document.body, { key: ' ', code: 'Space' })
    expect(v).not.toHaveAttribute('data-pan')
    // Without Space a left press is the stage's again.
    fireEvent.pointerDown(panel, { button: 0, buttons: 1 })
    fireEvent.click(panel)
    expect(onPress).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('keeps panning when Space is let go mid-drag, until the button is', () => {
    const { v, panel } = mount()
    fireEvent.pointerEnter(v)
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' })
    fireEvent.pointerDown(panel, { button: 0, buttons: 1, clientX: 50, clientY: 50 })
    fireEvent.keyUp(document.body, { key: ' ', code: 'Space' })
    fireEvent.pointerMove(v, { buttons: 1, clientX: 50, clientY: 0 })
    expect(v.scrollTop).toBe(150)
    expect(v).toHaveAttribute('data-pan', 'panning')
    fireEvent.pointerUp(v, { button: 0 })
    expect(v).not.toHaveAttribute('data-pan')
  })

  it('leaves Space alone away from the stage, in a text box, and with nothing to move', () => {
    const { v, panel, onPress } = mount()
    // The pointer is elsewhere.
    expect(fireEvent.keyDown(document.body, { key: ' ', code: 'Space' })).toBe(true)
    expect(v).not.toHaveAttribute('data-pan')
    fireEvent.keyUp(document.body, { key: ' ', code: 'Space' })

    // Typing a space in a bubble's text.
    fireEvent.pointerEnter(v)
    expect(fireEvent.keyDown(screen.getByLabelText('Line text'), { key: ' ', code: 'Space' })).toBe(true)
    expect(v).not.toHaveAttribute('data-pan')

    // Ctrl and Space is not Space.
    expect(fireEvent.keyDown(document.body, { key: ' ', code: 'Space', ctrlKey: true })).toBe(true)
    expect(v).not.toHaveAttribute('data-pan')

    // The pointer left the stage.
    fireEvent.pointerLeave(v)
    expect(fireEvent.keyDown(document.body, { key: ' ', code: 'Space' })).toBe(true)
    fireEvent.keyUp(document.body, { key: ' ', code: 'Space' })
    fireEvent.pointerDown(panel, { button: 0, buttons: 1 })
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('does nothing while the whole panel fits', () => {
    const { v, panel, onPress } = mount(150)
    fireEvent.pointerEnter(v)
    expect(fireEvent.keyDown(document.body, { key: ' ', code: 'Space' })).toBe(true)
    expect(v).not.toHaveAttribute('data-pan')
    fireEvent.pointerDown(panel, { button: 1, buttons: 4 })
    fireEvent.pointerMove(v, { buttons: 4, clientX: 99, clientY: 99 })
    expect([v.scrollLeft, v.scrollTop]).toEqual([100, 100])
    expect(v).not.toHaveAttribute('data-pan')
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('forgets a held Space when the window loses the focus', () => {
    const { v } = mount()
    fireEvent.pointerEnter(v)
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' })
    expect(v).toHaveAttribute('data-pan', 'ready')
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(v).not.toHaveAttribute('data-pan')
  })
})
