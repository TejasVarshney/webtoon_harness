import type { MergedLook } from './bubble-merge'
import { BODY_VIEW_BOX, BodyArt, type BodyPass } from './BubbleBody'
import type { MergedGroup, MergedMember } from './use-merged-bubbles'

// The bodies of bubbles that overlap, drawn together so that they read as one balloon: every outline of a group first,
// then every fill on top, so each fill covers the outlines crossing it. It has to be one layer: each placed bubble is
// its own stacking context, so a bubble's outline could not sit under another bubble's fill. It goes under the layers
// that hold its members' text, so no fill can cover their lettering.

/** A radius less the part of the outline inside it. Never negative: the outline can be wider than a small bubble. */
const inset = (radius: number, by: number): number => Math.max(radius - by, 0)

function Pass({ member, look, pass }: { member: MergedMember; look: MergedLook; pass: BodyPass }) {
  const { left: x, top: y, width: w, height: h } = member
  const { shape, fill, stroke, strokeWidth: s } = look
  // With no outline there is nothing to draw, and a full-size shape in its colour would show at the fill's soft edge.
  if (pass === 'outline' && s === 0) return null
  if (shape === 'speech' || shape === 'whisper') {
    const oval = { cx: x + w / 2, cy: y + h / 2 }
    if (pass === 'fill') return <ellipse {...oval} rx={inset(w / 2, s)} ry={inset(h / 2, s)} fill={fill} />
    if (shape === 'speech') return <ellipse {...oval} rx={w / 2} ry={h / 2} fill={stroke} />
    return <ellipse {...oval} rx={inset(w / 2, s / 2)} ry={inset(h / 2, s / 2)} fill={fill} stroke={stroke} strokeWidth={s} strokeDasharray="4 3" />
  }
  // A shape's outline is centred on its edge and the fill covers the inner half, so these are twice the visible width.
  const paint =
    pass === 'fill'
      ? { fill, stroke: 'none' }
      : { fill: shape === 'thought' ? stroke : fill, stroke, strokeWidth: (shape === 'thought' ? 2.5 : 3) * s, strokeLinejoin: 'round' as const }
  return (
    <svg x={x} y={y} width={w} height={h} viewBox={BODY_VIEW_BOX[shape]} preserveAspectRatio="none" overflow="visible" {...paint}>
      <BodyArt shape={shape} pass={pass} />
    </svg>
  )
}

export interface MergedBubblesProps {
  groups: MergedGroup[]
  /** Null for a line that has gone or can no longer merge since the groups were measured, which is put right before paint. */
  lookOf(index: number): MergedLook | null
}

export function MergedBubbles({ groups, lookOf }: MergedBubblesProps) {
  const passes = (group: MergedGroup, pass: BodyPass) =>
    group.map((member) => {
      const look = lookOf(member.index)
      return look && <Pass key={`${pass}-${member.index}`} member={member} look={look} pass={pass} />
    })
  return (
    <svg className="dialogue-merge" aria-hidden="true">
      {groups.map((group) => (
        <g key={group[0].index}>
          {passes(group, 'outline')}
          {passes(group, 'fill')}
        </g>
      ))}
    </svg>
  )
}
