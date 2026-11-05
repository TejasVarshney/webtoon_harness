// Builds one part of a long image from its captured slices. Pure: bitmaps are plain BGRA bytes.

import { MAX_LONG_IMAGE_PX } from './slice-plan'

/** A raw bitmap: BGRA, `width * 4` bytes per row, top row first. */
export type Bitmap = { width: number; height: number; data: Buffer }

/**
 * One long-image part, filled top to bottom as its slices arrive. It holds a single buffer of width × `capacity`
 * rows × 4 bytes (allocated with the first slice, which gives the width), and each slice is copied in and can then
 * be dropped, so a part never needs more than that one buffer plus the slice being added (spec §6.2: at most
 * 1600 × 65,000 × 4 bytes).
 */
export class PartCanvas {
  private data: Buffer | null = null
  private width = 0
  private rows = 0

  /** `capacity`: the most rows the part may take, at most the 65,000 px part limit. */
  constructor(private readonly capacity: number) {
    if (capacity > MAX_LONG_IMAGE_PX) throw new Error(`Long image part is over ${MAX_LONG_IMAGE_PX} px`)
  }

  /** Bytes held right now. */
  get allocatedBytes(): number {
    return this.data?.length ?? 0
  }

  /** Copy `b` in below what is there. Every slice of a part must share a width. */
  add(b: Bitmap): void {
    if (!this.data) {
      this.width = b.width
      this.data = Buffer.allocUnsafe(b.width * this.capacity * 4)
    }
    if (b.width !== this.width) throw new Error('Long image parts must share a width')
    if (this.rows + b.height > this.capacity) throw new Error(`Long image part is over ${this.capacity} px`)
    b.data.copy(this.data, this.rows * this.width * 4, 0, b.width * b.height * 4)
    this.rows += b.height
  }

  /** The part as filled so far (only the rows written), and let go of it: the canvas is empty again. */
  take(): Bitmap {
    const out = { width: this.width, height: this.rows, data: (this.data ?? Buffer.alloc(0)).subarray(0, this.width * this.rows * 4) }
    this.data = null
    this.width = 0
    this.rows = 0
    return out
  }
}
