import { useId, useState } from 'react'
import { isTallAspect } from '@shared/draw-aspect'
import { PanelAspectSchema, PanelFrameSchema, ShotTypeSchema } from '@shared/schemas'
import type { Panel } from '@shared/types'
import { Field } from '../characters/controls'
import { useLocationRoster } from '../visualizer/use-location-roster'
import type { FieldAutosave } from './use-field-autosave'

const SHOTS = ShotTypeSchema.options
const ASPECTS = PanelAspectSchema.options
const FRAMES = PanelFrameSchema.options

/** The Scene tab's fields, each saved on its own (`useFieldAutosave`). */
export interface SceneFields {
  description: FieldAutosave<Panel['description']>
  setting: FieldAutosave<Panel['setting']>
  location: FieldAutosave<Panel['location']>
  shot: FieldAutosave<Panel['shot']>
  aspect: FieldAutosave<Panel['aspect']>
  frame: FieldAutosave<Panel['frame']>
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

/** How the camera select reads a panel's camera: its main angle, the reverse, or the user's own words. */
function cameraKind(camera: string): 'main' | 'reverse' | 'other' {
  const said = camera.trim().toLowerCase()
  return said === '' || said === 'main' ? 'main' : said === 'reverse' ? 'reverse' : 'other'
}

/**
 * Where the panel is set: a saved location, one of its states and the camera. Picking a location starts at its base
 * state. Archived locations are offered only to the panel already set in one.
 */
function LocationPicker({ field }: { field: FieldAutosave<Panel['location']> }) {
  const locations = useLocationRoster()
  const value = field.value
  const chosen = value === null ? undefined : locations.find((l) => l.id === value.locationId)
  const offered = locations.filter((l) => !l.archived || l.id === value?.locationId)
  // "Other" shows the text box before anything is typed in it.
  const [typing, setTyping] = useState(false)
  const kind = value === null ? 'main' : typing ? 'other' : cameraKind(value.camera)

  const pick = (locationId: string): void => {
    if (locationId === '') {
      field.set(null)
      return
    }
    const base = locations.find((l) => l.id === locationId)?.states.find((s) => s.kind === 'base')
    if (base) field.set({ locationId, stateId: base.id, camera: value?.camera ?? 'main' })
  }
  const aim = (next: string): void => {
    if (value === null) return
    setTyping(next === 'other')
    if (next !== 'other') field.set({ ...value, camera: next })
  }

  return (
    <>
      <div className="field-row">
        <Field label="Location">
          {(id) => (
            <select
              id={id}
              value={value?.locationId ?? ''}
              title="The app writes the place's layout, state and camera into the prompt, and the image continues from the last panel in the same location."
              onChange={(e) => pick(e.target.value)}
              onBlur={field.flush}
            >
              <option value="">None</option>
              {offered.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.archived ? `${l.name} (archived)` : l.name}
                </option>
              ))}
              {value !== null && chosen === undefined && <option value={value.locationId}>Unknown location</option>}
            </select>
          )}
        </Field>
        <Field label="State">
          {(id) => (
            <select id={id} value={value?.stateId ?? ''} disabled={chosen === undefined} onChange={(e) => value && field.set({ ...value, stateId: e.target.value })} onBlur={field.flush}>
              {chosen === undefined && <option value={value?.stateId ?? ''}>-</option>}
              {chosen?.states.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Camera">
          {(id) => (
            <select id={id} value={kind} disabled={value === null} onChange={(e) => aim(e.target.value)} onBlur={field.flush}>
              <option value="main">Main angle</option>
              <option value="reverse">Reverse angle</option>
              <option value="other">Other</option>
            </select>
          )}
        </Field>
      </div>
      {value !== null && kind === 'other' && (
        <Field label="Camera angle">
          {(id) => (
            <input
              id={id}
              value={cameraKind(value.camera) === 'other' ? value.camera : ''}
              placeholder="Where the camera is, e.g. low, from the doorway"
              onChange={(e) => field.set({ ...value, camera: e.target.value })}
              onBlur={field.flush}
            />
          )}
        </Field>
      )}
      {locations.length === 0 && <p className="hint">No saved locations yet. Ask the agent to save a place as a location.</p>}
    </>
  )
}

/**
 * What the panel shows: description, setting, location, shot and aspect, then its frame. Each field saves on its own; the
 * text fields at once when they are left. A frame change never redraws. Where the panel sits is set by dragging it on the strip.
 */
export function SceneTab({ fields }: { fields: SceneFields }) {
  const tallNoteId = useId()
  // A tall panel fades at its edges instead of having a frame, whatever its frame says.
  const tall = isTallAspect(fields.aspect.value)
  const { description, setting, location, shot, aspect, frame } = fields
  return (
    <div className="scene-tab">
      <Field label="Description">
        {(id) => <textarea id={id} rows={3} value={description.value} placeholder="What happens in this panel" onChange={(e) => description.set(e.target.value)} onBlur={description.flush} />}
      </Field>
      <Field label="Setting">{(id) => <input id={id} value={setting.value} placeholder="Where and when" onChange={(e) => setting.set(e.target.value)} onBlur={setting.flush} />}</Field>
      <LocationPicker field={location} />
      <div className="field-row">
        <Field label="Shot">{(id) => <Choice id={id} field={shot} options={SHOTS} />}</Field>
        <Field label="Aspect">{(id) => <Choice id={id} field={aspect} options={ASPECTS} />}</Field>
      </div>
      <fieldset className="layout-group">
        <legend>Layout</legend>
        <div className="field-row">
          <Field label="Frame">{(id) => <Choice id={id} field={frame} options={FRAMES} disabled={tall} describedBy={tall ? tallNoteId : undefined} />}</Field>
        </div>
        {tall && (
          <p id={tallNoteId} className="hint">
            Tall panels fade instead of a frame
          </p>
        )}
      </fieldset>
    </div>
  )
}
