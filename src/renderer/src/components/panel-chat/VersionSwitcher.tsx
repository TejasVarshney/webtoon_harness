import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { stepReadyVersion, versionPosition } from '@shared/panel-versions'
import type { Panel } from '@shared/types'
import { cleanIpcError } from '../../api'
import { usePanelsStore } from '../../stores/panels-store'

export interface VersionSwitcherProps {
  panel: Panel
}

/**
 * `‹ vN / M ›` for a panel's image history. Only ready versions are numbered (Ruling P7), so a failed or pending
 * attempt is skipped over, and the buttons revert to the neighboring ready version. No version is ever deleted.
 */
export function VersionSwitcher({ panel }: VersionSwitcherProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const position = versionPosition(panel, panel.currentVersionId)
  const previous = stepReadyVersion(panel, panel.currentVersionId, -1)
  const next = stepReadyVersion(panel, panel.currentVersionId, 1)

  function revertTo(versionId: string): void {
    if (busy) return
    setBusy(true)
    setError(null)
    usePanelsStore
      .getState()
      .revertPanel(panel.id, versionId)
      .then(
        () => setBusy(false),
        (e: unknown) => {
          setError(cleanIpcError(e).message)
          setBusy(false)
        }
      )
  }

  return (
    <div className="version-switcher" role="group" aria-label="Image versions">
      <button
        type="button"
        data-testid="version-prev"
        aria-label="Previous version"
        disabled={busy || previous === null}
        className="icon-button"
        onClick={() => previous !== null && revertTo(previous.id)}
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </button>
      <span className="version-label" data-testid="panel-version-label">
        {position === null ? 'No image yet' : `${position.label} / ${position.readyCount}`}
      </span>
      <button
        type="button"
        data-testid="version-next"
        aria-label="Next version"
        disabled={busy || next === null}
        className="icon-button"
        onClick={() => next !== null && revertTo(next.id)}
      >
        <ChevronRight size={16} aria-hidden="true" />
      </button>
      {error !== null && (
        <p role="alert" className="error version-error">
          {error}
        </p>
      )}
    </div>
  )
}
