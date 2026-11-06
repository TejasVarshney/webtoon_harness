import type { BubbleShape, BubbleStyle, DialogueLine, PanelCharacter } from '@shared/types'

// Pure placement rules for the dialogue overlay: which shape each line is drawn as, which side of the panel it sits
// on, and where its tail points. The panel data stays as it is; everything here is read from the line's kind and
// text and from the cast's positions, the way a letterer reads a script.

export type BubbleSide = 'left' | 'center' | 'right'
/** `down`: toward the speaker in the panel; `edge`: out through the top of the frame, for a voice that is not in it; `point`: to the tip the line stores. */
export type TailDrawing = 'down' | 'edge' | 'none' | 'point'

export interface BubbleLayout {
  id: string
  shape: BubbleShape
  side: BubbleSide
  tail: TailDrawing
  /** The speaker is not in the panel's cast (or the line has no speaker). */
  offPanel: boolean
  /** A sound effect drawn big: it has a "!" or is mostly capitals. */
  loud: boolean
}

type CastPosition = Pick<PanelCharacter, 'characterId' | 'position'>

const SHOUT_MAX_WORDS = 6

/** At least four letters, and at least 70% of them capitals. */
function mostlyCapitals(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? []
  if (letters.length < 4) return false
  return letters.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase()).length / letters.length >= 0.7
}

function shortExclamation(text: string): boolean {
  const trimmed = text.trim()
  return /!["'’”)\]—–-]*$/u.test(trimmed) && trimmed.split(/\s+/).length <= SHOUT_MAX_WORDS
}

const trailsOff = (text: string): boolean => /^\s*(\.\.\.|…)|(\.\.\.|…)\s*$/u.test(text)

export function bubbleShape(line: Pick<DialogueLine, 'kind' | 'text'> & { style?: BubbleStyle | null }): BubbleShape {
  if (line.style?.shape) return line.style.shape
  switch (line.kind) {
    case 'narration':
      return 'caption'
    case 'sfx':
      return 'sfx'
    case 'thought':
      return 'thought'
    case 'speech':
      if (shortExclamation(line.text) || mostlyCapitals(line.text)) return 'shout'
      return trailsOff(line.text) ? 'whisper' : 'speech'
  }
}

/** The side a free-text position leans to: "left" or "right" when it says one of them alone, else the centre. */
export function sideOfPosition(position: PanelCharacter['position']): BubbleSide {
  const words = position.toLowerCase()
  const left = /\bleft\b/.test(words)
  const right = /\bright\b/.test(words)
  return left === right ? 'center' : left ? 'left' : 'right'
}
const FLIP: Record<BubbleSide, BubbleSide> = { left: 'right', center: 'right', right: 'left' }

/**
 * One layout per line, in reading order. A speaker's bubbles go on the side their cast entry stands on; a second
 * speaker who would share that side is moved across, so alternating lines zig-zag. A voice from outside the panel
 * takes a side nobody in the cast stands on and points its tail out of the frame.
 */
export function layoutBubbles(dialogue: DialogueLine[], cast: CastPosition[]): BubbleLayout[] {
  const castSide = new Map(cast.map((c) => [c.characterId, sideOfPosition(c.position)]))
  const occupied = new Set(castSide.values())
  const freeSide: BubbleSide = (['right', 'left', 'center'] as const).find((s) => !occupied.has(s)) ?? 'center'
  const speakerSide = new Map<string, BubbleSide>()
  const sideOwner = new Map<BubbleSide, string>()

  return dialogue.map((line): BubbleLayout => {
    const shape = bubbleShape(line)
    const base = { id: line.id, shape, loud: false }
    if (shape === 'caption') return { ...base, side: 'left', tail: 'none', offPanel: line.speakerId === null }
    if (shape === 'sfx') return { ...base, side: 'center', tail: 'none', offPanel: true, loud: line.text.includes('!') || mostlyCapitals(line.text) }

    // A stored tail wins over the automatic one: 'none' draws nothing, a point is drawn to that point.
    const stored: TailDrawing | null = line.tail === null ? null : line.tail === 'none' ? 'none' : 'point'
    const inCast = line.speakerId !== null ? castSide.get(line.speakerId) : undefined
    if (inCast === undefined) return { ...base, side: freeSide, tail: stored ?? 'edge', offPanel: true }

    const speaker = line.speakerId as string
    let side = speakerSide.get(speaker)
    if (side === undefined) {
      side = inCast
      const owner = sideOwner.get(side)
      if (owner !== undefined && owner !== speaker) side = FLIP[side]
      speakerSide.set(speaker, side)
      if (!sideOwner.has(side)) sideOwner.set(side, speaker)
    }
    return { ...base, side, tail: stored ?? 'down', offPanel: false }
  })
}
