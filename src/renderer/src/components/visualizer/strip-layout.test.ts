import { describe, expect, it } from 'vitest'
import type { Panel } from '@shared/types'
import { panel } from '../../test/panel-fixtures'
import { aspectRatio, layoutStrip, rowShares } from '@shared/strip-layout'

const p = (id: string, o: Partial<Panel> = {}): Panel => panel({ id, ...o })
const ids = (rows: ReturnType<typeof layoutStrip>): string[][] => rows.map((r) => r.panels.map((x) => x.id))

describe('layoutStrip', () => {
  it('lays out no panels as no rows', () => {
    expect(layoutStrip([])).toEqual([])
  })

  it('gives each default panel its own row, with the default gap and gutter', () => {
    const rows = layoutStrip([p('a'), p('b'), p('c')])
    expect(ids(rows)).toEqual([['a'], ['b'], ['c']])
    for (const row of rows) {
      expect(row.gapAfter).toBe('normal')
      expect(row.gutter).toBe('white')
    }
  })

  it('puts a panel marked beside in the row of the panel before it', () => {
    expect(ids(layoutStrip([p('a'), p('b', { beside: true }), p('c', { beside: true })]))).toEqual([['a', 'b', 'c']])
  })

  it('starts a new row after three panels', () => {
    const rows = layoutStrip([p('a'), p('b', { beside: true }), p('c', { beside: true }), p('d', { beside: true })])
    expect(ids(rows)).toEqual([['a', 'b', 'c'], ['d']])
  })

  it('gives a first panel marked beside its own row', () => {
    expect(ids(layoutStrip([p('a', { beside: true }), p('b')]))).toEqual([['a'], ['b']])
  })

  it('takes the gap and gutter of a row from its last panel', () => {
    const rows = layoutStrip([p('a', { gutter: 'black', gapAfter: 'long' }), p('b', { beside: true, gutter: 'white', gapAfter: 'tight' })])
    expect(rows).toHaveLength(1)
    expect(rows[0].gutter).toBe('white')
    expect(rows[0].gapAfter).toBe('tight')
  })

  it('alternates the lean of slanted panels along the strip', () => {
    const rows = layoutStrip([p('a', { frame: 'slanted' }), p('b'), p('c', { frame: 'slanted' }), p('d', { frame: 'slanted', beside: true })])
    expect(rows[0].slants).toEqual({ a: 'left' })
    expect(rows[1].slants).toEqual({})
    expect(rows[2].slants).toEqual({ c: 'right', d: 'left' })
  })

  it("uses a panel's own cut, and keeps the alternation going around it", () => {
    const rows = layoutStrip([p('a', { frame: 'slanted' }), p('b', { frame: 'slanted', cut: 'top-down' }), p('c', { frame: 'slanted' }), p('d', { cut: 'top-up' })])
    expect(rows.map((r) => r.slants)).toEqual([{ a: 'left' }, { b: 'top-down' }, { c: 'left' }, {}])
  })

  it('gives a slanted tall panel no lean and does not advance the alternation', () => {
    const rows = layoutStrip([p('a', { frame: 'slanted', aspect: '1:3' }), p('b', { frame: 'slanted' }), p('c', { frame: 'slanted' })])
    expect(rows[0].slants).toEqual({})
    expect(rows[1].slants).toEqual({ b: 'left' })
    expect(rows[2].slants).toEqual({ c: 'right' })
  })
})

describe('aspectRatio', () => {
  it('is width over height', () => {
    expect(aspectRatio('2:3')).toBeCloseTo(2 / 3)
    expect(aspectRatio('16:9')).toBeCloseTo(16 / 9)
    expect(aspectRatio('1:3')).toBeCloseTo(1 / 3)
  })
})

describe('rowShares', () => {
  it('gives a lone panel the whole row', () => {
    expect(rowShares([p('a')])).toEqual({ a: 1 })
  })

  it('splits the row by aspect ratio', () => {
    const shares = rowShares([p('a', { aspect: '2:3' }), p('b', { aspect: '16:9' })])
    expect(shares.a).toBeCloseTo(2 / 3 / (2 / 3 + 16 / 9))
    expect(shares.b).toBeCloseTo(16 / 9 / (2 / 3 + 16 / 9))
  })

  it('gives three equal panels a third each', () => {
    const shares = rowShares([p('a'), p('b'), p('c')])
    for (const id of ['a', 'b', 'c']) expect(shares[id]).toBeCloseTo(1 / 3)
  })
})
