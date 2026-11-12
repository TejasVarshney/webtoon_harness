import { useState } from 'react'
import { isTallAspect } from '@shared/draw-aspect'
import { cutPoints, PANEL_CUTS, type PanelSlant } from '@shared/panel-cuts'
import type { Panel, PanelCut } from '@shared/types'
import { errorText } from '../characters/controls'
import { queuePanelSave } from '../panel-editor/panel-save-queue'

/** A frame the user can pick: a frame kind, and for a slanted one its cut (null: the automatic one). */
interface FrameChoice {
  name: string
  frame: Panel['frame']
  /** Only for a slanted frame: straight and no border keep the stored cut, for when the panel is slanted again. */
  cut?: PanelCut | null
  /** What its button draws. */
  icon: 'straight' | 'borderless' | PanelSlant
}

const CHOICES: FrameChoice[] = [
  { name: 'Straight', frame: 'bordered', icon: 'straight' },
  { name: 'No border', frame: 'borderless', icon: 'borderless' },
  { name: 'Alternating', frame: 'slanted', cut: null, icon: 'left' },
  ...PANEL_CUTS.map(({ cut, name }): FrameChoice => ({ name, frame: 'slanted', cut, icon: cut }))
]

/** A frame's little picture on a 24 by 30 sheet: the panel's outline, cut as it would be. */
function FrameIcon({ icon }: { icon: FrameChoice['icon'] }) {
  return (
    <svg className="frame-icon" viewBox="0 0 24 30" aria-hidden="true">
      {icon === 'straight' ? (
        <rect x={2} y={2} width={20} height={26} />
      ) : icon === 'borderless' ? (
        <rect x={2} y={2} width={20} height={26} className="frame-icon-faint" />
      ) : (
        <polygon points={cutPoints(icon, 20, 26, 5)} transform="translate(2 2)" />
      )}
    </svg>
  )
}

/**
 * The frame designs of the panel tools' Layout: straight, no border, the automatic slant that alternates down the
 * strip, and the slanted cuts (a falling or rising top or bottom, both edges, a wedge, a lean, one slanted side). A pick
 * saves the frame and its cut together, and redraws nothing: the frame is drawn by the app, over the picture. A tall
 * panel fades instead of having a frame, so none is offered.
 */
export function FramePicker({ panel }: { panel: Panel }) {
  const [error, setError] = useState<string | null>(null)
  const tall = isTallAspect(panel.aspect)

  function pick(choice: FrameChoice): void {
    setError(null)
    queuePanelSave(panel.id, () => [choice.cut === undefined ? { frame: choice.frame } : { frame: choice.frame, cut: choice.cut }], 'frame').catch((e: unknown) => setError(errorText(e)))
  }

  const current = (choice: FrameChoice): boolean => panel.frame === choice.frame && (choice.frame !== 'slanted' || panel.cut === choice.cut)
  return (
    <>
      <div className="frame-picker" role="group" aria-label="Panel frame">
        {CHOICES.map((choice) => (
          <button key={choice.name} type="button" className="frame-choice" aria-label={choice.name} title={choice.name} aria-pressed={!tall && current(choice)} disabled={tall} onClick={() => pick(choice)}>
            <FrameIcon icon={choice.icon} />
            <span>{choice.name}</span>
          </button>
        ))}
      </div>
      {tall && <p className="hint">Tall panels fade instead of a frame</p>}
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </>
  )
}
