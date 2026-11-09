import { useMemo } from 'react'
import { contentBottom, resolveStrip } from '@shared/strip-canvas'
import { STRIP_CSS_WIDTH } from '@shared/strip-width'
import type { Panel } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { AddPanelButton } from './AddPanelButton'
import { PanelCard } from './PanelCard'

/** How far the canvas runs past the lowest panel, so a panel can be dragged further down. */
const TRAILING_SPACE = 1600

export interface StripCanvasProps {
  episodeId: string
  /** The episode's panels in strip order. */
  panels: Panel[]
  /** `export` draws the panels only, ending at the lowest one: no selection, tools or "+". Default `edit`. */
  mode?: 'edit' | 'export'
  /** Whether the dialogue is drawn over the art. Default true. */
  lettering?: boolean
  /** A CSS background for the canvas. Default none, so the pane shows. */
  background?: string
}

/**
 * The episode as free-standing panels on a strip 440px wide (STRIP_CSS_WIDTH), each at the place `resolveStrip` gives
 * it. The canvas is the size container the lettering is measured against, so its text keeps its size at any pane width.
 * A click on empty strip clears the selection; a click on a card selects it (see PanelCard).
 */
export function StripCanvas({ episodeId, panels, mode = 'edit', lettering = true, background }: StripCanvasProps) {
  const selectedIds = useAppStore((s) => s.selectedPanelIds)
  const exporting = mode === 'export'
  const placed = useMemo(() => resolveStrip(panels), [panels])
  const bottom = contentBottom(placed)

  const canvas = (
    <div className="strip-canvas" data-mode={mode} style={{ width: STRIP_CSS_WIDTH, height: exporting ? bottom : bottom + TRAILING_SPACE, ...(background === undefined ? {} : { background }) }}>
      {placed.map((p, i) => (
        <PanelCard
          key={p.panel.id}
          panel={p.panel}
          selected={!exporting && selectedIds.includes(p.panel.id)}
          slant={p.slant}
          share={p.share}
          place={{ x: p.x, y: p.y, width: p.width }}
          mode={mode}
          lettering={lettering}
          position={exporting ? i + 1 : undefined}
        />
      ))}
      {!exporting && (
        <div className="strip-canvas-add" style={{ top: bottom + 24 }}>
          <AddPanelButton episodeId={episodeId} testId="add-panel" className="add-panel-button" />
        </div>
      )}
    </div>
  )
  if (exporting) return canvas

  return (
    // Clicks on the card stop here (see PanelCard), so this one is a click on empty strip.
    <div className="strip-canvas-pane" onClick={() => useAppStore.getState().selectPanel(null)}>
      {panels.length === 0 && <p className="placeholder">No panels yet. Add one, or ask the agent to draw it.</p>}
      {canvas}
    </div>
  )
}
