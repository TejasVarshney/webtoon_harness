import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { BubblePlacement, DialogueLine } from '@shared/types'
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
