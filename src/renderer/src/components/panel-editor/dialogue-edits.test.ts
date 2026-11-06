import { describe, expect, it } from 'vitest'
import type { DialogueLine } from '@shared/types'
import { appendLine, editLine, removeLine, toDrafts } from './dialogue-edits'

const lines: DialogueLine[] = [
  { id: 'dlg_0000000001', speakerId: 'chr_0000000001', kind: 'speech', text: 'Run!', placement: { x: 0.2, y: 0.3 }, style: { fill: '#ff0000' }, tail: { x: 0.1, y: 0.9 } },
  { id: 'dlg_0000000002', speakerId: null, kind: 'narration', text: 'Night fell.', placement: null, style: null, tail: null },
  { id: 'dlg_0000000003', speakerId: null, kind: 'sfx', text: 'BOOM', placement: { x: 0.5, y: 0.8 }, style: { shape: 'sfx' }, tail: 'none' }
]

const identity = (line: DialogueLine) => ({ speakerId: line.speakerId, kind: line.kind, text: line.text })

describe('toDrafts', () => {
  it('drops the ids and keeps the placements', () => {
    expect(toDrafts(lines)).toEqual([
      { speakerId: 'chr_0000000001', kind: 'speech', text: 'Run!', placement: { x: 0.2, y: 0.3 }, style: { fill: '#ff0000' }, tail: { x: 0.1, y: 0.9 } },
      { speakerId: null, kind: 'narration', text: 'Night fell.', placement: null, style: null, tail: null },
      { speakerId: null, kind: 'sfx', text: 'BOOM', placement: { x: 0.5, y: 0.8 }, style: { shape: 'sfx' }, tail: 'none' }
    ])
  })

  it("sends every line's look, null included, so none falls back to inheriting", () => {
    const [styled, unstyled] = toDrafts(lines)
    expect(styled).toMatchObject({ style: { fill: '#ff0000' }, tail: { x: 0.1, y: 0.9 } })
    expect(unstyled).toHaveProperty('style', null)
    expect(unstyled).toHaveProperty('tail', null)
  })
})

describe('editLine', () => {
  it('changes the one line and keeps the others, placements included', () => {
    const next = editLine(lines, 1, identity(lines[1]), { placement: { x: 0.6, y: 0.4 } })
    expect(next).toEqual([toDrafts(lines)[0], { speakerId: null, kind: 'narration', text: 'Night fell.', placement: { x: 0.6, y: 0.4 }, style: null, tail: null }, toDrafts(lines)[2]])
  })

  it('returns null when the line at the index no longer has the text it had', () => {
    expect(editLine(lines, 0, { ...identity(lines[0]), text: 'Walk.' }, { text: 'Hide!' })).toBeNull()
  })

  it('returns null when the speaker or kind changed, or the index is gone', () => {
    expect(editLine(lines, 0, { ...identity(lines[0]), speakerId: null }, { text: 'Hide!' })).toBeNull()
    expect(editLine(lines, 0, { ...identity(lines[0]), kind: 'thought' }, { text: 'Hide!' })).toBeNull()
    expect(editLine(lines, 3, identity(lines[0]), { text: 'Hide!' })).toBeNull()
  })
})

describe('removeLine', () => {
  it('drops exactly the index', () => {
    expect(removeLine(lines, 1, identity(lines[1]))).toEqual([toDrafts(lines)[0], toDrafts(lines)[2]])
  })

  it('keeps each look on its own line when a middle line is removed', () => {
    const [a, b, c] = lines.map((line, i) => ({ ...line, style: { fill: ['#aa0000', '#00bb00', '#0000cc'][i] } }))
    expect(removeLine([a, b, c], 1, identity(b))?.map((d) => d.style)).toEqual([a.style, c.style])
  })

  it('returns null when the line at the index changed', () => {
    expect(removeLine(lines, 1, identity(lines[0]))).toBeNull()
  })
})

describe('appendLine', () => {
  it('adds the line at the end', () => {
    const line = { speakerId: null, kind: 'narration' as const, text: 'Later.', placement: { x: 0.5, y: 0.5 }, style: null, tail: null }
    expect(appendLine(lines, line)).toEqual([...toDrafts(lines), line])
  })
})
