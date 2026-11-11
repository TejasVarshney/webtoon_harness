import { useMemo, useRef } from 'react'
import { assetUrl } from '@shared/asset-url'
import { contentBottom, panelHeight, resolveStrip } from '@shared/strip-canvas'
import { effectiveBackground, stripBackgroundStyle } from '@shared/strip-background'
import { STRIP_CSS_WIDTH } from '@shared/strip-width'
import type { Panel } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { usePanelsStore } from '../../stores/panels-store'
import { AddPanelButton } from './AddPanelButton'
import { PanelCard } from './PanelCard'
import { StripBubbles } from './StripBubbles'
import { useStripDrag } from './use-strip-drag'

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
  /** A CSS background for the canvas, instead of the episode's own. */
  background?: string
}

/**
 * The episode as free-standing panels on a strip 440px wide (STRIP_CSS_WIDTH), each at the place `resolveStrip` gives
 * it. The canvas is the size container the lettering is measured against, so its text keeps its size at any pane width.
 * A click on empty strip clears the selection; a click on a card selects it (see PanelCard). The dialogue is lettered
 * over the cards by `StripBubbles`, whose bubbles can be dragged anywhere on the strip.
 */
export function StripCanvas({ episodeId, panels, mode = 'edit', lettering = true, background }: StripCanvasProps) {
  const selectedIds = useAppStore((s) => s.selectedPanelIds)
  const projectId = useAppStore((s) => s.projectId)
  const stored = usePanelsStore((s) => s.episodes.find((e) => e.id === episodeId)?.background ?? null)
  const exporting = mode === 'export'
  const placed = useMemo(() => resolveStrip(panels), [panels])
  const drag = useStripDrag(placed)
  const canvasRef = useRef<HTMLDivElement>(null)
  // A panel being moved is drawn where it is dragged to, and the strip grows to hold it.
  const drawn = placed.map((p) => {
    const preview = drag.previews[p.panel.id]
    return preview === undefined ? p : { ...p, ...preview, height: panelHeight(preview.width, p.panel.aspect), share: preview.width / STRIP_CSS_WIDTH }
  })
  const bottom = contentBottom(drawn)
  // The background is sized to the content as laid out, not to a panel mid-drag.
  const backgroundStyle = useMemo(() => {
    const bg = effectiveBackground(stored, placed)
    const imageUrl = bg.kind === 'image' && projectId !== null ? assetUrl(projectId, bg.path) : null
    return stripBackgroundStyle(bg, { imageUrl, bottom: contentBottom(placed) })
  }, [stored, placed, projectId])

  const canvas = (
    <div ref={canvasRef} className="strip-canvas" data-mode={mode} style={{ width: STRIP_CSS_WIDTH, height: exporting ? bottom : bottom + TRAILING_SPACE, ...(background === undefined ? backgroundStyle : { background }) }}>
      {drawn.map((p, i) => (
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
          bind={exporting ? undefined : drag.bindCard(p.panel.id)}
          bindResize={exporting ? undefined : drag.bindResize(p.panel.id)}
        />
      ))}
      {/* After all the cards, so the lettering sits over them. */}
      {!exporting && lettering && <StripBubbles placed={drawn} canvas={canvasRef} />}
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
      {drag.error !== null && (
        <p role="alert" className="error">
          {drag.error}
        </p>
      )}
      {panels.length === 0 && <p className="placeholder">No panels yet. Add one, or ask the agent to draw it.</p>}
      {canvas}
    </div>
  )
}
