import { describe, expect, it } from 'vitest'
import { makePanel } from '../main/test/factories'
import { isFinished, unfinishedReason } from './export-status'

const version = (id: string, status: 'pending' | 'ready' | 'failed') => ({
  id,
  source: 'generate' as const,
  status,
  error: status === 'failed' ? 'boom' : null,
  imagePath: status === 'ready' ? `panels/pnl_0000000001/${id}.png` : null,
  prompt: 'prompt',
  referenceImagePaths: [],
  instruction: null,
  parentVersionId: null,
  drawnFrom: null,
  check: null,
  createdAt: '2026-01-01T00:00:00.000Z'
})

describe('isFinished', () => {
  it('is true for a ready current version even when the newest attempt failed', () => {
    const panel = makePanel({ versions: [version('v1', 'ready'), version('v2', 'failed')], currentVersionId: 'v1' })
    expect(isFinished(panel)).toBe(true)
    expect(unfinishedReason(panel)).toBeNull()
  })

  it('is false with no current version', () => {
    expect(isFinished(makePanel({ versions: [version('v1', 'ready')], currentVersionId: null }))).toBe(false)
  })
})

describe('unfinishedReason', () => {
  it('names pending as generating, a failed newest with no current as failed, and no versions as none', () => {
    expect(unfinishedReason(makePanel({ versions: [version('v1', 'pending')], currentVersionId: null }))).toBe('generating')
    expect(unfinishedReason(makePanel({ versions: [version('v1', 'failed')], currentVersionId: null }))).toBe('failed')
    expect(unfinishedReason(makePanel({ versions: [], currentVersionId: null }))).toBe('none')
  })
})
