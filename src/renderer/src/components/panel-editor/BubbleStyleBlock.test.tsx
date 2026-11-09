import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { BubbleShape, BubbleStyle, DialogueLine } from '@shared/types'
import { BubbleStyleBlock } from './BubbleStyleBlock'

function mount(
  props: {
    autoShape?: BubbleShape
    style?: BubbleStyle | null
    tail?: DialogueLine['tail']
  } = {}
) {
  const onStyle = vi.fn()
  const onTail = vi.fn()
  const view = render(<BubbleStyleBlock autoShape={props.autoShape ?? 'speech'} style={props.style ?? null} tail={props.tail ?? null} onStyle={onStyle} onTail={onTail} />)
  return { onStyle, onTail, view }
}
const group = (name: string): HTMLElement => screen.getByRole('group', { name })
const pressed = (el: HTMLElement): string | null => el.getAttribute('aria-pressed')

describe('BubbleStyleBlock', () => {
  it('shows the look the bubble has', () => {
    mount()
    expect(pressed(within(group('Shape')).getByRole('button', { name: 'Auto' }))).toBe('true')
    expect(screen.getByLabelText('Font')).toHaveValue('comic')
    expect(screen.getByLabelText('Font').querySelector('option:checked')).toHaveTextContent('Comic Neue')
    expect(screen.getByLabelText('Size')).toHaveValue('100')
    expect(screen.getAllByText('100%')).toHaveLength(2)
    expect(pressed(screen.getByRole('button', { name: 'Bold' }))).toBe('true')
    expect(pressed(screen.getByRole('button', { name: 'Capitals' }))).toBe('true')
    expect(pressed(screen.getByRole('button', { name: 'Italic' }))).toBe('false')
    expect(screen.getByLabelText('Fill')).toHaveValue('#ffffff')
    expect(screen.getByLabelText('Outline width')).toHaveValue('2')
    expect(screen.getByText('2 px')).toBeInTheDocument()
  })

  it('choosing a shape reports it, and Auto clears it', () => {
    const first = mount()
    fireEvent.click(within(group('Shape')).getByRole('button', { name: 'Shout' }))
    expect(first.onStyle).toHaveBeenCalledWith({ shape: 'shout' })
    first.view.unmount()
    const second = mount({ style: { shape: 'shout' } })
    expect(pressed(within(group('Shape')).getByRole('button', { name: 'Shout' }))).toBe('true')
    fireEvent.click(within(group('Shape')).getByRole('button', { name: 'Auto' }))
    expect(second.onStyle).toHaveBeenCalledWith(null)
  })

  it('toggling away from a default and back leaves nothing stored', () => {
    const first = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    expect(first.onStyle).toHaveBeenCalledWith({ bold: false })
    first.view.unmount()
    const second = mount({ style: { bold: false } })
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }))
    expect(second.onStyle).toHaveBeenCalledWith(null)
  })

  it('reports each control', () => {
    const { onStyle } = mount()
    fireEvent.change(screen.getByLabelText('Font'), {
      target: { value: 'serif' }
    })
    expect(onStyle).toHaveBeenLastCalledWith({ font: 'serif' })
    fireEvent.change(screen.getByLabelText('Size'), {
      target: { value: '150' }
    })
    expect(onStyle).toHaveBeenLastCalledWith({ size: 1.5 })
    fireEvent.click(screen.getByRole('button', { name: 'Italic' }))
    expect(onStyle).toHaveBeenLastCalledWith({ italic: true })
    fireEvent.click(screen.getByRole('button', { name: 'Capitals' }))
    expect(onStyle).toHaveBeenLastCalledWith({ caps: false })
    fireEvent.click(screen.getByRole('button', { name: 'Left' }))
    expect(onStyle).toHaveBeenLastCalledWith({ align: 'left' })
    fireEvent.change(screen.getByLabelText('Text colour'), {
      target: { value: '#ff0000' }
    })
    expect(onStyle).toHaveBeenLastCalledWith({ color: '#ff0000' })
    fireEvent.change(screen.getByLabelText('Fill'), {
      target: { value: '#00ff00' }
    })
    expect(onStyle).toHaveBeenLastCalledWith({ fill: '#00ff00' })
    fireEvent.change(screen.getByLabelText('Outline'), {
      target: { value: '#0000ff' }
    })
    expect(onStyle).toHaveBeenLastCalledWith({ stroke: '#0000ff' })
    fireEvent.change(screen.getByLabelText('Outline width'), {
      target: { value: '4' }
    })
    expect(onStyle).toHaveBeenLastCalledWith({ strokeWidth: 4 })
  })

  it('shows Tail only for shapes that have one', () => {
    const view = mount({ autoShape: 'caption' })
    expect(screen.queryByRole('group', { name: 'Tail' })).toBeNull()
    view.view.unmount()
    mount({ autoShape: 'sfx' })
    expect(screen.queryByRole('group', { name: 'Tail' })).toBeNull()
  })

  it('hides Fill and Outline width for a sound effect', () => {
    mount({ autoShape: 'sfx' })
    expect(screen.queryByLabelText('Fill')).toBeNull()
    expect(screen.queryByLabelText('Outline width')).toBeNull()
    expect(screen.getByLabelText('Outline')).toBeInTheDocument()
  })

  it('sets the padding, and has no padding for a sound effect', () => {
    const first = mount()
    expect(screen.getByLabelText('Padding')).toHaveValue('100')
    fireEvent.change(screen.getByLabelText('Padding'), { target: { value: '150' } })
    expect(first.onStyle).toHaveBeenCalledWith({ padding: 1.5 })
    first.view.unmount()
    mount({ autoShape: 'sfx' })
    expect(screen.queryByLabelText('Padding')).toBeNull()
  })

  it('offers the new shapes, with no tail controls', () => {
    const first = mount()
    fireEvent.click(within(group('Shape')).getByRole('button', { name: 'Dark burst' }))
    expect(first.onStyle).toHaveBeenCalledWith({ shape: 'burst' })
    fireEvent.click(within(group('Shape')).getByRole('button', { name: 'Fringe' }))
    expect(first.onStyle).toHaveBeenCalledWith({ shape: 'fringe' })
    fireEvent.click(within(group('Shape')).getByRole('button', { name: 'Curly' }))
    expect(first.onStyle).toHaveBeenCalledWith({ shape: 'curly' })
    first.view.unmount()
    mount({ style: { shape: 'fringe' } })
    expect(screen.queryByRole('group', { name: 'Tail' })).toBeNull()
    expect(screen.queryByLabelText('Outline width')).toBeNull()
  })

  it('keeps the outline width for a burst', () => {
    mount({ style: { shape: 'burst' } })
    expect(screen.getByLabelText('Outline width')).toBeInTheDocument()
  })

  it('says where a pointed tail points', () => {
    const first = mount({ tail: { x: 0.25, y: 0.5 } })
    expect(screen.getByText('Points at 25% across, 50% down.')).toBeInTheDocument()
    expect(pressed(within(group('Tail')).getByRole('button', { name: 'Auto' }))).toBe('false')
    expect(pressed(within(group('Tail')).getByRole('button', { name: 'None' }))).toBe('false')
    first.view.unmount()
    mount()
    expect(screen.getByText('Drag the dot on the panel to point it.')).toBeInTheDocument()
    expect(pressed(within(group('Tail')).getByRole('button', { name: 'Auto' }))).toBe('true')
  })

  it('Tail buttons report', () => {
    const { onTail } = mount({ tail: 'none' })
    expect(pressed(within(group('Tail')).getByRole('button', { name: 'None' }))).toBe('true')
    fireEvent.click(within(group('Tail')).getByRole('button', { name: 'Auto' }))
    expect(onTail).toHaveBeenLastCalledWith(null)
    fireEvent.click(within(group('Tail')).getByRole('button', { name: 'None' }))
    expect(onTail).toHaveBeenLastCalledWith('none')
  })

  it('offers Reset style only on a styled line', () => {
    const plain = mount()
    expect(screen.queryByRole('button', { name: 'Reset style' })).toBeNull()
    plain.view.unmount()
    const { onStyle } = mount({ style: { fill: '#ff0000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Reset style' }))
    expect(onStyle).toHaveBeenCalledWith(null)
  })

  it('Reset style hands the focus to the font before it goes', () => {
    const { onStyle } = mount({ style: { fill: '#ff0000' } })
    const reset = screen.getByRole('button', { name: 'Reset style' })
    act(() => reset.focus())
    fireEvent.click(reset)
    expect(screen.getByLabelText('Font')).toHaveFocus()
    expect(onStyle).toHaveBeenCalledWith(null)
  })
})
