import type { Panel } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { InsertPanelButton } from './InsertPanelButton'
import { PanelCard } from './PanelCard'
import { layoutStrip, rowShares } from './strip-layout'

export interface WebtoonStripProps {
  episodeId: string
  /** The episode's panels in strip order. */
  panels: Panel[]
}

/**
 * The episode as one vertical strip: its panels in rows (see strip-layout.ts), each row and the gap after it on the
 * row's gutter colour, a "+" in the gap between two rows and one at the end. Panels of one row have no "+" between them.
 *
 * The end "+" is a single element of its own, in the same place whether the episode is empty or not. A "+" owns the
 * editor it opens, and creating a panel re-renders the strip with that panel in it: if the "+" were rebuilt by that
 * re-render (as it would be if it lived inside the per-row bands, or beside an empty-state paragraph), the dialog
 * that just made the panel would unmount before it could show what came back. It appends, so it never names a panel.
 */
export function WebtoonStrip({ episodeId, panels }: WebtoonStripProps) {
  const selectedPanelId = useAppStore((s) => s.selectedPanelId)
  const rows = layoutStrip(panels)
  return (
    <div className="webtoon-strip">
      {panels.length === 0 && <p className="placeholder">No panels yet. Add one, or ask the agent to draw it.</p>}
      {rows.map((row, i) => {
        const shares = rowShares(row.panels)
        return (
          <div key={row.panels[0].id} className="strip-band" data-gutter={row.gutter}>
            <div className="strip-row" data-row-size={row.panels.length}>
              {row.panels.map((panel) => (
                <PanelCard key={panel.id} panel={panel} selected={panel.id === selectedPanelId} slant={row.slants[panel.id]} share={shares[panel.id]} />
              ))}
            </div>
            {/* The last row's "+" is the end one, below. */}
            <div className="strip-gap" data-gap={row.gapAfter}>
              {i < rows.length - 1 && <InsertPanelButton episodeId={episodeId} afterPanelId={row.panels[row.panels.length - 1].id} />}
            </div>
          </div>
        )
      })}
      <InsertPanelButton key="append" episodeId={episodeId} />
    </div>
  )
}
