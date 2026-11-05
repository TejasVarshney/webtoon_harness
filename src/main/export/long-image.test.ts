import { describe, expect, it } from 'vitest'
import { PartCanvas, type Bitmap } from './long-image'

function solid(width: number, height: number, bgra: [number, number, number, number]): Bitmap {
  const data = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) data.set(bgra, i * 4)
  return { width, height, data }
}

describe('PartCanvas', () => {
  it('copies bitmaps in top to bottom as they arrive', () => {
    const red = solid(2, 1, [0, 0, 255, 255])
    const blue = solid(2, 2, [255, 0, 0, 255])
    const canvas = new PartCanvas(3)
    canvas.add(red)
    canvas.add(blue)
    const out = canvas.take()
    expect(out.width).toBe(2)
    expect(out.height).toBe(3)
    expect(out.data.length).toBe(2 * 3 * 4)
    const rowBytes = 2 * 4
    expect(out.data.subarray(0, rowBytes)).toEqual(red.data)
    expect(out.data.subarray(rowBytes)).toEqual(blue.data)
  })

  it('holds one buffer of width x capacity, and gives back only the rows filled', () => {
    const canvas = new PartCanvas(10)
    canvas.add(solid(3, 4, [1, 2, 3, 255]))
    expect(canvas.allocatedBytes).toBe(3 * 10 * 4)
    const out = canvas.take()
    expect(out.height).toBe(4)
    expect(out.data.length).toBe(3 * 4 * 4)
    // Taking empties it, so the buffer is not held past the encode.
    expect(canvas.allocatedBytes).toBe(0)
  })

  it('rejects bitmaps of different widths', () => {
    const canvas = new PartCanvas(2)
    canvas.add(solid(2, 1, [0, 0, 0, 255]))
    expect(() => canvas.add(solid(3, 1, [0, 0, 0, 255]))).toThrow(/width/)
  })

  it('refuses rows past its capacity', () => {
    const canvas = new PartCanvas(3)
    canvas.add(solid(1, 2, [0, 0, 0, 255]))
    expect(() => canvas.add(solid(1, 2, [0, 0, 0, 255]))).toThrow('Long image part is over 3 px')
  })

  it('refuses a capacity over the part limit, and accepts exactly the limit', () => {
    expect(() => new PartCanvas(65001)).toThrow('Long image part is over 65000 px')
    const canvas = new PartCanvas(65000)
    canvas.add({ width: 1, height: 32500, data: Buffer.alloc(32500 * 4) })
    canvas.add({ width: 1, height: 32500, data: Buffer.alloc(32500 * 4) })
    expect(canvas.take().height).toBe(65000)
  })
})
