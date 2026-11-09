import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BubblePlacement, BubbleShape, BubbleStyle, DialogueLine } from '@shared/types'
import { DialogueOverlay, type OverlayEditing } from './DialogueOverlay'

function line(id: string, text: string, o: Partial<DialogueLine> = {}): DialogueLine {
  return { id, speakerId: null, kind: 'speech', text, placement: null, style: null, tail: null, ...o }
}

const at = (x: number, y: number): BubblePlacement => ({ x, y })

/** An `editing` prop with nothing selected, which the tests override one field at a time. */
function editing(o: Partial<OverlayEditing> = {}): OverlayEditing {
  return { selected: null, textEditing: null, textEditor: null, preview: null, tailPreview: null, widthPreview: null, dragging: null, bind: () => ({ tabIndex: 0 }), bindTail: () => ({}), bindWidth: () => ({}), ...o }
}

function bubbleOf(container: HTMLElement, text: string): HTMLElement {
  const found = [...container.querySelectorAll<HTMLElement>('.bubble')].find((b) => b.textContent === text)
  if (!found) throw new Error(`no bubble says ${text}`)
  return found
}

describe('DialogueOverlay', () => {
  it('draws a placed line in the placed layer at its fractions, and not in the flow', () => {
    const { container } = render(<DialogueOverlay dialogue={[line('dlg_0000000001', 'Here.', { placement: at(0.25, 0.75) })]} />)
    const bubble = bubbleOf(container, 'Here.')
    expect(bubble.parentElement).toHaveClass('dialogue-placed')
    expect(bubble.style.left).toBe('25%')
    expect(bubble.style.top).toBe('75%')
    expect(container.querySelector('.dialogue-flow .bubble')).toBeNull()
  })

  it('leaves an unplaced line in the flow, with no position of its own', () => {
    const { container } = render(<DialogueOverlay dialogue={[line('dlg_0000000001', 'Auto.')]} />)
    const bubble = bubbleOf(container, 'Auto.')
    expect(bubble.parentElement).toHaveClass('dialogue-flow')
    expect(bubble.style.left).toBe('')
    expect(container.querySelector('.dialogue-placed')).toBeNull()
  })

  it('puts a placed sound effect in the placed layer, not the sfx layer', () => {
    const { container } = render(
      <DialogueOverlay
        dialogue={[line('dlg_0000000001', 'BOOM', { kind: 'sfx', placement: at(0.5, 0.5) }), line('dlg_0000000002', 'CRASH', { kind: 'sfx' })]}
      />
    )
    expect(bubbleOf(container, 'BOOM').parentElement).toHaveClass('dialogue-placed')
    expect(bubbleOf(container, 'CRASH').parentElement).toHaveClass('dialogue-sfx')
  })

  it('marks the selected bubble by its index in the dialogue', () => {
    const dialogue = [line('dlg_0000000001', 'One.'), line('dlg_0000000002', 'Two.', { placement: at(0.4, 0.4) })]
    const { container } = render(<DialogueOverlay dialogue={dialogue} editing={editing({ selected: 1 })} />)
    expect(bubbleOf(container, 'Two.')).toHaveAttribute('data-selected', 'true')
    expect(bubbleOf(container, 'One.')).not.toHaveAttribute('data-selected', 'true')
    expect(container.querySelector('.dialogue-overlay')).toHaveAttribute('data-editing', 'true')
  })

  it('renders the text editor in place of the text of the line being typed', () => {
    const dialogue = [line('dlg_0000000001', 'One.'), line('dlg_0000000002', 'Two.', { placement: at(0.4, 0.4) })]
    const { container, getByTestId, queryByText } = render(
      <DialogueOverlay dialogue={dialogue} editing={editing({ textEditing: 1, textEditor: <input data-testid="text-editor" /> })} />
    )
    expect(bubbleOf(container, 'One.')).toBeInTheDocument()
    expect(queryByText('Two.')).toBeNull()
    expect(getByTestId('text-editor').closest('.bubble')).toBe(container.querySelectorAll('.bubble')[1])
  })

  it('draws the preview placement instead of the stored one, for its index only', () => {
    const dialogue = [line('dlg_0000000001', 'One.', { placement: at(0.1, 0.1) }), line('dlg_0000000002', 'Two.', { placement: at(0.4, 0.4) })]
    const { container } = render(<DialogueOverlay dialogue={dialogue} editing={editing({ preview: { index: 0, placement: at(0.6, 0.9) } })} />)
    expect(bubbleOf(container, 'One.').style.left).toBe('60%')
    expect(bubbleOf(container, 'One.').style.top).toBe('90%')
    expect(bubbleOf(container, 'Two.').style.left).toBe('40%')
  })

  it('draws a preview for an unplaced line as placed, while it is dragged out of the flow', () => {
    const { container } = render(
      <DialogueOverlay dialogue={[line('dlg_0000000001', 'One.')]} editing={editing({ preview: { index: 0, placement: at(0.3, 0.2) }, dragging: 0 })} />
    )
    const bubble = bubbleOf(container, 'One.')
    expect(bubble.parentElement).toHaveClass('dialogue-placed')
    expect(bubble).toHaveAttribute('data-dragging', 'true')
  })

  it('spreads the bind of each line onto its bubble', () => {
    const dialogue = [line('dlg_0000000001', 'One.'), line('dlg_0000000002', 'Two.')]
    const { container } = render(<DialogueOverlay dialogue={dialogue} editing={editing({ bind: (i) => ({ tabIndex: 0, 'aria-label': `Line ${i + 1}` }) })} />)
    expect(bubbleOf(container, 'One.')).toHaveAttribute('aria-label', 'Line 1')
    expect(bubbleOf(container, 'Two.')).toHaveAttribute('aria-label', 'Line 2')
  })

  it('gives no bubble a tab stop without editing', () => {
    const dialogue = [line('dlg_0000000001', 'One.'), line('dlg_0000000002', 'Two.', { placement: at(0.4, 0.4) })]
    const { container } = render(<DialogueOverlay dialogue={dialogue} />)
    for (const bubble of container.querySelectorAll('.bubble')) expect(bubble).not.toHaveAttribute('tabindex')
    expect(container.querySelector('.dialogue-overlay')).not.toHaveAttribute('data-editing')
  })

  it('gives an unstyled bubble no inline style, as before', () => {
    const { container } = render(<DialogueOverlay dialogue={[line('dlg_0000000001', 'Plain.')]} />)
    expect(bubbleOf(container, 'Plain.').getAttribute('style')).toBeNull()
  })

  it('a bubble with a width is drawn that wide', () => {
    const dialogue = [line('dlg_0000000001', 'Wide.', { placement: at(0.5, 0.5), style: { width: 0.42 } })]
    const { container } = render(<DialogueOverlay dialogue={dialogue} />)
    const bubble = bubbleOf(container, 'Wide.')
    expect(bubble).toHaveClass('bubble-sized')
    expect(bubble.style.getPropertyValue('--bubble-width')).toBe('42%')
  })

  it("a bubble without a width keeps today's look", () => {
    const { container } = render(<DialogueOverlay dialogue={[line('dlg_0000000001', 'Plain.'), line('dlg_0000000002', 'Red.', { style: { fill: '#ff0000' } })]} />)
    expect(bubbleOf(container, 'Plain.')).not.toHaveClass('bubble-sized')
    expect(bubbleOf(container, 'Plain.').getAttribute('style')).toBeNull()
    expect(bubbleOf(container, 'Red.')).not.toHaveClass('bubble-sized')
    expect(bubbleOf(container, 'Red.').style.getPropertyValue('--bubble-width')).toBe('')
  })

  it("keeps a placed bubble's position beside its look", () => {
    const dialogue = [line('dlg_0000000001', 'Here.', { placement: at(0.25, 0.75), style: { fill: '#ff0000' } })]
    const { container } = render(<DialogueOverlay dialogue={dialogue} />)
    const { style } = bubbleOf(container, 'Here.')
    expect(style.left).toBe('25%')
    expect(style.getPropertyValue('--bubble-fill')).toBe('#ff0000')
  })

  it('draws shouts and thoughts from inline SVG', () => {
    const dialogue = [line('dlg_0000000001', 'LOOK OUT!'), line('dlg_0000000002', 'Hmm.', { kind: 'thought' }), line('dlg_0000000003', 'Plain.')]
    const { container } = render(<DialogueOverlay dialogue={dialogue} />)
    expect(container.querySelector('.bubble-shout .bubble-body polygon')).not.toBeNull()
    expect(container.querySelector('.bubble-thought .bubble-body circle')).not.toBeNull()
    expect(bubbleOf(container, 'Plain.').querySelector('.bubble-body')).toBeNull()
  })

  it('puts a line shaped as a sound effect in the sound-effect layer', () => {
    const { container } = render(<DialogueOverlay dialogue={[line('dlg_0000000001', 'Thud.', { kind: 'speech', style: { shape: 'sfx' } })]} />)
    expect(bubbleOf(container, 'Thud.').parentElement).toHaveClass('dialogue-sfx')
  })
})

describe('DialogueOverlay merging', () => {
  type Box = [left: number, top: number, width: number, height: number]
  // jsdom has no layout: each bubble's box comes from its text, and the overlay is 400x600 at the origin.
  let boxes: Record<string, Box> = {}
  const rect = ([left, top, width, height]: Box): DOMRect => ({ left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) }) as DOMRect

  beforeEach(() => {
    boxes = { A: [0, 0, 100, 50], B: [60, 0, 100, 50] }
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return rect(this.classList.contains('bubble') ? (boxes[this.textContent ?? ''] ?? [0, 0, 0, 0]) : [0, 0, 400, 600])
    })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const placed = (text: string, style: BubbleStyle | null = null): DialogueLine => line(`dlg_${text}`, text, { placement: at(0.5, 0.5), style })
  const shaped = (text: string, shape: BubbleShape, style: BubbleStyle = {}): DialogueLine => placed(text, { ...style, shape })
  const merged = (container: HTMLElement): number => container.querySelectorAll('.bubble-merged').length

  it('merges two overlapping placed bubbles of the same look, with no editing, as the strip and an export draw them', () => {
    const { container } = render(<DialogueOverlay dialogue={[placed('A'), placed('B')]} />)
    expect(container.querySelectorAll('.dialogue-merge ellipse')).toHaveLength(4)
    expect(merged(container)).toBe(2)
    expect(container.querySelector('.dialogue-merge')!.nextElementSibling).toHaveClass('dialogue-placed')
  })

  it('paints every outline before any fill', () => {
    const { container } = render(<DialogueOverlay dialogue={[placed('A'), placed('B')]} />)
    const fills = [...container.querySelectorAll('.dialogue-merge ellipse')].map((e) => e.getAttribute('fill'))
    expect(fills).toEqual(['#111111', '#111111', '#ffffff', '#ffffff'])
  })

  it('draws no layer when nothing overlaps', () => {
    boxes.B = [200, 0, 100, 50]
    const { container } = render(<DialogueOverlay dialogue={[placed('A'), placed('B')]} />)
    expect(container.querySelector('.dialogue-merge')).toBeNull()
    expect(merged(container)).toBe(0)
  })

  it('leaves bubbles of different looks alone', () => {
    const { container } = render(<DialogueOverlay dialogue={[placed('A'), placed('B', { fill: '#ff0000' })]} />)
    expect(merged(container)).toBe(0)
  })

  it('leaves a bubble in the automatic layout alone', () => {
    const { container } = render(<DialogueOverlay dialogue={[placed('A'), line('dlg_B', 'B')]} />)
    expect(merged(container)).toBe(0)
  })

  it('draws in the overlay own scale when the stage is zoomed', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(200)
    const { container } = render(<DialogueOverlay dialogue={[placed('A'), placed('B')]} />)
    const outline = container.querySelector('.dialogue-merge ellipse')!
    expect(outline.getAttribute('rx')).toBe('25')
    expect(outline.getAttribute('ry')).toBe('12.5')
    expect(outline.getAttribute('cx')).toBe('25')
  })

  it('keeps a merged bubble merged while its text is open', () => {
    // The open bubble's text is the editor now, so its box is found by its empty text.
    boxes[''] = boxes.B
    const { container } = render(<DialogueOverlay dialogue={[placed('A'), placed('B')]} editing={editing({ textEditing: 1, textEditor: <textarea aria-label="typing" /> })} />)
    expect(merged(container)).toBe(2)
    expect(container.querySelector('textarea')!.closest('.bubble')).toHaveClass('bubble-merged')
  })

  it('never gives an ellipse a negative radius', () => {
    boxes = { A: [0, 0, 4, 4], B: [1, 0, 4, 4] }
    for (const shape of ['speech', 'whisper'] as const) {
      const { container, unmount } = render(<DialogueOverlay dialogue={[shaped('A', shape, { strokeWidth: 6 }), shaped('B', shape, { strokeWidth: 6 })]} />)
      for (const e of container.querySelectorAll('.dialogue-merge ellipse')) {
        expect(Number(e.getAttribute('rx'))).toBeGreaterThanOrEqual(0)
        expect(Number(e.getAttribute('ry'))).toBeGreaterThanOrEqual(0)
      }
      expect(merged(container)).toBe(2)
      unmount()
    }
  })

  it('merges at an outline width of 0', () => {
    const { container } = render(<DialogueOverlay dialogue={[placed('A', { strokeWidth: 0 }), placed('B', { strokeWidth: 0 })]} />)
    expect(merged(container)).toBe(2)
    expect(container.querySelector('.dialogue-merge ellipse')!.getAttribute('rx')).toBe('50')
  })

  it('draws a merged whisper dashed', () => {
    const { container } = render(<DialogueOverlay dialogue={[shaped('A', 'whisper'), shaped('B', 'whisper')]} />)
    expect(container.querySelectorAll('.dialogue-merge ellipse[stroke-dasharray="4 3"]')).toHaveLength(2)
  })

  it('draws a merged shout at three times the outline, and a cloud at two and a half', () => {
    const shout = render(<DialogueOverlay dialogue={[shaped('A', 'shout'), shaped('B', 'shout')]} />)
    expect(shout.container.querySelectorAll('.dialogue-merge svg[stroke-width="6"] polygon')).toHaveLength(2)
    expect(shout.container.querySelectorAll('.dialogue-merge svg[stroke="none"] polygon')).toHaveLength(2)
    shout.unmount()
    const thought = render(<DialogueOverlay dialogue={[shaped('A', 'thought'), shaped('B', 'thought')]} />)
    expect(thought.container.querySelectorAll('.dialogue-merge svg[stroke-width="5"]')).toHaveLength(2)
    expect(thought.container.querySelectorAll('.dialogue-merge svg[stroke="none"]')).toHaveLength(2)
  })

  it('survives a merged line being removed', () => {
    const { container, rerender } = render(<DialogueOverlay dialogue={[placed('A'), placed('B')]} />)
    expect(merged(container)).toBe(2)
    rerender(<DialogueOverlay dialogue={[placed('A')]} />)
    expect(merged(container)).toBe(0)
    expect(container.querySelector('.dialogue-merge')).toBeNull()
  })

  it('ends a merge when a bubble turns into a shape that cannot merge', () => {
    const { container, rerender } = render(<DialogueOverlay dialogue={[placed('A'), placed('B')]} />)
    rerender(<DialogueOverlay dialogue={[placed('A'), shaped('B', 'caption')]} />)
    expect(merged(container)).toBe(0)
  })

  it('draws a curly bubble from its measured box', () => {
    const { container } = render(<DialogueOverlay dialogue={[shaped('A', 'curly')]} />)
    expect(container.querySelector('.bubble-body path')!.getAttribute('d')).toContain('C')
  })

  it('draws a curly bubble with no path while it has no size', () => {
    boxes.A = [0, 0, 0, 0]
    const { container } = render(<DialogueOverlay dialogue={[shaped('A', 'curly')]} />)
    expect(container.querySelector('.bubble-body')).not.toBeNull()
    expect(container.querySelector('.bubble-body path')).toBeNull()
  })

  it('merges three bubbles chained through the middle one', () => {
    boxes.C = [150, 0, 100, 50]
    const { container } = render(<DialogueOverlay dialogue={[placed('A'), placed('C'), placed('B')]} />)
    expect(merged(container)).toBe(3)
    expect(container.querySelectorAll('.dialogue-merge g')).toHaveLength(1)
  })
})
