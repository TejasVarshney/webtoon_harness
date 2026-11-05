import { describe, expect, it } from 'vitest'
import type { DialogueLine } from '@shared/types'
import { appendLine, editLine, removeLine, toDrafts } from './dialogue-edits'

const lines: DialogueLine[] = [
  { id: 'dlg_0000000001', speakerId: 'chr_0000000001', kind: 'speech', text: 'Run!', placement: { x: 0.2, y: 0.3 } },
  { id: 'dlg_0000000002', speakerId: null, kind: 'narration', text: 'Night fell.', placement: null },
  { id: 'dlg_0000000003', speakerId: null, kind: 'sfx', text: 'BOOM', placement: { x: 0.5, y: 0.8 } }
]

const identity = (line: DialogueLine) => ({ speakerId: line.speakerId, kind: line.kind, text: line.text })

describe('toDrafts', () => {
  it('drops the ids and keeps the placements', () => {
    expect(toDrafts(lines)).toEqual([
      { speakerId: 'chr_0000000001', kind: 'speech', text: 'Run!', placement: { x: 0.2, y: 0.3 } },
      { speakerId: null, kind: 'narration', text: 'Night fell.', placement: null },
      { speakerId: null, kind: 'sfx', text: 'BOOM', placement: { x: 0.5, y: 0.8 } }
    ])
  })
})

describe('editLine', () => {
  it('changes the one line and keeps the others, placements included', () => {
    const next = editLine(lines, 1, identity(lines[1]), { placement: { x: 0.6, y: 0.4 } })
    expect(next).toEqual([toDrafts(lines)[0], { speakerId: null, kind: 'narration', text: 'Night fell.', placement: { x: 0.6, y: 0.4 } }, toDrafts(lines)[2]])
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

  it('returns null when the line at the index changed', () => {
    expect(removeLine(lines, 1, identity(lines[0]))).toBeNull()
  })
})

describe('appendLine', () => {
  it('adds the line at the end', () => {
    const line = { speakerId: null, kind: 'narration' as const, text: 'Later.', placement: { x: 0.5, y: 0.5 } }
    expect(appendLine(lines, line)).toEqual([...toDrafts(lines), line])
  })
})
