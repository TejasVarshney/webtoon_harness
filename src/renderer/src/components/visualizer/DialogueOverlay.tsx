import type { HTMLAttributes, ReactNode } from 'react'
import type { BubblePlacement, DialogueLine, PanelCharacter } from '@shared/types'
import { BubbleBody } from './BubbleBody'
import { layoutBubbles } from './bubble-layout'
import { bubbleStyleProps } from './bubble-style'
import { useRoster } from './use-roster'

/**
 * What the editing stage adds to the overlay: which bubble is selected, the one being typed in, a placement to show
 * while it is dragged, and the handlers for each bubble. All of it is by the line's index in `dialogue`, since a
 * line's id changes on every save.
 */
export interface OverlayEditing {
  selected: number | null
  /** The line whose text is open for typing; its bubble renders `textEditor` instead of its text. */
  textEditing: number | null
  textEditor: ReactNode
  /** Shown instead of the stored placement while a drag or nudge is in progress. */
  preview: { index: number; placement: BubblePlacement } | null
  dragging: number | null
  /** Handlers, tabIndex and aria-label for the bubble of line `index`. */
  bind(index: number): HTMLAttributes<HTMLDivElement>
}

export interface DialogueOverlayProps {
  dialogue: DialogueLine[]
  /** The panel's cast: each speaker's bubble goes on the side they stand on. */
  cast?: Pick<PanelCharacter, 'characterId' | 'position'>[]
  editing?: OverlayEditing
}

/**
 * Draws a panel's dialogue as HTML over its image, lettered like a manhwa. The image holds no text: the
 * lines are data, and React renders them as text (never as markup), so a line can say anything. `layoutBubbles`
 * picks each line's shape (balloon, shout, whisper, thought cloud, caption box, sound effect), side and tail; there
 * are no name labels, only a tooltip with the speaker's name. Sound effects sit over the middle of the art.
 * A line with a placement is drawn there instead, centred on that point, in a layer of its own; its shape and tail are
 * still the layout's. A line's `style` is drawn as inline variables, and a line shaped as a sound effect sits in the
 * sound-effect layer whatever its kind.
 */
export function DialogueOverlay({ dialogue, cast = [], editing }: DialogueOverlayProps) {
  const roster = useRoster(dialogue.some((line) => line.speakerId !== null))
  if (dialogue.length === 0) return null
  const layout = new Map(layoutBubbles(dialogue, cast).map((b) => [b.id, b]))
  const placementOf = (line: DialogueLine, i: number): BubblePlacement | null => (editing?.preview?.index === i ? editing.preview.placement : line.placement)
  const bubble = (line: DialogueLine, i: number, extra = '') => {
    const b = layout.get(line.id)!
    const placement = placementOf(line, i)
    const look = bubbleStyleProps(line.style)
    const style = placement ? { ...look, left: `${placement.x * 100}%`, top: `${placement.y * 100}%` } : look
    const speaker = line.speakerId === null ? undefined : roster.find((c) => c.id === line.speakerId)?.name
    return (
      <div
        key={line.id}
        className={`bubble bubble-${b.shape} bubble-side-${b.side} bubble-tail-${b.tail}${b.loud ? ' bubble-loud' : ''}${placement ? ' bubble-placed' : ''}${extra}`}
        data-kind={line.kind}
        data-shape={b.shape}
        data-side={b.side}
        data-tail={b.tail}
        data-selected={editing ? String(editing.selected === i) : undefined}
        data-dragging={editing?.dragging === i ? 'true' : undefined}
        title={speaker}
        style={Object.keys(style).length > 0 ? style : undefined}
        {...editing?.bind(i)}
      >
        <BubbleBody shape={b.shape} />
        {editing?.textEditing === i ? editing.textEditor : <span className="bubble-text">{line.text}</span>}
      </div>
    )
  }
  const indexed = dialogue.map((line, i) => ({ line, i, placed: placementOf(line, i) !== null, sfx: layout.get(line.id)!.shape === 'sfx' }))
  const placed = indexed.filter((l) => l.placed)
  const flow = indexed.filter((l) => !l.placed && !l.sfx)
  const sfx = indexed.filter((l) => !l.placed && l.sfx)
  return (
    <div className="dialogue-overlay" data-editing={editing ? 'true' : undefined}>
      <div className="dialogue-flow">{flow.map(({ line, i }) => bubble(line, i))}</div>
      {sfx.length > 0 && <div className="dialogue-sfx">{sfx.map(({ line, i }, n) => bubble(line, i, n % 2 === 1 ? ' bubble-tilt-right' : ''))}</div>}
      {placed.length > 0 && <div className="dialogue-placed">{placed.map(({ line, i }) => bubble(line, i))}</div>}
    </div>
  )
}
