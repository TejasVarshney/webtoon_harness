import type { Panel } from '@shared/types'
import { PanelCard } from './PanelCard'
import { layoutStrip, rowShares, type StripRow } from '@shared/strip-layout'

export interface WebtoonStripProps {
  /** The episode's panels in strip order. */
  panels: Panel[]
  /** Whether the dialogue is drawn over the art. Default true. */
  lettering?: boolean
  /** The rows to draw instead of `layoutStrip(panels)` (export passes `exportRows`). `panels` stays the full list. */
  rows?: StripRow[]
}

/**
 * The episode drawn as rows (see strip-layout.ts) for the export image: each row and the gap after it on the row's
 * gutter colour, the panels with their picture and lettering only. The screen draws the strip as `StripCanvas`; this
 * stays until the export does too.
 */
export function WebtoonStrip({ panels, lettering = true, rows: given }: WebtoonStripProps) {
  const rows = given ?? layoutStrip(panels)
  return (
    <div className="webtoon-strip">
      {rows.map((row) => {
        const shares = rowShares(row.panels)
        return (
          <div key={row.panels[0].id} className="strip-band" data-gutter={row.gutter}>
            <div className="strip-row" data-row-size={row.panels.length}>
              {row.panels.map((panel) => (
                <PanelCard
                  key={panel.id}
                  panel={panel}
                  selected={false}
                  slant={row.slants[panel.id]}
                  share={shares[panel.id]}
                  mode="export"
                  lettering={lettering}
                  position={panels.findIndex((p) => p.id === panel.id) + 1}
                />
              ))}
            </div>
            <div className="strip-gap" data-gap={row.gapAfter} />
          </div>
        )
      })}
    </div>
  )
}
