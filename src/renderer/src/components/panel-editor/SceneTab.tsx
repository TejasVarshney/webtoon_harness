import { useId } from 'react'
import { isTallAspect } from '@shared/draw-aspect'
import { PanelAspectSchema, PanelFrameSchema, PanelGapSchema, PanelGutterSchema, ShotTypeSchema } from '@shared/schemas'
import type { Panel } from '@shared/types'
import { Field } from '../characters/controls'
import type { FieldAutosave } from './use-field-autosave'

const SHOTS = ShotTypeSchema.options
const ASPECTS = PanelAspectSchema.options
const FRAMES = PanelFrameSchema.options
const GAPS = PanelGapSchema.options
const GUTTERS = PanelGutterSchema.options

/** The Scene tab's fields, each saved on its own (`useFieldAutosave`). */
export interface SceneFields {
  description: FieldAutosave<Panel['description']>
  setting: FieldAutosave<Panel['setting']>
  shot: FieldAutosave<Panel['shot']>
  aspect: FieldAutosave<Panel['aspect']>
  frame: FieldAutosave<Panel['frame']>
  beside: FieldAutosave<Panel['beside']>
  gapAfter: FieldAutosave<Panel['gapAfter']>
  gutter: FieldAutosave<Panel['gutter']>
}

/** A select over a field's options, saved after the last change and when it is left. */
function Choice<T extends string>({ id, field, options, disabled, describedBy }: { id: string; field: FieldAutosave<T>; options: readonly T[]; disabled?: boolean; describedBy?: string }) {
  return (
    <select id={id} value={field.value} disabled={disabled} aria-describedby={describedBy} onChange={(e) => field.set(e.target.value as T)} onBlur={field.flush}>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  )
}

/**
 * What the panel shows and where it sits in the strip: description, setting, shot and aspect, then the layout group
 * from the old panel dialog. Each field saves on its own; the text fields at once when they are left. Layout changes
 * never redraw.
 */
export function SceneTab({ fields }: { fields: SceneFields }) {
  const tallNoteId = useId()
  // A tall panel fades at its edges instead of having a frame, whatever its frame says.
  const tall = isTallAspect(fields.aspect.value)
  const { description, setting, shot, aspect, frame, beside, gapAfter, gutter } = fields
  return (
    <div className="scene-tab">
      <Field label="Description">
        {(id) => <textarea id={id} rows={3} value={description.value} placeholder="What happens in this panel" onChange={(e) => description.set(e.target.value)} onBlur={description.flush} />}
      </Field>
      <Field label="Setting">{(id) => <input id={id} value={setting.value} placeholder="Where and when" onChange={(e) => setting.set(e.target.value)} onBlur={setting.flush} />}</Field>
      <div className="field-row">
        <Field label="Shot">{(id) => <Choice id={id} field={shot} options={SHOTS} />}</Field>
        <Field label="Aspect">{(id) => <Choice id={id} field={aspect} options={ASPECTS} />}</Field>
      </div>
      <fieldset className="layout-group">
        <legend>Layout</legend>
        <div className="field-row">
          <Field label="Frame">{(id) => <Choice id={id} field={frame} options={FRAMES} disabled={tall} describedBy={tall ? tallNoteId : undefined} />}</Field>
          <Field label="Gap after">{(id) => <Choice id={id} field={gapAfter} options={GAPS} />}</Field>
          <Field label="Gutter">{(id) => <Choice id={id} field={gutter} options={GUTTERS} />}</Field>
        </div>
        {tall && (
          <p id={tallNoteId} className="hint">
            Tall panels fade instead of a frame
          </p>
        )}
        <label className="inline-label">
          <input type="checkbox" checked={beside.value} onChange={(e) => beside.set(e.target.checked)} onBlur={beside.flush} />
          Beside the previous panel
        </label>
      </fieldset>
    </div>
  )
}
