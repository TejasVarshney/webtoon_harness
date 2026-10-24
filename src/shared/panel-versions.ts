// How a panel's image history is numbered for people (Ruling P7). Shared by the main process (tool
// results, `<panel_context>`) and the renderer (the version switcher), so both always agree.
// Pure and type-only imports: no Node modules, no zod.

import type { Panel, PanelVersion } from './types'

type HasVersions = Pick<Panel, 'versions'>

export interface VersionPosition {
  /** `v<index>`. */
  label: string
  /** 1-based position among the panel's ready versions: the N in "vN of M". */
  index: number
  /** How many ready versions the panel has: the M in "vN of M". */
  readyCount: number
}

/** The ready versions in history order. Failed and pending attempts are left out: they have no number. */
export function readyVersions(panel: HasVersions): PanelVersion[] {
  return panel.versions.filter((v) => v.status === 'ready')
}

/** Where a version stands among the ready ones, or null when it is not ready, not the panel's, or `versionId` is null. */
export function versionPosition(panel: HasVersions, versionId: string | null): VersionPosition | null {
  if (versionId === null) return null
  const ready = readyVersions(panel)
  const at = ready.findIndex((v) => v.id === versionId)
  return at === -1 ? null : { label: `v${at + 1}`, index: at + 1, readyCount: ready.length }
}

/** `vN` for a ready version, null for anything else (its status says why). */
export function versionLabel(panel: HasVersions, versionId: string | null): string | null {
  return versionPosition(panel, versionId)?.label ?? null
}

/** The ready version `delta` places from `versionId` (-1 previous, 1 next), or null at either end or when `versionId` has no position. */
export function stepReadyVersion(panel: HasVersions, versionId: string | null, delta: number): PanelVersion | null {
  const position = versionPosition(panel, versionId)
  return position === null ? null : (readyVersions(panel)[position.index - 1 + delta] ?? null)
}
