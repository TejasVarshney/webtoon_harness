import type { CheckResult } from '@shared/types'

/**
 * What a studio tile shows for its sheet's appearance-lock check: a red badge with the issues for a failed
 * sheet, a muted mark for a passed one, nothing for an unchecked or skipped one. The renderer cannot import the
 * main process's `sheetCheckState`, so the two conditions are spelled out here.
 */
export function SheetCheckBadge({ check }: { check: CheckResult | null }) {
  if (check === null || check.skipped) return null
  if (check.passed) {
    return (
      <span className="sheet-check-passed" data-testid="sheet-check-passed">
        Checked
      </span>
    )
  }
  return (
    <div className="sheet-check-failed">
      <span className="badge badge-failed" data-testid="sheet-check-failed" title={check.issues.length > 0 ? check.issues.join('\n') : 'no issues named'}>
        Check failed
      </span>
      {check.issues.length > 0 && (
        <ul className="error sheet-check-issues">
          {check.issues.map((issue, i) => (
            <li key={i}>{issue}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
