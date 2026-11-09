import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CheckResult } from '@shared/types'
import { initialAppState, useAppStore } from '../../stores/app-store'
import { initialPanelsState, usePanelsStore } from '../../stores/panels-store'
import { PROJECT_ID as projectId } from '../../test/character-fixtures'
import { installFakeApi } from '../../test/fake-api'
import { EPISODE_ID, panel, panelVersion } from '../../test/panel-fixtures'
import { PanelCard } from './PanelCard'
import { PanelCheckBadge } from './PanelCheckBadge'

const checked = (check: CheckResult | null) => {
  const version = panelVersion({ check })
  return panel({ versions: [version], currentVersionId: version.id })
}

const skipped: CheckResult = { passed: true, issues: ['Consistency check failed to run: 402 Insufficient Balance'], skipped: true }
const failed: CheckResult = { passed: false, issues: ['Mina hair is brown', 'The door is on the right'], skipped: false }
const passed: CheckResult = { passed: true, issues: [], skipped: false }

beforeEach(() => {
  installFakeApi({})
  useAppStore.setState({ ...initialAppState, projectId, activeEpisodeId: EPISODE_ID })
  usePanelsStore.setState({ ...initialPanelsState, projectId })
})

describe('PanelCheckBadge', () => {
  it('says a skipped check did not check the image, with the reason as its tooltip', () => {
    render(<PanelCheckBadge panel={checked(skipped)} />)
    const badge = screen.getByTestId('panel-check')
    expect(badge).toHaveTextContent('Not checked')
    expect(badge).toHaveAttribute('data-check', 'skipped')
    expect(badge).toHaveAttribute('title', 'Consistency check failed to run: 402 Insufficient Balance')
  })

  it('shows a failed check with its issues, and a pass as a muted mark', () => {
    const { rerender } = render(<PanelCheckBadge panel={checked(failed)} />)
    expect(screen.getByTestId('panel-check')).toHaveTextContent('Check failed')
    expect(screen.getByTestId('panel-check')).toHaveAttribute('title', 'Mina hair is brown\nThe door is on the right')
    rerender(<PanelCheckBadge panel={checked(passed)} />)
    expect(screen.getByTestId('panel-check')).toHaveTextContent('Checked')
  })

  it('shows nothing when no check ran, and no pass when only problems are asked for', () => {
    const { rerender } = render(<PanelCheckBadge panel={checked(null)} />)
    expect(screen.queryByTestId('panel-check')).toBeNull()
    rerender(<PanelCheckBadge panel={checked(passed)} problemsOnly />)
    expect(screen.queryByTestId('panel-check')).toBeNull()
  })

  it('judges the version the panel shows, not the newest attempt', () => {
    const shown = panelVersion({ id: 'ver_0000000001', check: passed })
    const newer = panelVersion({ id: 'ver_0000000002', check: skipped })
    render(<PanelCheckBadge panel={panel({ versions: [shown, newer], currentVersionId: shown.id })} />)
    expect(screen.getByTestId('panel-check')).toHaveTextContent('Checked')
  })
})

describe('PanelCard check badge', () => {
  it('marks an unchecked panel on the strip, but never in an export', () => {
    const p = checked(skipped)
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [p] } })
    const { unmount } = render(<PanelCard panel={p} selected={false} />)
    expect(screen.getByTestId('panel-check')).toHaveTextContent('Not checked')
    unmount()
    render(<PanelCard panel={p} selected={false} mode="export" />)
    expect(screen.queryByTestId('panel-check')).toBeNull()
  })

  it('leaves a passed panel unmarked on the strip', () => {
    const p = checked(passed)
    usePanelsStore.setState({ panelsByEpisode: { [EPISODE_ID]: [p] } })
    render(<PanelCard panel={p} selected={false} />)
    expect(screen.queryByTestId('panel-check')).toBeNull()
  })
})
