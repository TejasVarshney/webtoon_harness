import { describe, expect, it } from 'vitest'
import type { Panel } from '@shared/types'
import { panel, panelVersion } from '../../test/panel-fixtures'
import { aspectRatio, exportRows, layoutStrip, rowShares } from '@shared/strip-layout'

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

  it('gives a slanted tall panel no lean and does not advance the alternation', () => {
    const rows = layoutStrip([p('a', { frame: 'slanted', aspect: '1:3' }), p('b', { frame: 'slanted' }), p('c', { frame: 'slanted' })])
    expect(rows[0].slants).toEqual({})
    expect(rows[1].slants).toEqual({ b: 'left' })
    expect(rows[2].slants).toEqual({ c: 'right' })
  })
})

const finished = (id: string, o: Partial<Panel> = {}): Panel =>
  p(id, { versions: [panelVersion({ id: 'v_' + id, status: 'ready' })], currentVersionId: 'v_' + id, ...o })
const unfinished = (id: string, o: Partial<Panel> = {}): Panel => p(id, { versions: [], currentVersionId: null, ...o })

describe('exportRows', () => {
  it('keeps a beside panel in its own row when its row-starter is unfinished', () => {
    const rows = exportRows([finished('a'), unfinished('b'), finished('c', { beside: true }), finished('d')])
    expect(ids(rows)).toEqual([['a'], ['c'], ['d']])
  })

  it('drops a row left empty', () => {
    expect(ids(exportRows([finished('a'), unfinished('b'), finished('c')]))).toEqual([['a'], ['c']])
  })

  it("takes gapAfter and gutter from the row's new last panel", () => {
    const rows = exportRows([
      finished('a', { gutter: 'white', gapAfter: 'long' }),
      unfinished('b', { beside: true, gutter: 'black', gapAfter: 'tight' })
    ])
    expect(ids(rows)).toEqual([['a']])
    expect(rows[0].gutter).toBe('white')
    expect(rows[0].gapAfter).toBe('long')
  })

  it('keeps the slant the full layout gave', () => {
    const rows = exportRows([unfinished('a', { frame: 'slanted' }), finished('b', { frame: 'slanted' })])
    expect(rows[0].slants).toEqual({ b: 'right' })
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
