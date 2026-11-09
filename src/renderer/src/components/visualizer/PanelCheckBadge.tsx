import type { Panel } from '@shared/types'

export interface PanelCheckBadgeProps {
  panel: Panel
  /** Leaves out the mark for a passed check, for the strip's cards, where only a problem needs to stand out. */
  problemsOnly?: boolean
}

/**
 * The consistency check of the image a panel shows: "Check failed" with its issues as the tooltip, "Not checked" with
 * the reason when the check could not run (a skipped check counts as a pass, so without this nobody would know), and a
 * muted "Checked" for a pass. Nothing when no check ran: no vision model is assigned, or the image is an edit or an upload.
 */
export function PanelCheckBadge({ panel, problemsOnly = false }: PanelCheckBadgeProps) {
  const check = panel.versions.find((v) => v.id === panel.currentVersionId)?.check ?? null
  if (check === null) return null
  if (check.skipped) {
    return (
      <span className="badge badge-warning panel-check" data-testid="panel-check" data-check="skipped" title={check.issues.join('\n') || 'The check did not run'}>
        Not checked
      </span>
    )
  }
  if (!check.passed) {
    return (
      <span className="badge badge-failed panel-check" data-testid="panel-check" data-check="failed" title={check.issues.join('\n') || 'no issues named'}>
        Check failed
      </span>
    )
  }
  if (problemsOnly) return null
  return (
    <span className="panel-check panel-check-passed" data-testid="panel-check" data-check="passed">
      Checked
    </span>
  )
}
