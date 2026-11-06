import type { DialogueLine } from '@shared/types'

// Dialogue patches for the editing mode. Each is built from the panel's lines as the store has them when the save is
// sent, and sends the whole array: line ids change on every dialogue save, so a line is found by its index, and
// checked by what it says. Pure: no React, so the rules are easy to test.

/** A dialogue line before it is stored; the server gives it its id. */
export type DialogueDraftLine = Omit<DialogueLine, 'id'>

/** What a line said when an edit of it began. If the line at its index says anything else now, the edit is not sent. */
export type LineIdentity = Pick<DialogueLine, 'speakerId' | 'kind' | 'text'>

export function identityOf(line: DialogueLine): LineIdentity {
  return { speakerId: line.speakerId, kind: line.kind, text: line.text }
}

/** The lines as a patch sends them: without their ids, and each with its placement, style and tail, so none falls back to inheriting. */
export function toDrafts(lines: DialogueLine[]): DialogueDraftLine[] {
  return lines.map(({ speakerId, kind, text, placement, style, tail }) => ({ speakerId, kind, text, placement, style, tail }))
}

function matches(line: DialogueLine | undefined, expect: LineIdentity): boolean {
  return line !== undefined && line.speakerId === expect.speakerId && line.kind === expect.kind && line.text === expect.text
}

/** Changes line `index`; `null` when it is gone or no longer what `expect` says. */
export function editLine(current: DialogueLine[], index: number, expect: LineIdentity, change: Partial<DialogueDraftLine>): DialogueDraftLine[] | null {
  if (!matches(current[index], expect)) return null
  return toDrafts(current).map((line, i) => (i === index ? { ...line, ...change } : line))
}

/** Drops line `index`; `null` when it is gone or no longer what `expect` says. */
export function removeLine(current: DialogueLine[], index: number, expect: LineIdentity): DialogueDraftLine[] | null {
  if (!matches(current[index], expect)) return null
  return toDrafts(current).filter((_, i) => i !== index)
}

/** Adds a line after the others: the reading order's last. */
export function appendLine(current: DialogueLine[], line: DialogueDraftLine): DialogueDraftLine[] {
  return [...toDrafts(current), line]
}
