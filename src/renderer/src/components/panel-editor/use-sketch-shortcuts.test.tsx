import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { SketchSize, SketchTool } from './use-sketch-pad'
import { useSketchShortcuts } from './use-sketch-shortcuts'
import type { StageZoom } from './use-stage-zoom'

/** A sketch's tool and brush as state, with spies for undo and the zoom. */
function Harness({ undo, zoomTo, canUndo = true, zoom = 1 }: { undo(): void; zoomTo: StageZoom['zoomTo']; canUndo?: boolean; zoom?: number }) {
  const [tool, setTool] = useState<SketchTool>('pen')
  const [size, setSize] = useState<SketchSize>('medium')
  useSketchShortcuts({ pad: { setTool, size, setSize, canUndo, undo }, zoom: { zoom, control: { zoomTo } } })
  return (
    <div>
      <output data-testid="tool">{tool}</output>
      <output data-testid="size">{size}</output>
      <input aria-label="Description" />
    </div>
  )
}

function mount(props: { canUndo?: boolean; zoom?: number } = {}) {
  const undo = vi.fn()
  const zoomTo = vi.fn()
  render(<Harness undo={undo} zoomTo={zoomTo} {...props} />)
  const press = (key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key, ...init })
  return { undo, zoomTo, press, tool: () => screen.getByTestId('tool').textContent, size: () => screen.getByTestId('size').textContent }
}

describe('useSketchShortcuts', () => {
  it('picks a tool by its letter', () => {
    const { press, tool } = mount()
    for (const [key, expected] of [['e', 'eraser'], ['l', 'line'], ['r', 'rect'], ['o', 'ellipse'], ['b', 'pen'], ['E', 'eraser'], ['p', 'pen']]) {
      press(key)
      expect(tool()).toBe(expected)
    }
  })

  it('sets the brush with [ and ], within the three widths, and with 1, 2 and 3', () => {
    const { press, size } = mount()
    press(']')
    expect(size()).toBe('bold')
    press(']')
    expect(size()).toBe('bold')
    press('[')
    press('[')
    press('[')
    expect(size()).toBe('fine')
    press('2')
    expect(size()).toBe('medium')
    press('3')
    expect(size()).toBe('bold')
  })

  it('undoes a stroke with Ctrl+Z, and only when there is one', () => {
    const first = mount()
    first.press('z', { ctrlKey: true })
    expect(first.undo).toHaveBeenCalledTimes(1)
  })

  it('does not undo with nothing to undo, or with Shift held', () => {
    const { press, undo } = mount({ canUndo: false })
    press('z', { ctrlKey: true })
    press('z', { ctrlKey: true, shiftKey: true })
    expect(undo).not.toHaveBeenCalled()
  })

  it('zooms in and out a step with + and -, and back to the fit with 0', () => {
    const { press, zoomTo } = mount({ zoom: 1 })
    press('+')
    press('=')
    press('-')
    press('0')
    expect(zoomTo.mock.calls.map(([z]) => z)).toEqual([1.25, 1.25, 0.8, 1])
  })

  it('leaves the keys to a field being typed in, and to an open dialog', () => {
    const { tool, undo } = mount()
    const field = screen.getByLabelText('Description')
    fireEvent.keyDown(field, { key: 'e' })
    fireEvent.keyDown(field, { key: 'z', ctrlKey: true })
    expect(tool()).toBe('pen')
    expect(undo).not.toHaveBeenCalled()
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    document.body.append(dialog)
    fireEvent.keyDown(window, { key: 'e' })
    expect(tool()).toBe('pen')
    dialog.remove()
  })

  it('ignores letters with Ctrl or Alt held, so the app keeps its own shortcuts', () => {
    const { press, tool } = mount()
    press('e', { ctrlKey: true })
    press('l', { altKey: true })
    expect(tool()).toBe('pen')
  })
})
