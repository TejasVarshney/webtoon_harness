import { useMemo, useRef } from 'react'
import { assetUrl } from '@shared/asset-url'
import { contentBottom, exportStrip, panelHeight, resolveStrip } from '@shared/strip-canvas'
import { effectiveBackground, stripBackgroundStyle, type StripBackground } from '@shared/strip-background'
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
  /** `export` draws the finished panels and their lettering only, ending at the lowest one: no selection, tools or "+". Default `edit`. */
  mode?: 'edit' | 'export'
  /** Whether the dialogue is drawn over the art. Default true. */
  lettering?: boolean
  /** Export: the episode's stored background, which the export window has no store to read. Edit mode reads the store. */
  background?: StripBackground | null
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
  const exporting = mode === 'export'
  const storedInStore = usePanelsStore((s) => s.episodes.find((e) => e.id === episodeId)?.background ?? null)
  const stored = exporting ? (background ?? null) : storedInStore
  // A background being edited shows before it is saved; the export draws what is stored.
  const preview = usePanelsStore((s) => (s.backgroundPreview?.episodeId === episodeId && mode === 'edit' ? s.backgroundPreview.background : null))
  // The export positions every panel as on screen, draws the finished ones, and stops at the lowest of them.
  const strip = useMemo(() => (exporting ? exportStrip(panels) : null), [exporting, panels])
  const placed = useMemo(() => strip?.placed ?? resolveStrip(panels), [strip, panels])
  const drag = useStripDrag(placed)
  const canvasRef = useRef<HTMLDivElement>(null)
  // A panel being moved is drawn where it is dragged to, and the strip grows to hold it.
  const drawn = placed.map((p) => {
    const preview = drag.previews[p.panel.id]
    return preview === undefined ? p : { ...p, ...preview, height: panelHeight(preview.width, p.panel.aspect), share: preview.width / STRIP_CSS_WIDTH }
  })
  const bottom = contentBottom(drawn)
  // The background is sized to the content as laid out on screen, not to a panel mid-drag and not to the export's crop.
  const backgroundStyle = useMemo(() => {
    const bg = preview ?? effectiveBackground(stored, strip === null ? placed : resolveStrip(panels))
    const imageUrl = bg.kind === 'image' && projectId !== null ? assetUrl(projectId, bg.path) : null
    return stripBackgroundStyle(bg, { imageUrl, bottom: strip?.contentBottom ?? contentBottom(placed) })
  }, [preview, stored, placed, projectId, strip, panels])

  const canvas = (
    <div ref={canvasRef} className="strip-canvas" data-mode={mode} style={{ width: STRIP_CSS_WIDTH, height: exporting ? bottom : bottom + TRAILING_SPACE, ...(exporting ? { overflow: 'hidden' } : {}), ...backgroundStyle }}>
      {drawn.map((p) => (
        <PanelCard
          key={p.panel.id}
          panel={p.panel}
          selected={!exporting && selectedIds.includes(p.panel.id)}
          slant={p.slant}
          share={p.share}
          place={{ x: p.x, y: p.y, width: p.width }}
          mode={mode}
          lettering={false}
          position={exporting ? panels.indexOf(p.panel) + 1 : undefined}
          bind={exporting ? undefined : drag.bindCard(p.panel.id)}
          bindResize={exporting ? undefined : drag.bindResize(p.panel.id)}
        />
      ))}
      {/* After all the cards, so the lettering sits over them. */}
      {lettering && <StripBubbles placed={drawn} canvas={canvasRef} mode={mode} />}
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
