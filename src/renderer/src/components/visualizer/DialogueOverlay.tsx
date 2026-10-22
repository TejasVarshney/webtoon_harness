import type { DialogueLine } from '@shared/types'
import { useRoster } from './use-roster'

export interface DialogueOverlayProps {
  dialogue: DialogueLine[]
}

/**
 * Draws a panel's dialogue as HTML over its image, in order from the top. The image holds no text: the lines are
 * data, and React renders them as text (never as markup), so a line can say anything. Speech carries the speaker's
 * name; thought, narration and sfx are styled apart (cloud, caption box, bold slanted lettering) by their kind.
 */
export function DialogueOverlay({ dialogue }: DialogueOverlayProps) {
  const roster = useRoster(dialogue.some((line) => line.speakerId !== null))
  if (dialogue.length === 0) return null
  return (
    <div className="dialogue-overlay">
      {dialogue.map((line) => {
        const speaker = line.kind === 'speech' ? roster.find((c) => c.id === line.speakerId)?.name : undefined
        return (
          <div key={line.id} className={`bubble bubble-${line.kind}`} data-kind={line.kind}>
            {speaker !== undefined && <span className="bubble-speaker">{speaker}</span>}
            <span className="bubble-text">{line.text}</span>
          </div>
        )
      })}
    </div>
  )
}
