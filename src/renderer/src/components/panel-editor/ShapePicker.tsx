import { PanelAspectSchema } from '@shared/schemas'
import { aspectRatio } from '@shared/strip-layout'
import type { PanelAspect } from '@shared/types'

const SHAPES = PanelAspectSchema.options
/** The long side of each shape's little picture, in px. */
const ICON_PX = 18

export interface ShapePickerProps {
  /** Names the group, as a label would. */
  label: string
  value: PanelAspect
  onChange(aspect: PanelAspect): void
  disabled?: boolean
}

/**
 * The panel shapes as a row of buttons, each with a little rectangle of that shape over its ratio, so the user sees the
 * shape before picking it. The one in use is pressed. Used by the crop dialog, the panel tools' Size and the Generate
 * page.
 */
export function ShapePicker({ label, value, onChange, disabled = false }: ShapePickerProps) {
  return (
    <div className="shape-picker" role="group" aria-label={label}>
      {SHAPES.map((shape) => {
        const ratio = aspectRatio(shape)
        const width = ratio >= 1 ? ICON_PX : Math.max(4, Math.round(ICON_PX * ratio))
        const height = ratio >= 1 ? Math.max(4, Math.round(ICON_PX / ratio)) : ICON_PX
        return (
          <button key={shape} type="button" className="shape-choice" aria-pressed={shape === value} title={`${shape} panel`} disabled={disabled} onClick={() => onChange(shape)}>
            <span className="shape-icon" aria-hidden="true">
              <span style={{ width, height }} />
            </span>
            {shape}
          </button>
        )
      })}
    </div>
  )
}
