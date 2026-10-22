import { describe, expect, it } from 'vitest'
import { readyVersions, stepReadyVersion, versionLabel, versionPosition } from './panel-versions'
import type { PanelVersion } from './types'

const version = (id: string, status: PanelVersion['status']): PanelVersion => ({
  id,
  source: 'generate',
  status,
  error: status === 'failed' ? 'boom' : null,
  imagePath: status === 'ready' ? `panels/pnl_0000000001/${id}.png` : null,
  prompt: '',
  referenceImagePaths: [],
  instruction: null,
  parentVersionId: null,
  check: null,
  createdAt: '2026-01-01T00:00:00.000Z'
})

// ready: 1, failed, pending, ready: 4, ready: 5
const panel = {
  versions: [version('ver_1', 'ready'), version('ver_2', 'failed'), version('ver_3', 'pending'), version('ver_4', 'ready'), version('ver_5', 'ready')]
}

describe('versionPosition (Ruling P7)', () => {
  it('counts ready versions only: failed and pending attempts never use up a number', () => {
    expect(versionPosition(panel, 'ver_1')).toEqual({ label: 'v1', index: 1, readyCount: 3 })
    expect(versionPosition(panel, 'ver_4')).toEqual({ label: 'v2', index: 2, readyCount: 3 })
    expect(versionPosition(panel, 'ver_5')).toEqual({ label: 'v3', index: 3, readyCount: 3 })
  })

  it('has no position for a version that is not ready, does not exist, or is absent', () => {
    expect(versionPosition(panel, 'ver_2')).toBeNull()
    expect(versionPosition(panel, 'ver_3')).toBeNull()
    expect(versionPosition(panel, 'ver_ffffffffff')).toBeNull()
    expect(versionPosition(panel, null)).toBeNull()
    expect(versionPosition({ versions: [] }, 'ver_1')).toBeNull()
  })
})

describe('versionLabel', () => {
  it('is vN for a ready version and null otherwise', () => {
    expect(versionLabel(panel, 'ver_1')).toBe('v1')
    expect(versionLabel(panel, 'ver_5')).toBe('v3')
    expect(versionLabel(panel, 'ver_2')).toBeNull()
    expect(versionLabel(panel, null)).toBeNull()
  })
})

describe('readyVersions', () => {
  it('lists the ready versions in history order', () => {
    expect(readyVersions(panel).map((v) => v.id)).toEqual(['ver_1', 'ver_4', 'ver_5'])
    expect(readyVersions({ versions: [version('ver_2', 'failed')] })).toEqual([])
  })
})

describe('stepReadyVersion', () => {
  it('moves to the previous or next ready version, skipping the ones that are not ready', () => {
    expect(stepReadyVersion(panel, 'ver_4', -1)?.id).toBe('ver_1')
    expect(stepReadyVersion(panel, 'ver_4', 1)?.id).toBe('ver_5')
    expect(stepReadyVersion(panel, 'ver_1', 1)?.id).toBe('ver_4')
  })

  it('stops at either end, and from a version that has no position', () => {
    expect(stepReadyVersion(panel, 'ver_1', -1)).toBeNull()
    expect(stepReadyVersion(panel, 'ver_5', 1)).toBeNull()
    expect(stepReadyVersion(panel, 'ver_2', 1)).toBeNull()
    expect(stepReadyVersion(panel, null, 1)).toBeNull()
  })
})
