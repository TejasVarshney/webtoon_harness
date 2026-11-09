import { describe, expect, it } from 'vitest'
import { mergeGroups, mergeKey, type MergeBox } from './bubble-merge'

const box = (index: number, left: number, top = 0, key: string | null = 'a', width = 10, height = 10): MergeBox => ({ index, key, left, top, width, height })

describe('mergeGroups', () => {
  it('groups overlapping boxes with the same key', () => {
    expect(mergeGroups([box(0, 0), box(1, 5)])).toEqual([[0, 1]])
  })

  it('does not count touching edges', () => {
    expect(mergeGroups([box(0, 0), box(1, 10)])).toEqual([])
  })

  it('needs an overlap on both axes', () => {
    expect(mergeGroups([box(0, 0, 0), box(1, 5, 20)])).toEqual([])
  })

  it('chains through a shared neighbour', () => {
    expect(mergeGroups([box(2, 16), box(0, 0), box(1, 8)])).toEqual([[0, 1, 2]])
  })

  it('keeps separate groups in the order of their first line', () => {
    expect(mergeGroups([box(3, 100), box(2, 105), box(0, 0), box(1, 5)])).toEqual([
      [0, 1],
      [2, 3]
    ])
  })

  it('keeps different keys apart', () => {
    expect(mergeGroups([box(0, 0, 0, 'a'), box(1, 5, 0, 'b')])).toEqual([])
  })

  it('leaves out a box with no key', () => {
    expect(mergeGroups([box(0, 0, 0, null), box(1, 5, 0, null)])).toEqual([])
  })

  it('ignores empty boxes, as jsdom gives', () => {
    expect(mergeGroups([box(0, 0, 0, 'a', 0, 0), box(1, 0, 0, 'a', 0, 0)])).toEqual([])
  })
})

describe('mergeKey', () => {
  it('resolves the key through the defaults', () => {
    expect(mergeKey('speech', null)).toBe(mergeKey('speech', { fill: '#ffffff', stroke: '#111111', strokeWidth: 2 }))
  })

  it('separates shapes and colours', () => {
    expect(mergeKey('speech', null)).not.toBe(mergeKey('whisper', null))
    expect(mergeKey('speech', null)).not.toBe(mergeKey('speech', { fill: '#ff0000' }))
    expect(mergeKey('speech', null)).not.toBe(mergeKey('speech', { stroke: '#ff0000' }))
    expect(mergeKey('speech', null)).not.toBe(mergeKey('speech', { strokeWidth: 3 }))
  })

  it('ignores what does not change the outline', () => {
    expect(mergeKey('speech', null)).toBe(mergeKey('speech', { font: 'serif', size: 2, padding: 1.5, width: 0.5 }))
  })

  it('has no key for a shape that does not merge', () => {
    expect(mergeKey('caption', null)).toBeNull()
    expect(mergeKey('sfx', null)).toBeNull()
    for (const shape of ['fringe', 'burst', 'curly'] as const) expect(mergeKey(shape, null)).toBeNull()
  })
})
