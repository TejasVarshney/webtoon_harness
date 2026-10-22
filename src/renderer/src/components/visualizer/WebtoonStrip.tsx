import { Fragment } from 'react'
import type { Panel } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { InsertPanelButton } from './InsertPanelButton'
import { PanelCard } from './PanelCard'

export interface WebtoonStripProps {
  episodeId: string
  /** The episode's panels in strip order. */
  panels: Panel[]
}

/**
 * The episode as one vertical strip: a card per panel, with a "+" between two panels and one at the end.
 *
 * The end "+" is a single element of its own, in the same place whether the episode is empty or not. A "+" owns the
 * editor it opens, and creating a panel re-renders the strip with that panel in it: if the "+" were rebuilt by that
 * re-render (as it would be if it lived inside the per-panel fragments, or beside an empty-state paragraph), the dialog
 * that just made the panel would unmount before it could show what came back. It appends, so it never names a panel.
 */
export function WebtoonStrip({ episodeId, panels }: WebtoonStripProps) {
  const selectedPanelId = useAppStore((s) => s.selectedPanelId)
  return (
    <div className="webtoon-strip">
      {panels.length === 0 && <p className="placeholder">No panels yet. Add one, or ask the agent to draw it.</p>}
      {panels.map((panel, i) => (
        <Fragment key={panel.id}>
          <PanelCard panel={panel} selected={panel.id === selectedPanelId} />
          {i < panels.length - 1 && <InsertPanelButton episodeId={episodeId} afterPanelId={panel.id} />}
        </Fragment>
      ))}
      <InsertPanelButton key="append" episodeId={episodeId} />
    </div>
  )
}
