import { useState } from 'react'
import { isTallAspect } from '@shared/draw-aspect'
import { clampPlacement } from '@shared/strip-canvas'
import { STRIP_CSS_WIDTH } from '@shared/strip-width'
import type { Panel, PanelAspect } from '@shared/types'
import { usePanelsStore } from '../../stores/panels-store'
import { errorText } from '../characters/controls'
import { ShapePicker } from '../panel-editor/ShapePicker'
import { useFieldAutosave } from '../panel-editor/use-field-autosave'

/** The widths offered, as shares of the strip: thirds and halves fit side by side. */
const PANEL_WIDTHS: { label: string; name: string; share: number }[] = [
  { label: '⅓', name: 'One third', share: 1 / 3 },
  { label: '½', name: 'Half', share: 1 / 2 },
  { label: '⅔', name: 'Two thirds', share: 2 / 3 },
  { label: 'Full', name: 'Full width', share: 1 }
]

export interface PanelSizeProps {
  panel: Panel
  /** Where the panel is drawn on the strip now, which a new width keeps its top-left corner at (pulled in at the right edge). */
  place: { x: number; y: number; width: number }
}

/**
 * The panel tools' Size: the panel's shape, saved at once (the next drawing is made in it; the picture shows in it
 * until then), and its width on the strip in thirds, halves or full, saved like a resize from the corner. Neither
 * redraws anything.
 */
export function PanelSize({ panel, place }: PanelSizeProps) {
  const aspect = useFieldAutosave(panel, 'aspect')
  const [error, setError] = useState<string | null>(null)

  function pickShape(next: PanelAspect): void {
    aspect.set(next)
    aspect.flush()
  }

  function pickWidth(share: number): void {
    const width = Math.round(STRIP_CSS_WIDTH * share)
    const placement = clampPlacement({ x: Math.min(place.x, STRIP_CSS_WIDTH - width), y: place.y, width }, panel.aspect)
    setError(null)
    usePanelsStore
      .getState()
      .placePanels(panel.episodeId, [{ panelId: panel.id, placement }])
      .catch((e: unknown) => setError(errorText(e)))
  }

  const failure = error ?? aspect.error
  return (
    <div className="panel-size">
      <h3 className="panel-size-heading">Shape</h3>
      <ShapePicker label="Panel shape" value={aspect.value} onChange={pickShape} />
      {isTallAspect(aspect.value) && <p className="hint">Tall panels fade instead of a frame</p>}
      <h3 className="panel-size-heading">Width on the strip</h3>
      <div className="panel-widths" role="group" aria-label="Panel width">
        {PANEL_WIDTHS.map(({ label, name, share }) => (
          <button key={name} type="button" aria-label={name} title={name} aria-pressed={Math.abs(place.width - STRIP_CSS_WIDTH * share) <= 1} onClick={() => pickWidth(share)}>
            {label}
          </button>
        ))}
      </div>
      {failure !== null && (
        <p role="alert" className="error">
          {failure}
        </p>
      )}
    </div>
  )
}
