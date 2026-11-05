import { describe, expect, it } from 'vitest'
import { stitchBitmaps, type Bitmap } from './long-image'

function solid(width: number, height: number, bgra: [number, number, number, number]): Bitmap {
  const data = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) data.set(bgra, i * 4)
  return { width, height, data }
}

describe('stitchBitmaps', () => {
  it('stacks bitmaps top to bottom', () => {
    const red = solid(2, 1, [0, 0, 255, 255])
    const blue = solid(2, 2, [255, 0, 0, 255])
    const out = stitchBitmaps([red, blue])
    expect(out.width).toBe(2)
    expect(out.height).toBe(3)
    expect(out.data.length).toBe(2 * 3 * 4)
    const rowBytes = 2 * 4
    expect(out.data.subarray(0, rowBytes)).toEqual(red.data)
    expect(out.data.subarray(rowBytes)).toEqual(blue.data)
  })

  it('rejects bitmaps of different widths', () => {
    expect(() => stitchBitmaps([solid(2, 1, [0, 0, 0, 255]), solid(3, 1, [0, 0, 0, 255])])).toThrow(/width/)
  })

  it('refuses a stitch over the part limit', () => {
    const tall = { width: 1, height: 32501, data: Buffer.alloc(32501 * 4) }
    expect(() => stitchBitmaps([tall, tall])).toThrow('Long image part is over 65000 px')
  })

  it('accepts a stitch of exactly the part limit', () => {
    const half = { width: 1, height: 32500, data: Buffer.alloc(32500 * 4) }
    expect(stitchBitmaps([half, half]).height).toBe(65000)
  })
})
