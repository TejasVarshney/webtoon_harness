import type { DialogueLine, PanelCharacter } from '@shared/types'
import { layoutBubbles } from './bubble-layout'
import { useRoster } from './use-roster'

export interface DialogueOverlayProps {
  dialogue: DialogueLine[]
  /** The panel's cast: each speaker's bubble goes on the side they stand on. */
  cast?: Pick<PanelCharacter, 'characterId' | 'position'>[]
}

/**
 * Draws a panel's dialogue as HTML over its image, lettered like a manhwa. The image holds no text: the
 * lines are data, and React renders them as text (never as markup), so a line can say anything. `layoutBubbles`
 * picks each line's shape (balloon, shout, whisper, thought cloud, caption box, sound effect), side and tail; there
 * are no name labels, only a tooltip with the speaker's name. Sound effects sit over the middle of the art.
 */
export function DialogueOverlay({ dialogue, cast = [] }: DialogueOverlayProps) {
  const roster = useRoster(dialogue.some((line) => line.speakerId !== null))
  if (dialogue.length === 0) return null
  const layout = new Map(layoutBubbles(dialogue, cast).map((b) => [b.id, b]))
  const bubble = (line: DialogueLine, extra = '') => {
    const b = layout.get(line.id)!
    const speaker = line.speakerId === null ? undefined : roster.find((c) => c.id === line.speakerId)?.name
    return (
      <div
        key={line.id}
        className={`bubble bubble-${b.shape} bubble-side-${b.side} bubble-tail-${b.tail}${b.loud ? ' bubble-loud' : ''}${extra}`}
        data-kind={line.kind}
        data-shape={b.shape}
        data-side={b.side}
        data-tail={b.tail}
        title={speaker}
      >
        <span className="bubble-text">{line.text}</span>
      </div>
    )
  }
  const sfx = dialogue.filter((line) => line.kind === 'sfx')
  return (
    <div className="dialogue-overlay">
      <div className="dialogue-flow">{dialogue.filter((line) => line.kind !== 'sfx').map((line) => bubble(line))}</div>
      {sfx.length > 0 && <div className="dialogue-sfx">{sfx.map((line, i) => bubble(line, i % 2 === 1 ? ' bubble-tilt-right' : ''))}</div>}
    </div>
  )
}
