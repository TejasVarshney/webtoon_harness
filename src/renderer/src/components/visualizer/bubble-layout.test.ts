import { describe, expect, it } from 'vitest'
import type { DialogueLine, PanelCharacter } from '@shared/types'
import { bubbleShape, layoutBubbles, sideOfPosition } from './bubble-layout'

const line = (kind: DialogueLine['kind'], text: string, speakerId: string | null = null, id = `dlg_${text.length}${kind}`): DialogueLine => ({ id, kind, text, speakerId, placement: null, style: null, tail: null })
const cast = (characterId: string, position: PanelCharacter['position']): Pick<PanelCharacter, 'characterId' | 'position'> => ({ characterId, position })

describe('bubbleShape', () => {
  it('draws narration as a caption box and sfx as lettering', () => {
    expect(bubbleShape(line('narration', 'Seoul. Six hours earlier.'))).toBe('caption')
    expect(bubbleShape(line('sfx', 'tk... tk...'))).toBe('sfx')
  })

  it('draws a short line that ends with ! as a shout', () => {
    expect(bubbleShape(line('speech', 'Get down!'))).toBe('shout')
    expect(bubbleShape(line('speech', 'Captain—!'))).toBe('shout')
    expect(bubbleShape(line('speech', "Don't mind the Captain! I'm Bo-ra, the medic."))).toBe('speech')
  })

  it('draws a mostly capital line as a shout', () => {
    expect(bubbleShape(line('speech', 'RUN NOW'))).toBe('shout')
    expect(bubbleShape(line('speech', 'OK'))).toBe('speech')
  })

  it('draws a line that trails off as a whisper', () => {
    expect(bubbleShape(line('speech', '...Beautiful.'))).toBe('whisper')
    expect(bubbleShape(line('speech', 'If I tell them…'))).toBe('whisper')
    expect(bubbleShape(line('speech', "You're late, courier."))).toBe('speech')
  })

  it('keeps thoughts as clouds whatever the text says', () => {
    expect(bubbleShape(line('thought', 'No way!'))).toBe('thought')
  })
})

describe('layoutBubbles', () => {
  it('puts each speaker on their own side of the panel, with the tail down toward them', () => {
    const out = layoutBubbles(
      [line('speech', 'A package that has to be opened inside is bad news.', 'chr_rhee'), line('speech', "It's addressed to me.", 'chr_haneul')],
      [cast('chr_haneul', 'left'), cast('chr_rhee', 'right')]
    )
    expect(out.map((b) => [b.side, b.tail])).toEqual([
      ['right', 'down'],
      ['left', 'down']
    ])
  })

  it('stacks one speaker\'s lines on the same side', () => {
    const out = layoutBubbles([line('speech', 'One.', 'chr_bora', 'a'), line('speech', 'Two.', 'chr_bora', 'b')], [cast('chr_bora', 'left')])
    expect(out.map((b) => b.side)).toEqual(['left', 'left'])
  })

  it('zig-zags two speakers who share a position', () => {
    const out = layoutBubbles([line('speech', 'One.', 'chr_a'), line('speech', 'Two.', 'chr_b')], [cast('chr_a', 'center'), cast('chr_b', 'center')])
    expect(out.map((b) => b.side)).toEqual(['center', 'right'])
  })

  it('points the tail out of the top edge for a voice that is not in the panel', () => {
    const [b] = layoutBubbles([line('speech', "You're late, courier.", 'chr_rhee')], [cast('chr_haneul', 'left')])
    expect(b).toMatchObject({ shape: 'speech', tail: 'edge', offPanel: true })
    expect(b.side).not.toBe('left')
  })

  it('treats a background cast member as the center', () => {
    const [b] = layoutBubbles([line('speech', '...Beautiful.', 'chr_bora')], [cast('chr_bora', 'background')])
    expect(b).toMatchObject({ shape: 'whisper', side: 'center', tail: 'down' })
  })

  it('gives captions and sound effects no tail, and marks loud sound effects big', () => {
    const out = layoutBubbles([line('narration', 'Midnight.'), line('sfx', 'KANG!'), line('sfx', 'tk... tk...')], [])
    expect(out.map((b) => [b.shape, b.tail, b.loud])).toEqual([
      ['caption', 'none', false],
      ['sfx', 'none', true],
      ['sfx', 'none', false]
    ])
  })

  it("a line's tail decides how it is drawn", () => {
    const cast1 = [cast('chr_a', 'left')]
    const withTail = (tail: DialogueLine['tail']): DialogueLine => ({ ...line('speech', 'Hi there.', 'chr_a'), tail })
    expect(layoutBubbles([withTail('none')], cast1)[0].tail).toBe('none')
    expect(layoutBubbles([withTail({ x: 0.2, y: 0.9 })], cast1)[0].tail).toBe('point')
    expect(layoutBubbles([withTail(null)], cast1)[0].tail).toBe('down')
    expect(layoutBubbles([withTail(null)], [])[0].tail).toBe('edge')
  })

  it('a caption or sound effect never draws a tail, whatever is stored', () => {
    const [b] = layoutBubbles([{ ...line('narration', 'Midnight.'), tail: { x: 0.2, y: 0.9 } }], [])
    expect(b.tail).toBe('none')
  })

  it('keeps the lines in reading order and their ids', () => {
    const d = [line('narration', 'n', null, 'dlg_1'), line('thought', 't', 'chr_a', 'dlg_2'), line('sfx', 's', null, 'dlg_3')]
    expect(layoutBubbles(d, [cast('chr_a', 'right')]).map((b) => b.id)).toEqual(['dlg_1', 'dlg_2', 'dlg_3'])
  })
})

describe('sideOfPosition', () => {
  it('reads the side from a position in the user’s words', () => {
    expect(sideOfPosition('left')).toBe('left')
    expect(sideOfPosition('Far RIGHT, half in shadow')).toBe('right')
    expect(sideOfPosition('center')).toBe('center')
    expect(sideOfPosition('background')).toBe('center')
    expect(sideOfPosition('')).toBe('center')
    // Both sides, or a word that only contains one, say nothing about a side.
    expect(sideOfPosition('left of the door, right by the window')).toBe('center')
    expect(sideOfPosition('upright, bright light')).toBe('center')
  })
})

describe('bubbleShape with a style', () => {
  it('draws the chosen shape whatever the words say', () => {
    expect(bubbleShape({ kind: 'speech', text: 'Hello.', style: { shape: 'shout' } })).toBe('shout')
    expect(bubbleShape({ kind: 'speech', text: 'STOP!', style: { shape: 'speech' } })).toBe('speech')
  })
})
