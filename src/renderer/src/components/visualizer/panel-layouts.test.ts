import { describe, expect, it } from 'vitest'
import { resolveStrip } from '@shared/strip-canvas'
import type { Panel, PanelAspect, PanelPlacement } from '@shared/types'
import { panel } from '../../test/panel-fixtures'
import { alignedX, applyLayout, layoutBlock, PANEL_LAYOUTS } from './panel-layouts'

const layout = (id: string) => PANEL_LAYOUTS.find((l) => l.id === id)!
const id = (n: number): string => `pnl_000000000${n}`
const at = (n: number, placement: PanelPlacement, aspect: PanelAspect = '1:1'): Panel => panel({ id: id(n), aspect, placement })

describe('panel layouts', () => {
  // Three squares down the strip, 200 wide, 50 apart, and a fourth 100 below them.
  const strip = (): Panel[] => [at(1, { x: 0, y: 0, width: 200 }), at(2, { x: 0, y: 250, width: 200 }), at(3, { x: 0, y: 500, width: 200 }), at(4, { x: 100, y: 800, width: 200 })]

  it('arranges two across from the panel, and moves the rest up by what the block lost, keeping their gap', () => {
    const moves = applyLayout(resolveStrip(strip()), id(1), layout('two-across'))!
    // Halves of 217 squares from the top: the block now ends at 217 where it ended at 450, so 3 and 4 move up by 233.
    expect(moves).toEqual([
      { panelId: id(1), placement: { x: 0, y: 0, width: 217 } },
      { panelId: id(2), placement: { x: 223, y: 0, width: 217 } },
      { panelId: id(3), placement: { x: 0, y: 267, width: 200 } },
      { panelId: id(4), placement: { x: 100, y: 567, width: 200 } }
    ])
  })

  it('lays a wide panel over two, the row below the wide one', () => {
    const moves = applyLayout(resolveStrip(strip()), id(1), layout('wide-two'))!
    expect(moves.slice(0, 3)).toEqual([
      { panelId: id(1), placement: { x: 0, y: 0, width: 440 } },
      { panelId: id(2), placement: { x: 0, y: 446, width: 217 } },
      { panelId: id(3), placement: { x: 223, y: 446, width: 217 } }
    ])
    // The block ends at 663 where it ended at 700, and 4 keeps its 100 below.
    expect(moves[3]).toEqual({ panelId: id(4), placement: { x: 100, y: 763, width: 200 } })
  })

  it('stacks two beside a big one, under each other by their own heights', () => {
    const panels = [at(1, { x: 0, y: 0, width: 200 }), at(2, { x: 0, y: 250, width: 200 }, '4:3'), at(3, { x: 0, y: 500, width: 200 })]
    const moves = applyLayout(resolveStrip(panels), id(1), layout('side-stack'))!
    expect(moves).toEqual([
      { panelId: id(1), placement: { x: 0, y: 0, width: 291 } },
      { panelId: id(2), placement: { x: 297, y: 0, width: 143 } },
      // 142.67 wide at 4:3 is 107 high, then the gap.
      { panelId: id(3), placement: { x: 297, y: 113, width: 143 } }
    ])
  })

  it('staggers two, the second against the right edge', () => {
    const moves = applyLayout(resolveStrip(strip()), id(2), layout('stagger'))!
    expect(moves.slice(0, 2)).toEqual([
      { panelId: id(2), placement: { x: 0, y: 250, width: 291 } },
      { panelId: id(3), placement: { x: 149, y: 565, width: 291 } }
    ])
  })

  it('leaves the panels above alone, and starts from the panel in reading order', () => {
    const moves = applyLayout(resolveStrip(strip()), id(3), layout('full'))!
    expect(moves.map((m) => m.panelId)).toEqual([id(3), id(4)])
    expect(moves[0]).toEqual({ panelId: id(3), placement: { x: 0, y: 500, width: 440 } })
  })

  it('moves a panel that sat beside the block below it', () => {
    const panels = [at(1, { x: 0, y: 0, width: 200 }), at(2, { x: 240, y: 0, width: 200 })]
    const moves = applyLayout(resolveStrip(panels), id(1), layout('full'))!
    expect(moves).toEqual([
      { panelId: id(1), placement: { x: 0, y: 0, width: 440 } },
      { panelId: id(2), placement: { x: 240, y: 448, width: 200 } }
    ])
  })

  it('needs enough panels after this one', () => {
    const placed = resolveStrip(strip())
    expect(layoutBlock(placed, id(3), layout('three-across'))).toBeNull()
    expect(applyLayout(placed, id(3), layout('three-across'))).toBeNull()
    expect(layoutBlock(placed, id(2), layout('three-across'))?.map((p) => p.panel.id)).toEqual([id(2), id(3), id(4)])
  })

  it('every layout places as many panels as it counts, inside the strip, and draws a box for each', () => {
    const placed = resolveStrip(strip())
    for (const l of PANEL_LAYOUTS) {
      const moves = applyLayout(placed, id(1), l)!
      expect(l.cells, l.id).toHaveLength(l.count)
      for (const m of moves.slice(0, l.count)) {
        expect(m.placement.x, l.id).toBeGreaterThanOrEqual(0)
        expect(m.placement.x + m.placement.width, l.id).toBeLessThanOrEqual(440)
      }
    }
  })

  it('aligns a panel left, centre or right', () => {
    expect([alignedX(200, 'left'), alignedX(200, 'centre'), alignedX(200, 'right')]).toEqual([0, 120, 240])
  })
})
