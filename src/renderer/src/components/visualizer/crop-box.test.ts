import { describe, expect, it } from 'vitest'
import { boxArea, fitBox, isWholeImage, moveBox, resizeBox } from './crop-box'

const image = { width: 1000, height: 500 }

describe('crop box', () => {
  it('starts as the largest box of the ratio, centred', () => {
    expect(fitBox(image, 1)).toEqual({ x: 250, y: 0, width: 500, height: 500 })
    expect(fitBox(image, 4)).toEqual({ x: 0, y: 125, width: 1000, height: 250 })
    expect(isWholeImage(fitBox(image, 2), image)).toBe(true)
    expect(isWholeImage(fitBox(image, 1), image)).toBe(false)
  })

  it('moves inside the image only', () => {
    const box = fitBox(image, 1)
    expect(moveBox(box, -100, 30, image)).toEqual({ x: 150, y: 0, width: 500, height: 500 })
    expect(moveBox(box, 9000, 0, image).x).toBe(500)
    expect(moveBox(box, -9000, 0, image).x).toBe(0)
  })

  it('resizes from a corner, keeping its ratio and the opposite corner', () => {
    const box = fitBox(image, 1)
    // Dragging the south-east corner up and left shrinks it toward the north-west corner, the way the pointer went
    // further: 200 across against 100 up.
    expect(resizeBox(box, 'se', -200, -100, image, 1)).toEqual({ x: 250, y: 0, width: 300, height: 300 })
    // A drag straight across resizes it too.
    expect(resizeBox(box, 'se', -100, 0, image, 1)).toEqual({ x: 250, y: 0, width: 400, height: 400 })
    // 50 across against 300 up: it follows the 300, as far as the top edge lets it.
    const small = { x: 100, y: 100, width: 200, height: 200 }
    expect(resizeBox(small, 'nw', -50, -300, image, 1)).toEqual({ x: 0, y: 0, width: 300, height: 300 })
  })

  it('stops at the image edge and at the smallest size', () => {
    const box = { x: 400, y: 100, width: 200, height: 200 }
    // Growing south-east is stopped by the bottom edge, 200 below the anchor.
    expect(resizeBox(box, 'se', 900, 900, image, 1)).toEqual({ x: 400, y: 100, width: 400, height: 400 })
    // Shrinking stops at 8% of the shorter side.
    expect(resizeBox(box, 'se', -900, -900, image, 1)).toEqual({ x: 400, y: 100, width: 40, height: 40 })
  })

  it('reads as fractions of the image', () => {
    expect(boxArea({ x: 250, y: 0, width: 500, height: 500 }, image)).toEqual({ x: 0.25, y: 0, width: 0.5, height: 1 })
  })
})
