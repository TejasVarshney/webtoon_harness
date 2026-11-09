import { describe, expect, it } from 'vitest'
import { makePanel } from '../main/test/factories'
import { PanelSchema } from './schemas'
import { clampGroupDelta, clampPlacement, contentBottom, panelHeight, readingOrder, resolveStrip } from './strip-canvas'

let next = 0
/** A panel with an id of its own, so a strip of them can be told apart. */
function panel(o: Parameters<typeof makePanel>[0] = {}) {
  next += 1
  return makePanel({ id: `pnl_${String(next).padStart(10, '0')}`, ...o })
}

describe('resolveStrip', () => {
  it('flows unplaced panels as the old strip did', () => {
    const [a, b] = resolveStrip([panel({ aspect: '1:1' }), panel({ aspect: '1:1' })])
    expect(a).toMatchObject({ x: 0, y: 0, width: 440, height: 440, share: 1 })
    expect(b).toMatchObject({ y: 488 })
  })

  it('shares a beside row and honours the gap', () => {
    const [a, b, c] = resolveStrip([
      panel({ aspect: '1:1' }),
      panel({ aspect: '1:1', beside: true, gapAfter: 'tight' }),
      panel({ aspect: '1:1' })
    ])
    expect(a.width).toBe(217)
    expect(b.x).toBe(223)
    expect(c.y).toBe(225)
  })

  it('an unplaced panel in the middle pushes later placed panels down', () => {
    const [, b, c] = resolveStrip([
      panel({ aspect: '1:1', placement: { x: 0, y: 0, width: 200 } }),
      panel({ aspect: '1:1' }),
      panel({ aspect: '1:1', placement: { x: 0, y: 300, width: 200 } })
    ])
    expect(b.y).toBe(248)
    expect(c.y).toBe(788)
  })

  it('keeps the order of the panels and sets share from the width', () => {
    const panels = [panel({ aspect: '1:1', placement: { x: 20, y: 10, width: 220 } }), panel({ aspect: '2:3' })]
    const placed = resolveStrip(panels)
    expect(placed.map((p) => p.panel.id)).toEqual(panels.map((p) => p.id))
    expect(placed[0]).toMatchObject({ x: 20, y: 10, width: 220, height: 220, share: 0.5 })
    // A placed panel holds no flow space of its own, so the next one starts below the placed one and its gap.
    expect(placed[1].y).toBe(278)
  })

  it('gives a slanted panel its lean, placed or not', () => {
    const [a, b] = resolveStrip([
      panel({ aspect: '1:1', frame: 'slanted' }),
      panel({ aspect: '1:1', frame: 'slanted', placement: { x: 0, y: 600, width: 200 } })
    ])
    expect(a.slant).toBe('left')
    expect(b.slant).toBe('right')
  })

  it('is empty for no panels', () => {
    expect(resolveStrip([])).toEqual([])
  })
})

/** Asserts no two resolved rectangles overlap: the invariant every layout must keep. */
function expectNoOverlap(placed: ReturnType<typeof resolveStrip>) {
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i]
      const b = placed[j]
      const apart = a.x + a.width <= b.x + 1e-6 || b.x + b.width <= a.x + 1e-6 || a.y + a.height <= b.y + 1e-6 || b.y + b.height <= a.y + 1e-6
      expect(apart, `panel ${i} overlaps panel ${j}`).toBe(true)
    }
  }
}

describe('resolveStrip with placed and unplaced panels mixed', () => {
  it('a beside panel after a placed one starts a new row below it', () => {
    const placed = resolveStrip([
      panel({ aspect: '1:1', placement: { x: 0, y: 0, width: 440 } }),
      panel({ aspect: '1:1', beside: true })
    ])
    expect(placed[1]).toMatchObject({ x: 0, y: 488, width: 440 })
    expectNoOverlap(placed)
  })

  it('an unplaced panel after a placed one stays clear of a later placed sibling', () => {
    const placed = resolveStrip([
      panel({ aspect: '1:1', placement: { x: 0, y: 0, width: 200 } }),
      panel({ aspect: '1:1' }),
      panel({ aspect: '1:1', beside: true, placement: { x: 0, y: 260, width: 200 } })
    ])
    expectNoOverlap(placed)
  })

  it('an unplaced panel between a frozen beside pair takes the full width', () => {
    const placed = resolveStrip([
      panel({ aspect: '1:1', placement: { x: 0, y: 0, width: 217 } }),
      panel({ aspect: '1:1', beside: true, placement: { x: 223, y: 0, width: 217 } }),
      panel({ aspect: '1:1' })
    ])
    expect(placed[2].width).toBe(440)
    const between = resolveStrip([
      placed[0].panel,
      panel({ aspect: '1:1' }),
      placed[1].panel
    ])
    expect(between[1]).toMatchObject({ x: 0, width: 440 })
    expectNoOverlap(between)
  })

  it('an inserted panel clears placed panels that sit side by side above the cursor', () => {
    const placed = resolveStrip([
      panel({ aspect: '1:1', placement: { x: 0, y: 0, width: 200 } }),
      panel({ aspect: '1:1' }),
      panel({ aspect: '1:1', placement: { x: 220, y: 0, width: 200 } })
    ])
    expectNoOverlap(placed)
  })
})

describe('panelHeight', () => {
  it('follows the aspect', () => {
    expect(panelHeight(200, '1:1')).toBe(200)
    expect(panelHeight(200, '2:3')).toBe(300)
  })
})

describe('contentBottom', () => {
  it('is the lowest bottom edge, 0 when empty', () => {
    expect(contentBottom([])).toBe(0)
    const placed = resolveStrip([
      panel({ aspect: '1:1', placement: { x: 0, y: 100, width: 200 } }),
      panel({ aspect: '1:1', placement: { x: 0, y: 0, width: 100 } })
    ])
    expect(contentBottom(placed)).toBe(300)
  })
})

describe('clampPlacement', () => {
  it('clamps into the strip', () => {
    expect(clampPlacement({ x: 400, y: -5, width: 100 }, '1:1')).toEqual({ x: 340, y: 0, width: 100 })
    expect(clampPlacement({ x: 0, y: 0, width: 10 }, '1:1').width).toBe(80)
    expect(clampPlacement({ x: 0, y: 0, width: 900 }, '1:1').width).toBe(440)
  })
})

describe('clampGroupDelta', () => {
  it('keeps a group rigid at the edge', () => {
    const group = resolveStrip([
      panel({ aspect: '1:1', placement: { x: 0, y: 50, width: 100 } }),
      panel({ aspect: '1:1', placement: { x: 100, y: 50, width: 100 } })
    ])
    expect(clampGroupDelta(group, -50, 0)).toEqual({ dx: 0, dy: 0 })
    expect(clampGroupDelta(group, 500, -80)).toEqual({ dx: 240, dy: -50 })
    expect(clampGroupDelta(group, 30, 20)).toEqual({ dx: 30, dy: 20 })
  })
})

describe('readingOrder', () => {
  it('reads top to bottom, then left to right', () => {
    const low = panel({ aspect: '1:1', placement: { x: 0, y: 300, width: 100 } })
    const right = panel({ aspect: '1:1', placement: { x: 200, y: 0, width: 100 } })
    const left = panel({ aspect: '1:1', placement: { x: 0, y: 0, width: 100 } })
    expect(readingOrder(resolveStrip([low, right, left]))).toEqual([left.id, right.id, low.id])
  })

  it('breaks a tie on the id', () => {
    const a = panel({ aspect: '1:1', placement: { x: 0, y: 0, width: 100 } })
    const b = panel({ aspect: '1:1', placement: { x: 0, y: 0, width: 100 } })
    expect(readingOrder(resolveStrip([b, a]))).toEqual([a.id, b.id])
  })
})

describe('PanelSchema placement', () => {
  it('a panel saved before placements resolves as flow', () => {
    const { placement: _placement, ...legacyPanelJson } = makePanel()
    expect(PanelSchema.parse(legacyPanelJson).placement).toBeNull()
  })
})
