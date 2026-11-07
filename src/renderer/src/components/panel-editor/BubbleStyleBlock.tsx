import { AlignCenter, AlignLeft, AlignRight, Bold, CaseUpper, Italic } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import type { BubbleShape, BubbleStyle, DialogueLine } from '@shared/types'
import { Field } from '../characters/controls'
import { bubbleDefaults, FONTS, withStyleChange } from '../visualizer/bubble-style'
import { hasTail } from '../visualizer/bubble-tail'

export interface BubbleStyleBlockProps {
  /** The shape the line gets with no style: from its kind and text. */
  autoShape: BubbleShape
  style: BubbleStyle | null
  tail: DialogueLine['tail']
  onStyle(next: BubbleStyle | null): void
  onTail(next: 'none' | null): void
}

/** The shapes to choose from, each drawn small in a 24 x 16 box. Strokes use the button's colour. */
const SHAPES: { id: BubbleShape; label: string; glyph: ReactNode }[] = [
  {
    id: 'speech',
    label: 'Speech',
    glyph: <ellipse cx="12" cy="8" rx="9" ry="6" />
  },
  {
    id: 'shout',
    label: 'Shout',
    glyph: <path d="M12 1l2.2 4.2 4.8-1.6-1.4 4.6 4.4 2.3-4.6 1.7.9 4.8L12 13.6 7.7 16l.9-4.8L4 9.5l4.4-2.3L7 2.6l4.8 1.6z" />
  },
  {
    id: 'whisper',
    label: 'Whisper',
    glyph: <ellipse cx="12" cy="8" rx="9" ry="6" strokeDasharray="2.5 2" />
  },
  {
    id: 'thought',
    label: 'Thought',
    glyph: <path d="M7 12.5a4 4 0 0 1-.5-7.3 4.5 4.5 0 0 1 8-1.2 4 4 0 0 1 3.5 5.7 3.5 3.5 0 0 1-3.3 3.3z" />
  },
  {
    id: 'caption',
    label: 'Caption',
    glyph: <rect x="3" y="3.5" width="18" height="9" />
  },
  {
    id: 'sfx',
    label: 'Sound effect',
    glyph: <path d="M3 12l3-8 3 6 3-8 3 8 3-6 3 8" />
  }
]

const ALIGNS = [
  { id: 'left', label: 'Left', Icon: AlignLeft },
  { id: 'center', label: 'Centre', Icon: AlignCenter },
  { id: 'right', label: 'Right', Icon: AlignRight }
] as const

/**
 * A line's look, set from its row: the shape and tail, the lettering, and the colours. Every control shows what the
 * bubble has now (the shape's default under the line's own style), and reports the style that results. A key put back
 * to its default is dropped, so a line is only ever styled by what was changed.
 */
export function BubbleStyleBlock({ autoShape, style, tail, onStyle, onTail }: BubbleStyleBlockProps) {
  const shape = style?.shape ?? autoShape
  const defaults = bubbleDefaults(shape)
  const look = { ...defaults, ...style }
  const change = (patch: Partial<BubbleStyle>): void => onStyle(withStyleChange(style, patch, defaults))
  const font = useRef<HTMLSelectElement>(null)

  /** The button goes with the style, and its focus would fall to the body, where the next Escape leaves the editor. */
  function reset(): void {
    font.current?.focus()
    onStyle(null)
  }

  function toggle(label: string, key: 'bold' | 'italic' | 'caps', icon: ReactNode) {
    return (
      <button type="button" className="icon-button" aria-label={label} title={label} aria-pressed={look[key]} onClick={() => change({ [key]: !look[key] })}>
        {icon}
      </button>
    )
  }

  return (
    <div className="bubble-style">
      <div className="bubble-style-line">
        <div className="bubble-style-group">
          <span className="bubble-style-label">Shape</span>
          <div className="bubble-style-buttons" role="group" aria-label="Shape">
            <button type="button" aria-pressed={style?.shape === undefined} onClick={() => onStyle(withStyleChange(style, { shape: undefined }, bubbleDefaults(autoShape)))}>
              Auto
            </button>
            {SHAPES.map((s) => (
              <button
                key={s.id}
                type="button"
                className="icon-button"
                aria-label={s.label}
                title={s.label}
                aria-pressed={style?.shape === s.id}
                onClick={() => onStyle(withStyleChange(style, { shape: s.id }, bubbleDefaults(s.id)))}
              >
                <svg width="24" height="16" viewBox="0 0 24 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
                  {s.glyph}
                </svg>
              </button>
            ))}
          </div>
        </div>
        {hasTail(shape) && (
          <div className="bubble-style-group bubble-style-tail">
            <span className="bubble-style-label">Tail</span>
            <div className="bubble-style-buttons" role="group" aria-label="Tail">
              <button type="button" aria-pressed={tail === null} onClick={() => onTail(null)}>
                Auto
              </button>
              <button type="button" aria-pressed={tail === 'none'} onClick={() => onTail('none')}>
                None
              </button>
            </div>
            <span className="bubble-style-hint">
              {tail !== null && tail !== 'none' ? `Points at ${Math.round(tail.x * 100)}% across, ${Math.round(tail.y * 100)}% down.` : 'Drag the dot on the panel to point it.'}
            </span>
          </div>
        )}
      </div>

      <div className="bubble-style-line">
        <Field label="Font">
          {(id) => (
            <select ref={font} id={id} value={look.font} onChange={(e) => change({ font: e.target.value as BubbleStyle['font'] })}>
              {FONTS.map((f) => (
                <option key={f.id} value={f.id} style={{ fontFamily: f.family }}>
                  {f.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Size">
          {(id) => (
            <span className="bubble-style-slider">
              <input id={id} type="range" min={50} max={300} step={5} value={Math.round(look.size * 100)} onChange={(e) => change({ size: Number(e.target.value) / 100 })} />
              <output htmlFor={id}>{`${Math.round(look.size * 100)}%`}</output>
            </span>
          )}
        </Field>
        <div className="bubble-style-buttons" role="group" aria-label="Lettering">
          {toggle('Bold', 'bold', <Bold size={16} aria-hidden="true" />)}
          {toggle('Italic', 'italic', <Italic size={16} aria-hidden="true" />)}
          {toggle('Capitals', 'caps', <CaseUpper size={16} aria-hidden="true" />)}
        </div>
        <div className="bubble-style-buttons" role="group" aria-label="Alignment">
          {ALIGNS.map(({ id, label, Icon }) => (
            <button key={id} type="button" className="icon-button" aria-label={label} title={label} aria-pressed={look.align === id} onClick={() => change({ align: id })}>
              <Icon size={16} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      <div className="bubble-style-line">
        <Field label="Text colour">{(id) => <input id={id} type="color" value={look.color} onChange={(e) => change({ color: e.target.value })} />}</Field>
        {shape !== 'sfx' && <Field label="Fill">{(id) => <input id={id} type="color" value={look.fill} onChange={(e) => change({ fill: e.target.value })} />}</Field>}
        <Field label="Outline">{(id) => <input id={id} type="color" value={look.stroke} onChange={(e) => change({ stroke: e.target.value })} />}</Field>
        {shape !== 'sfx' && (
          <Field label="Outline width">
            {(id) => (
              <span className="bubble-style-slider">
                <input id={id} type="range" min={0} max={6} step={1} value={look.strokeWidth} onChange={(e) => change({ strokeWidth: Number(e.target.value) })} />
                <output htmlFor={id}>{`${look.strokeWidth} px`}</output>
              </span>
            )}
          </Field>
        )}
        {style !== null && (
          <button type="button" className="bubble-style-reset" onClick={reset}>
            Reset style
          </button>
        )}
      </div>
    </div>
  )
}
