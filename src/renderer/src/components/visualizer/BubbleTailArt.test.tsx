import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DialogueLine } from '@shared/types'
import { DialogueOverlay, type OverlayEditing } from './DialogueOverlay'

function line(id: string, text: string, o: Partial<DialogueLine> = {}): DialogueLine {
  return { id, speakerId: null, kind: 'speech', text, placement: null, style: null, tail: null, ...o }
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}) } as DOMRect
}

// jsdom has no layout: the overlay is 400x600 at the origin and the bubble 100x50 at (100, 100), so its centre is (150, 125).
let bubbleRect = rect(100, 100, 100, 50)
let overlayRect = rect(0, 0, 400, 600)
const TIP = { x: 0.5, y: 0.5 }

beforeEach(() => {
  bubbleRect = rect(100, 100, 100, 50)
  overlayRect = rect(0, 0, 400, 600)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    return this.classList.contains('bubble') ? bubbleRect : overlayRect
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const pathOf = (container: HTMLElement): string => container.querySelector('.bubble-tail path')!.getAttribute('d')!

/** The stage's overlay with the first bubble selected, so it has its dot. */
const selectedFirst: OverlayEditing = { selected: 0, textEditing: null, textEditor: null, preview: null, tailPreview: null, dragging: null, bind: () => ({}), bindTail: () => ({}) }
const dotOf = (container: HTMLElement): string => container.querySelector<HTMLElement>('.bubble-tail-handle')!.style.transform

describe('BubbleTailArt', () => {
  it("draws the tail to the tip, in px from the bubble's centre", () => {
    // The tip is at (0.5, 0.5) of 400x600: (200, 300), so (50, 175) from the centre.
    const { container } = render(<DialogueOverlay dialogue={[line('dlg_0000000001', 'Hi', { tail: TIP })]} />)
    const d = pathOf(container)
    expect(d).toContain('L50 175')
    expect(d).not.toMatch(/NaN/)
  })

  it('reads the same at any stage zoom', () => {
    // On screen everything is twice the size, and the overlay's offsetWidth stays 400: the tip is still (50, 175).
    bubbleRect = rect(200, 200, 200, 100)
    overlayRect = rect(0, 0, 800, 1200)
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400)
    const { container } = render(<DialogueOverlay dialogue={[line('dlg_0000000001', 'Hi', { tail: TIP })]} />)
    expect(pathOf(container)).toContain('L50 175')
  })

  it('draws no art for an automatic tail, or for none', () => {
    const { container } = render(<DialogueOverlay dialogue={[line('dlg_0000000001', 'Auto'), line('dlg_0000000002', 'Off', { tail: 'none' })]} />)
    expect(container.querySelector('.bubble-tail')).toBeNull()
    const off = [...container.querySelectorAll('.bubble')].find((b) => b.textContent === 'Off')!
    expect(off).toHaveClass('bubble-tail-none')
  })

  it('draws three puffs for a thought', () => {
    const { container } = render(<DialogueOverlay dialogue={[line('dlg_0000000001', 'Hm', { kind: 'thought', tail: TIP })]} />)
    expect(container.querySelectorAll('.bubble-tail ellipse')).toHaveLength(3)
    expect(container.querySelector('.bubble-tail path')).toBeNull()
    expect(container.querySelector('.bubble')).toHaveClass('bubble-tail-point')
  })

  it('hides a stored tail on a caption and brings it back as speech', () => {
    const { container, rerender } = render(<DialogueOverlay dialogue={[line('dlg_0000000001', 'Later', { kind: 'narration', tail: TIP })]} />)
    expect(container.querySelector('.bubble-tail')).toBeNull()
    rerender(<DialogueOverlay dialogue={[line('dlg_0000000001', 'Later', { kind: 'speech', tail: TIP })]} />)
    expect(container.querySelector('.bubble-tail path')).not.toBeNull()
  })

  it('redraws when the bubble resizes', () => {
    let fire: () => void = () => {}
    class FakeObserver {
      constructor(callback: () => void) {
        fire = callback
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', FakeObserver)
    const { container } = render(<DialogueOverlay dialogue={[line('dlg_0000000001', 'Hi', { tail: TIP })]} />)
    const before = pathOf(container)
    bubbleRect = rect(100, 100, 160, 80)
    // A resize observer's callback runs outside React's own batching.
    act(() => fire())
    expect(pathOf(container)).not.toBe(before)
  })

  describe('a resting dot', () => {
    // The panel is 400x600. jsdom has no font size, so 1em is 16 px and a tail reaches 17.6 px past the bubble.
    it('keeps its usual place while that is inside the panel', () => {
      const { container } = render(<DialogueOverlay dialogue={[line('dlg_0000000001', 'Off', { tail: 'none' })]} editing={selectedFirst} />)
      expect(dotOf(container)).toBe('translate(0px, 42.6px)')
    })

    it('stays whole inside the panel when its bubble is at the bottom edge', () => {
      // The centre is 25 px above the edge, and the dot's half size of 7 px is kept clear of it.
      bubbleRect = rect(100, 550, 100, 50)
      const { container } = render(<DialogueOverlay dialogue={[line('dlg_0000000001', 'Off', { tail: 'none' })]} editing={selectedFirst} />)
      expect(dotOf(container)).toBe('translate(0px, 18px)')
    })

    it('stays whole inside the panel when a tail out of the frame would put it above the top edge', () => {
      bubbleRect = rect(100, 0, 100, 50)
      const { container } = render(<DialogueOverlay dialogue={[line('dlg_0000000001', 'Hi')]} editing={selectedFirst} />)
      expect(container.querySelector('.bubble')).toHaveAttribute('data-tail', 'edge')
      expect(dotOf(container)).toBe('translate(23.12px, -18px)')
    })

    it('stays inside at the sides too', () => {
      // With no cast the tail leans right, 23.12 px from the centre, and the centre is 10 px from the right edge.
      bubbleRect = rect(340, 100, 100, 50)
      const right = render(<DialogueOverlay dialogue={[line('dlg_0000000001', 'Hi')]} editing={selectedFirst} />)
      expect(dotOf(right.container)).toBe('translate(3px, -42.6px)')
      right.unmount()
      // With someone standing on the right it leans left, and the centre is 10 px from the left edge.
      bubbleRect = rect(-40, 100, 100, 50)
      const left = render(<DialogueOverlay dialogue={[line('dlg_0000000001', 'Hi')]} cast={[{ characterId: 'chr_0000000001', position: 'right' }]} editing={selectedFirst} />)
      expect(dotOf(left.container)).toBe('translate(-3px, -42.6px)')
    })

    it('keeps 7 px on screen at any stage zoom', () => {
      // Everything is twice the size on screen: the centre is 25 px from the edge at the overlay's scale, and 7 px on screen is 3.5 there.
      bubbleRect = rect(200, 1100, 200, 100)
      overlayRect = rect(0, 0, 800, 1200)
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400)
      const { container } = render(<DialogueOverlay dialogue={[line('dlg_0000000001', 'Off', { tail: 'none' })]} editing={selectedFirst} />)
      expect(dotOf(container)).toBe('translate(0px, 21.5px)')
    })

    it('leaves a stored tip where it is, at the very edge', () => {
      const { container } = render(<DialogueOverlay dialogue={[line('dlg_0000000001', 'Hi', { tail: { x: 0.5, y: 1 } })]} editing={selectedFirst} />)
      expect(dotOf(container)).toBe('translate(50px, 475px)')
    })
  })
})
