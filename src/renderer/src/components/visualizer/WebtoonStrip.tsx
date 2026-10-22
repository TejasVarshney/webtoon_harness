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

/** The episode as one vertical strip: a card per panel, with a "+" after each (between two panels, and at the end). */
export function WebtoonStrip({ episodeId, panels }: WebtoonStripProps) {
  const selectedPanelId = useAppStore((s) => s.selectedPanelId)
  if (panels.length === 0) {
    return (
      <div className="webtoon-strip">
        <p className="placeholder">No panels yet. Add one, or ask the agent to draw it.</p>
        <InsertPanelButton episodeId={episodeId} />
      </div>
    )
  }
  return (
    <div className="webtoon-strip">
      {panels.map((panel, i) => (
        <Fragment key={panel.id}>
          <PanelCard panel={panel} selected={panel.id === selectedPanelId} />
          {/* The last "+" appends rather than naming a panel, so it stays right if the strip changes under it. */}
          <InsertPanelButton episodeId={episodeId} afterPanelId={i === panels.length - 1 ? undefined : panel.id} />
        </Fragment>
      ))}
    </div>
  )
}
