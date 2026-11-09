import { useRef, type HTMLAttributes, type ReactNode } from 'react'
import type { BubblePlacement, DialogueLine, PanelCharacter } from '@shared/types'
import { BubbleBody } from './BubbleBody'
import { BubbleTailArt } from './BubbleTailArt'
import { BubbleWidthHandles, type BubbleEdge, type WidthHandleProps } from './BubbleWidthHandles'
import { MergedBubbles } from './MergedBubbles'
import { layoutBubbles } from './bubble-layout'
import { mergedLook, mergeKey } from './bubble-merge'
import { bubbleStyleProps } from './bubble-style'
import { hasTail } from './bubble-tail'
import { useMergedBubbles, type MergedGroup } from './use-merged-bubbles'
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
  /** Shown instead of the stored tail's tip while its dot is dragged or nudged. */
  tailPreview: { index: number; tip: BubblePlacement } | null
  /** Shown instead of the stored width and placement while a width handle is dragged or nudged. */
  widthPreview: { index: number; width: number; placement: BubblePlacement } | null
  dragging: number | null
  /** Handlers, tabIndex and aria-label for the bubble of line `index`. */
  bind(index: number): HTMLAttributes<HTMLDivElement>
  /** Handlers and aria-label for the dot at the tip of that bubble's tail. */
  bindTail(index: number): HTMLAttributes<HTMLDivElement>
  /** Handlers and aria-label for the handle on that side of the bubble, which sets its width. */
  bindWidth(index: number, edge: BubbleEdge): WidthHandleProps
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
 * still the layout's. A stored tail tip is drawn by `BubbleTailArt`, measured from the page. A line's `style` is drawn
 * as inline variables, with `bubble-sized` when it sets a width, and a line shaped as a sound effect sits in the
 * sound-effect layer whatever its kind. While editing, the selected bubble has the tail's dot and the width handles,
 * unless its text is open. Bubbles of the same look that overlap are drawn as one balloon by `MergedBubbles`, under
 * the layers that hold their text: each keeps its box, text and handles, and gives up only its own outline and fill.
 */
export function DialogueOverlay({ dialogue, cast = [], editing }: DialogueOverlayProps) {
  const roster = useRoster(dialogue.some((line) => line.speakerId !== null))
  const overlay = useRef<HTMLDivElement>(null)
  const groups = useMergedBubbles(overlay)
  if (dialogue.length === 0) return null
  const layout = new Map(layoutBubbles(dialogue, cast).map((b) => [b.id, b]))
  const inGroup = new Set(groups.flat().map((m) => m.index))
  const lookOf = (i: number) => (i < dialogue.length ? mergedLook(layout.get(dialogue[i].id)!.shape, dialogue[i].style) : null)
  const widthPreviewOf = (i: number) => (editing?.widthPreview?.index === i ? editing.widthPreview : null)
  const placementOf = (line: DialogueLine, i: number): BubblePlacement | null =>
    editing?.preview?.index === i ? editing.preview.placement : (widthPreviewOf(i)?.placement ?? line.placement)
  const bubble = (line: DialogueLine, i: number, extra = '') => {
    const b = layout.get(line.id)!
    const placement = placementOf(line, i)
    const previewWidth = widthPreviewOf(i)?.width
    const width = previewWidth ?? line.style?.width
    const look = bubbleStyleProps(previewWidth === undefined ? line.style : { ...line.style, width: previewWidth })
    const style = placement ? { ...look, left: `${placement.x * 100}%`, top: `${placement.y * 100}%` } : look
    const previewTip = editing?.tailPreview?.index === i ? editing.tailPreview.tip : null
    const tip = previewTip ?? (line.tail !== null && line.tail !== 'none' ? line.tail : null)
    // A tail being dragged is drawn pointed, whatever the layout would have drawn.
    const tail = previewTip === null ? b.tail : 'point'
    const handles = editing !== undefined && editing.selected === i && editing.textEditing !== i
    const dot = handles && hasTail(b.shape)
    const speaker = line.speakerId === null ? undefined : roster.find((c) => c.id === line.speakerId)?.name
    const key = mergeKey(b.shape, line.style)
    const merged = key !== null && inGroup.has(i)
    return (
      <div
        key={line.id}
        className={`bubble bubble-${b.shape} bubble-side-${b.side} bubble-tail-${tail}${b.loud ? ' bubble-loud' : ''}${placement ? ' bubble-placed' : ''}${width !== undefined ? ' bubble-sized' : ''}${merged ? ' bubble-merged' : ''}${extra}`}
        data-kind={line.kind}
        data-shape={b.shape}
        data-side={b.side}
        data-tail={tail}
        data-merge-key={key ?? undefined}
        data-merge-index={key !== null ? i : undefined}
        data-selected={editing ? String(editing.selected === i) : undefined}
        data-dragging={editing?.dragging === i ? 'true' : undefined}
        title={speaker}
        style={Object.keys(style).length > 0 ? style : undefined}
        {...editing?.bind(i)}
      >
        <BubbleBody shape={b.shape} />
        {hasTail(b.shape) && (tail === 'point' || dot) && (
          <BubbleTailArt shape={b.shape} side={b.side} drawing={tail} tip={tip} stroke={line.style?.strokeWidth ?? 2} handle={dot ? editing.bindTail(i) : undefined} />
        )}
        {handles && <BubbleWidthHandles width={width} bind={(edge) => editing.bindWidth(i, edge)} />}
        {editing?.textEditing === i ? editing.textEditor : <span className="bubble-text">{line.text}</span>}
      </div>
    )
  }
  const indexed = dialogue.map((line, i) => ({ line, i, placed: placementOf(line, i) !== null, sfx: layout.get(line.id)!.shape === 'sfx' }))
  const placed = indexed.filter((l) => l.placed)
  const flow = indexed.filter((l) => !l.placed && !l.sfx)
  const sfx = indexed.filter((l) => !l.placed && l.sfx)
  // A group with an automatic member goes under the automatic layer, or its fill would cover that member's text. The
  // rest stay where placed bubbles have always been, over the automatic layer and the sound effects.
  const hasAutomatic = (group: MergedGroup): boolean => group.some((m) => m.index < dialogue.length && placementOf(dialogue[m.index], m.index) === null)
  const belowFlow = groups.filter(hasAutomatic)
  const belowPlaced = groups.filter((group) => !hasAutomatic(group))
  return (
    <div ref={overlay} className="dialogue-overlay" data-editing={editing ? 'true' : undefined}>
      {belowFlow.length > 0 && <MergedBubbles groups={belowFlow} lookOf={lookOf} />}
      <div className="dialogue-flow">{flow.map(({ line, i }) => bubble(line, i))}</div>
      {sfx.length > 0 && <div className="dialogue-sfx">{sfx.map(({ line, i }, n) => bubble(line, i, n % 2 === 1 ? ' bubble-tilt-right' : ''))}</div>}
      {belowPlaced.length > 0 && <MergedBubbles groups={belowPlaced} lookOf={lookOf} />}
      {placed.length > 0 && <div className="dialogue-placed">{placed.map(({ line, i }) => bubble(line, i))}</div>}
    </div>
  )
}
