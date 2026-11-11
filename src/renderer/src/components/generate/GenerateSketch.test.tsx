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
