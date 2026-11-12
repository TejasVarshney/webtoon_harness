import { useState } from 'react'
import { isTallAspect } from '@shared/draw-aspect'
import { clampPlacement, resolveStrip, type PlacedPanel } from '@shared/strip-canvas'
import { STRIP_CSS_WIDTH } from '@shared/strip-width'
import type { Panel, PanelAspect, PanelPlacement } from '@shared/types'
import { usePanelsStore } from '../../stores/panels-store'
import { errorText } from '../characters/controls'
import { ShapePicker } from '../panel-editor/ShapePicker'
import { useFieldAutosave } from '../panel-editor/use-field-autosave'
import { FramePicker } from './FramePicker'
import { alignedX, applyLayout, layoutBlock, PANEL_LAYOUTS, type PanelLayout as Layout } from './panel-layouts'

/** The widths offered, as shares of the strip: thirds and halves fit side by side. */
const PANEL_WIDTHS: { label: string; name: string; share: number }[] = [
  { label: '⅓', name: 'One third', share: 1 / 3 },
  { label: '½', name: 'Half', share: 1 / 2 },
  { label: '⅔', name: 'Two thirds', share: 2 / 3 },
  { label: 'Full', name: 'Full width', share: 1 }
]

const SIDES: { side: 'left' | 'centre' | 'right'; name: string }[] = [
  { side: 'left', name: 'Left' },
  { side: 'centre', name: 'Centre' },
  { side: 'right', name: 'Right' }
]

/** A layout's little picture: its boxes on a 24 by 30 sheet. */
function LayoutIcon({ layout }: { layout: Layout }) {
  return (
    <svg className="layout-icon" viewBox="0 0 24 30" aria-hidden="true">
      {layout.cells.map((c, i) => (
        <rect key={i} x={1 + c.x * 22} y={1 + c.y * 28} width={c.width * 22} height={c.height * 28} rx={1.5} className={i === 0 ? 'layout-icon-this' : undefined} />
      ))}
    </svg>
  )
}

export interface PanelLayoutProps {
  panel: Panel
}

/**
 * The panel tools' Layout. Layouts arrange this panel and the ones after it in reading order (side by side, a wide one
 * over two, a big one beside two, a stagger...), and the panels below move up or down with the block's bottom. Then the
 * panel's frame (straight, no border, or a slanted cut: see `FramePicker`), its own shape, saved at once (the next
 * drawing is made in it), its width on the strip, and its side. Nothing here
 * redraws a picture. The first box of a layout's picture is this panel.
 */
export function PanelLayout({ panel }: PanelLayoutProps) {
  const aspect = useFieldAutosave(panel, 'aspect')
  const episodePanels = usePanelsStore((s) => s.panelsByEpisode[panel.episodeId])
  const [error, setError] = useState<string | null>(null)
  const placed: PlacedPanel[] = resolveStrip(episodePanels ?? [panel])
  const here = placed.find((p) => p.panel.id === panel.id)

  function save(moves: { panelId: string; placement: PanelPlacement }[]): void {
    setError(null)
    usePanelsStore
      .getState()
      .placePanels(panel.episodeId, moves)
      .catch((e: unknown) => setError(errorText(e)))
  }

  function pickShape(next: PanelAspect): void {
    aspect.set(next)
    aspect.flush()
  }

  function pickLayout(layout: Layout): void {
    const moves = applyLayout(placed, panel.id, layout)
    if (moves !== null) save(moves)
  }

  function place(width: number, x: number): void {
    if (here === undefined) return
    save([{ panelId: panel.id, placement: clampPlacement({ x: Math.round(x), y: Math.round(here.y), width }, panel.aspect) }])
  }

  const failure = error ?? aspect.error
  const side = here === undefined ? null : Math.abs(here.x) <= 1 ? 'left' : Math.abs(here.x + here.width - STRIP_CSS_WIDTH) <= 1 ? 'right' : Math.abs(here.x - alignedX(here.width, 'centre')) <= 1 ? 'centre' : null
  return (
    <div className="panel-size">
      <h3 className="panel-size-heading">Layouts</h3>
      <div className="panel-layouts" role="group" aria-label="Layouts">
        {PANEL_LAYOUTS.map((layout) => {
          const fits = layoutBlock(placed, panel.id, layout) !== null
          const more = layout.count - 1
          const title = fits ? `${layout.name}: this panel${more > 0 ? ` and the next ${more === 1 ? 'one' : more}` : ''}` : `${layout.name} needs ${more} more ${more === 1 ? 'panel' : 'panels'} after this one`
          return (
            <button key={layout.id} type="button" className="layout-choice" aria-label={layout.name} title={title} disabled={!fits} onClick={() => pickLayout(layout)}>
              <LayoutIcon layout={layout} />
              <span>{layout.name}</span>
            </button>
          )
        })}
      </div>
      <h3 className="panel-size-heading">Frame</h3>
      <FramePicker panel={panel} />
      <h3 className="panel-size-heading">Shape</h3>
      <ShapePicker label="Panel shape" value={aspect.value} onChange={pickShape} />
      {isTallAspect(aspect.value) && <p className="hint">Tall panels fade instead of a frame</p>}
      <h3 className="panel-size-heading">Width on the strip</h3>
      <div className="panel-widths" role="group" aria-label="Panel width">
        {PANEL_WIDTHS.map(({ label, name, share }) => {
          const width = Math.round(STRIP_CSS_WIDTH * share)
          return (
            <button
              key={name}
              type="button"
              aria-label={name}
              title={name}
              disabled={here === undefined}
              aria-pressed={here !== undefined && Math.abs(here.width - STRIP_CSS_WIDTH * share) <= 1}
              onClick={() => here !== undefined && place(width, Math.min(here.x, STRIP_CSS_WIDTH - width))}
            >
              {label}
            </button>
          )
        })}
      </div>
      <div className="panel-widths" role="group" aria-label="Panel position">
        {SIDES.map(({ side: s, name }) => (
          <button key={s} type="button" aria-label={name} title={`${name} of the strip`} disabled={here === undefined} aria-pressed={side === s} onClick={() => here !== undefined && place(here.width, alignedX(here.width, s))}>
            {name}
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
