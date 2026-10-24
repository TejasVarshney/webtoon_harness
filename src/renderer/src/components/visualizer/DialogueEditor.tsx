import { DialogueKindSchema } from '@shared/schemas'
import type { Character, DialogueLine, PanelCharacter } from '@shared/types'
import { Field } from '../characters/controls'

const KINDS = DialogueKindSchema.options

/** A dialogue line before it is stored; the server gives it its id. */
export type DialogueDraftLine = Omit<DialogueLine, 'id'>

export interface DialogueEditorProps {
  /** The whole roster, archived characters included: an archived speaker stays visible on the line that has them. */
  characters: Character[]
  /** The panel's cast: a new line starts with the first of them speaking. */
  cast: PanelCharacter[]
  value: DialogueDraftLine[]
  onChange(next: DialogueDraftLine[]): void
}

/** The panel's lines in reading order. Narration and sound effects have no speaker (`speakerId: null`). */
export function DialogueEditor({ characters, cast, value, onChange }: DialogueEditorProps) {
  const active = characters.filter((c) => !c.archived)
  const update = (i: number, patch: Partial<DialogueDraftLine>): void => onChange(value.map((line, j) => (j === i ? { ...line, ...patch } : line)))

  return (
    <fieldset className="dialogue-editor">
      <legend>Dialogue</legend>
      {value.map((line, i) => {
        const speaker = characters.find((c) => c.id === line.speakerId)
        const options = speaker === undefined || !speaker.archived ? active : [...active, speaker]
        return (
          <div className="dialogue-row" key={i}>
            <div className="field-row">
              <Field label="Speaker">
                {(id) => (
                  <select id={id} value={line.speakerId ?? ''} onChange={(e) => update(i, { speakerId: e.target.value === '' ? null : e.target.value })}>
                    <option value="">Narration</option>
                    {line.speakerId !== null && speaker === undefined && <option value={line.speakerId}>{line.speakerId}</option>}
                    {options.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.archived ? `${c.name} (archived)` : c.name}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="Kind">
                {(id) => (
                  <select id={id} value={line.kind} onChange={(e) => update(i, { kind: e.target.value as DialogueDraftLine['kind'] })}>
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>
            <Field label="Text">{(id) => <textarea id={id} rows={2} value={line.text} onChange={(e) => update(i, { text: e.target.value })} />}</Field>
            <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))}>
              Remove line
            </button>
          </div>
        )
      })}
      <div className="form-actions">
        <button
          type="button"
          onClick={() => {
            const first = cast[0]?.characterId ?? null
            onChange([...value, { speakerId: first, kind: first === null ? 'narration' : 'speech', text: '' }])
          }}
        >
          Add dialogue line
        </button>
      </div>
    </fieldset>
  )
}
