import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initialGenerateState, useGenerateStore } from '../../stores/generate-store'
import { EPISODE_ID } from '../../test/panel-fixtures'
import { GenerateSketch } from './GenerateSketch'

const PNG_URL = 'data:image/png;base64,SKETCH'

/** What each fake canvas was asked to draw onto itself, by the canvas it copied. */
let copies: unknown[] = []

/**
 * jsdom has no 2D canvas: a stand-in for each canvas that knows only whether it holds ink. The sketch canvas starts
 * transparent; the paper canvas a save draws on is filled white and gets the ink drawn onto it.
 */
function fakeCanvas(): void {
  copies = []
  const contexts = new WeakMap<HTMLCanvasElement, unknown>()
  const make = () => {
    let inked = false
    const ctx = {
      fillStyle: '',
      strokeStyle: '',
      globalCompositeOperation: 'source-over',
      lineWidth: 1,
      lineCap: '',
      lineJoin: '',
      clearRect: () => {
        inked = false
      },
      fillRect: () => undefined,
      beginPath: () => undefined,
      arc: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      rect: () => undefined,
      ellipse: () => undefined,
      fill: () => {
        if (ctx.globalCompositeOperation === 'source-over') inked = true
      },
      stroke: () => {
        if (ctx.globalCompositeOperation === 'source-over') inked = true
      },
      drawImage: (source: unknown) => {
        copies.push(source)
        inked = true
      },
      putImageData: (d: { inked: boolean }) => {
        inked = d.inked
      },
      getImageData: (_x: number, _y: number, w: number, h: number) => {
        const data = new Uint8ClampedArray(w * h * 4)
        if (inked) data[3] = 255
        return { data, width: w, height: h, inked }
      }
    }
    return ctx
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    if (!contexts.has(this)) contexts.set(this, make())
    return contexts.get(this) as never
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(PNG_URL)
}

function stroke(): void {
  const canvas = screen.getByTestId('generate-sketch-canvas')
  fireEvent.pointerDown(canvas, { button: 0, clientX: 5, clientY: 5 })
  fireEvent.pointerMove(canvas, { clientX: 9, clientY: 12 })
  fireEvent.pointerUp(canvas, { clientX: 9, clientY: 12 })
}

beforeEach(() => {
  fakeCanvas()
  useGenerateStore.setState({ ...initialGenerateState })
  useGenerateStore.getState().open({ episodeId: EPISODE_ID, referencePanelIds: [] })
})
afterEach(() => vi.restoreAllMocks())

describe('GenerateSketch', () => {
  it('drawing stores the sketch in the draft', () => {
    render(<GenerateSketch />)
    expect(useGenerateStore.getState().draft.sketchPng).toBeNull()
    stroke()
    expect(useGenerateStore.getState().draft.sketchPng).toBe(PNG_URL)
    expect(useGenerateStore.getState().isDirty()).toBe(true)
  })

  it('stores the sketch when a stroke ends, not on every move', () => {
    render(<GenerateSketch />)
    const canvas = screen.getByTestId('generate-sketch-canvas')
    fireEvent.pointerDown(canvas, { button: 0, clientX: 5, clientY: 5 })
    fireEvent.pointerMove(canvas, { clientX: 9, clientY: 12 })
    expect(useGenerateStore.getState().draft.sketchPng).toBeNull()
    fireEvent.pointerUp(canvas, { clientX: 9, clientY: 12 })
    expect(useGenerateStore.getState().draft.sketchPng).toBe(PNG_URL)
  })

  it('New sketch clears it', async () => {
    render(<GenerateSketch />)
    expect(screen.getByRole('button', { name: 'New sketch' })).toBeDisabled()
    stroke()
    await userEvent.click(screen.getByRole('button', { name: 'New sketch' }))
    expect(useGenerateStore.getState().draft.sketchPng).toBeNull()
    expect(useGenerateStore.getState().isDirty()).toBe(false)
  })

  it('zooms with the bar, the keys and the wheel, and goes back to the fit', async () => {
    render(<GenerateSketch />)
    const zoom = (): string => screen.getByTestId('generate-sketch-paper').style.getPropertyValue('--zoom')
    expect(zoom()).toBe('1')
    expect(screen.getByRole('button', { name: 'Zoom 100%, fit to the stage' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(zoom()).toBe('1.25')
    fireEvent.keyDown(window, { key: '+' })
    expect(zoom()).toBe('1.5625')
    // The plain wheel zooms, no Ctrl needed: down zooms out, up zooms in.
    fireEvent.wheel(screen.getByTestId('generate-sketch-viewport'), { deltaY: 200 })
    expect(Number(zoom())).toBeLessThan(1.5625)
    fireEvent.wheel(screen.getByTestId('generate-sketch-viewport'), { deltaY: -400 })
    expect(Number(zoom())).toBeGreaterThan(1.5625)
    fireEvent.keyDown(window, { key: '0' })
    expect(zoom()).toBe('1')
  })

  describe('in a 600 by 400 frame', () => {
    // jsdom has no layout: the frame is 600 wide in a window 800 high, so a 2:3 paper fits it at 266.67 by 400.
    beforeEach(() => {
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('generate-sketch-viewport') ? 600 : 0
      })
      vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800)
    })

    const paper = () => {
      const style = screen.getByTestId('generate-sketch-paper').style
      return { left: parseFloat(style.left), top: parseFloat(style.top), width: parseFloat(style.width) }
    }
    const drag = (dx: number, dy: number, button = 2): void => {
      const canvas = screen.getByTestId('generate-sketch-canvas')
      const v = screen.getByTestId('generate-sketch-viewport')
      fireEvent.pointerDown(canvas, { button, buttons: button === 2 ? 2 : 4, clientX: 300, clientY: 200 })
      fireEvent.pointerMove(v, { buttons: 2, clientX: 300 + dx, clientY: 200 + dy })
      fireEvent.pointerUp(v, { button })
    }

    it('puts the paper in the middle of the frame at the fit', () => {
      render(<GenerateSketch />)
      expect(screen.getByTestId('generate-sketch-viewport').style.height).toBe('400px')
      expect(paper().width).toBeCloseTo(266.67, 1)
      expect(paper().left).toBeCloseTo(166.67, 1)
      expect(paper().top).toBeCloseTo(0, 5)
    })

    it('moves the paper sideways with a right-button drag at the fit, and draws nothing', () => {
      render(<GenerateSketch />)
      drag(-100, 0)
      expect(paper().left).toBeCloseTo(66.67, 1)
      expect(useGenerateStore.getState().draft.sketchPng).toBeNull()
    })

    it('moves the paper past the frame, but always leaves a quarter of it in view', () => {
      render(<GenerateSketch />)
      // 266.67 by 400: a quarter of its width, 66.67, and of its height, 100, stay in the frame.
      drag(-1000, -1000)
      expect(paper().left).toBeCloseTo(-200, 1)
      expect(paper().top).toBeCloseTo(-300, 1)
      drag(2000, 2000)
      expect(paper().left).toBeCloseTo(533.33, 1)
      expect(paper().top).toBeCloseTo(300, 1)
    })

    it('zoomed in, moves past the frame too, leaving a quarter of the frame covered', async () => {
      render(<GenerateSketch />)
      for (let i = 0; i < 4; i++) await userEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
      expect(paper().width).toBeGreaterThan(600)
      drag(5000, 5000)
      expect(paper().left).toBeCloseTo(450, 5)
      expect(paper().top).toBeCloseTo(300, 5)
      drag(-9000, -9000)
      const style = screen.getByTestId('generate-sketch-paper').style
      expect(paper().left + parseFloat(style.width)).toBeCloseTo(150, 5)
      expect(paper().top + parseFloat(style.height)).toBeCloseTo(100, 5)
    })
  })

  it('picks tools and undoes from the keyboard, but not while typing elsewhere', () => {
    render(
      <>
        <GenerateSketch />
        <textarea aria-label="Description" />
      </>
    )
    fireEvent.keyDown(window, { key: 'r' })
    expect(screen.getByRole('button', { name: 'Rectangle' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(screen.getByLabelText('Description'), { key: 'e' })
    expect(screen.getByRole('button', { name: 'Rectangle' })).toHaveAttribute('aria-pressed', 'true')
    stroke()
    expect(useGenerateStore.getState().draft.sketchPng).toBe(PNG_URL)
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(useGenerateStore.getState().draft.sketchPng).toBeNull()
  })

  it('offers pen, eraser, line, rectangle, ellipse, sizes and undo', async () => {
    render(<GenerateSketch />)
    const tools = screen.getByRole('toolbar', { name: 'Sketch tools' })
    for (const name of ['Pen', 'Eraser', 'Line', 'Rectangle', 'Ellipse', 'Fine brush', 'Medium brush', 'Bold brush', 'Undo stroke']) {
      expect(tools.querySelector(`[aria-label="${name}"]`), name).not.toBeNull()
    }
    expect(screen.getByRole('button', { name: 'Undo stroke' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Rectangle' }))
    expect(screen.getByRole('button', { name: 'Rectangle' })).toHaveAttribute('aria-pressed', 'true')
    stroke()
    await userEvent.click(screen.getByRole('button', { name: 'Undo stroke' }))
    expect(useGenerateStore.getState().draft.sketchPng).toBeNull()
  })

  it('changing the aspect keeps the ink, rescaled', () => {
    render(<GenerateSketch />)
    const canvas = screen.getByTestId<HTMLCanvasElement>('generate-sketch-canvas')
    expect([canvas.width, canvas.height]).toEqual([683, 1024])
    stroke()
    copies = []
    act(() => useGenerateStore.getState().patch({ aspect: '16:9' }))
    expect([canvas.width, canvas.height]).toEqual([1024, 576])
    // The old ink was drawn into the new canvas, and the draft holds the sketch in its new shape.
    expect(copies.some((c) => (c as HTMLCanvasElement).width === 683 && (c as HTMLCanvasElement).height === 1024)).toBe(true)
    expect(useGenerateStore.getState().draft.sketchPng).toBe(PNG_URL)
  })
})
