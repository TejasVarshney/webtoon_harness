import { useEffect, useRef, useState } from 'react'
import { stripBackgroundStyle, effectiveBackground } from '@shared/strip-background'
import type { PlacedPanel } from '@shared/strip-canvas'
import type { Episode, StripBackground } from '@shared/types'
import { usePanelsStore } from '../../stores/panels-store'
import { errorText } from '../characters/controls'
import { COLOR_PRESETS, GRADIENT_PRESETS } from './background-presets'
import { ToolPopover } from './PanelTools'

/** How long after the last change the background is saved. */
const SAVE_DELAY_MS = 300
const MAX_STOPS = 12
const HEX = /^#[0-9a-f]{6}$/i

type Kind = StripBackground['kind']
type Gradient = Extract<StripBackground, { stops: unknown }>

const KINDS: { kind: Kind; label: string }[] = [
  { kind: 'solid', label: 'Color' },
  { kind: 'linear', label: 'Linear' },
  { kind: 'radial', label: 'Radial' },
  { kind: 'conic', label: 'Conic' },
  { kind: 'image', label: 'Image' }
]

/** The colour a background is mostly about, which another kind starts from. */
function mainColor(bg: StripBackground): string {
  return bg.kind === 'solid' || bg.kind === 'image' ? bg.color : bg.stops[0].color
}

/** A second colour for a gradient made from one: white, or black when the colour is white already. */
function partner(color: string): string {
  return color.toLowerCase() === '#ffffff' ? '#000000' : '#ffffff'
}

/** A colour input and a hex field for one colour: the input picks, the field takes any colour typed or pasted. */
function ColourField({ colourLabel, hexLabel, value, onChange }: { colourLabel: string; hexLabel: string; value: string; onChange(color: string): void }) {
  const [text, setText] = useState(value)
  const [invalid, setInvalid] = useState(false)
  // A colour chosen elsewhere (the picker, a preset) is what the field shows.
  useEffect(() => {
    setText((now) => (HEX.test(now) && now.toLowerCase() === value.toLowerCase() ? now : value))
    setInvalid(false)
  }, [value])

  function type(next: string): void {
    setText(next)
    const ok = HEX.test(next)
    setInvalid(!ok)
    if (ok) onChange(next)
  }

  return (
    <span className="bg-colour">
      <input type="color" aria-label={colourLabel} value={value} onChange={(e) => onChange(e.target.value)} />
      <input
        type="text"
        className="bg-hex"
        aria-label={hexLabel}
        aria-invalid={invalid}
        spellCheck={false}
        maxLength={7}
        value={text}
        onChange={(e) => type(e.target.value)}
        onBlur={() => {
          setText(value)
          setInvalid(false)
        }}
      />
      {invalid && <span className="error bg-error">Enter a colour as #rrggbb</span>}
    </span>
  )
}

interface NumberFieldProps {
  label: string
  value: number | null
  min: number
  max: number
  /** An empty field means `null`. */
  nullable?: boolean
  placeholder?: string
  message: string
  onChange(value: number | null): void
}

/** A number typed in a field that keeps what is typed while it is not yet a valid value, so "100" passes through "1". */
function NumberField({ label, value, min, max, nullable = false, placeholder, message, onChange }: NumberFieldProps) {
  const show = (v: number | null): string => (v === null ? '' : String(v))
  const [text, setText] = useState(show(value))
  const [invalid, setInvalid] = useState(false)
  useEffect(() => {
    setText((now) => (now.trim() !== '' && Number(now) === value ? now : show(value)))
    setInvalid(false)
  }, [value])

  function type(next: string): void {
    setText(next)
    if (next.trim() === '' && nullable) {
      setInvalid(false)
      onChange(null)
      return
    }
    const n = Number(next)
    const ok = next.trim() !== '' && Number.isFinite(n) && n >= min && n <= max
    setInvalid(!ok)
    if (ok) onChange(n)
  }

  return (
    <label className="bg-number">
      <span>{label}</span>
      <input type="number" min={min} max={max} placeholder={placeholder} aria-invalid={invalid} value={text} onChange={(e) => type(e.target.value)} />
      {invalid && <span className="error bg-error">{message}</span>}
    </label>
  )
}

export interface BackgroundEditorProps {
  episode: Episode
  /** The strip as laid out, which an episode with no background of its own reads its old gutters from. */
  placed: PlacedPanel[]
  /** The button that opened it, which the popover sits beside. */
  anchor: Element
  /** `focusBack` says the focus should return to the button. */
  onClose(focusBack: boolean): void
}

/**
 * Edits the episode's strip background in a popover: a colour, a gradient (linear, radial or conic, any number of
 * stops) or an image. The strip shows each change at once (the panels store's `backgroundPreview`), and one save
 * follows 300 ms after the last change. A save that fails keeps the draft on the strip until it is changed or closed.
 */
export function BackgroundEditor({ episode, placed, anchor, onClose }: BackgroundEditorProps) {
  const [draft, setDraft] = useState<StripBackground>(() => effectiveBackground(episode.background, placed))
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const episodeId = useRef(episode.id)
  const timer = useRef<{ id: ReturnType<typeof setTimeout>; background: StripBackground } | null>(null)
  /** Only the newest save reports: an older one landing late says nothing about what the strip should show. */
  const latestSave = useRef(0)
  const open = useRef(true)

  /** Stops showing `background` on the strip, if it still is what the strip shows. */
  function release(background: StripBackground): void {
    usePanelsStore.setState((s) => (s.backgroundPreview?.background === background ? { backgroundPreview: null } : {}))
  }

  function save(background: StripBackground): void {
    const mine = ++latestSave.current
    usePanelsStore
      .getState()
      .setBackground(episodeId.current, background)
      .then(
        () => {
          if (mine === latestSave.current) release(background)
        },
        (e: unknown) => {
          if (mine === latestSave.current && open.current) setError(errorText(e))
        }
      )
  }

  function change(next: StripBackground): void {
    setDraft(next)
    setError(null)
    usePanelsStore.getState().setBackgroundPreview({ episodeId: episodeId.current, background: next })
    if (timer.current !== null) clearTimeout(timer.current.id)
    const id = setTimeout(() => {
      timer.current = null
      save(next)
    }, SAVE_DELAY_MS)
    timer.current = { id, background: next }
  }

  // Closing keeps a change still waiting (it is saved now, and the strip shows it until it lands) and drops the preview.
  useEffect(() => {
    open.current = true
    return () => {
      open.current = false
      const waiting = timer.current
      timer.current = null
      if (waiting === null) {
        usePanelsStore.setState((s) => (s.backgroundPreview?.episodeId === episodeId.current ? { backgroundPreview: null } : {}))
        return
      }
      clearTimeout(waiting.id)
      usePanelsStore
        .getState()
        .setBackground(episodeId.current, waiting.background)
        .then(undefined, () => undefined)
        .then(() => release(waiting.background))
    }
  }, [])

  async function chooseImage(): Promise<void> {
    // A change still waiting would save over the image once it is picked.
    if (timer.current !== null) clearTimeout(timer.current.id)
    timer.current = null
    setPicking(true)
    setError(null)
    try {
      const updated = await usePanelsStore.getState().pickBackgroundImage(episodeId.current)
      if (updated?.background?.kind === 'image' && open.current) {
        setDraft(updated.background)
        usePanelsStore.setState((s) => (s.backgroundPreview?.episodeId === episodeId.current ? { backgroundPreview: null } : {}))
      }
    } catch (e) {
      if (open.current) setError(errorText(e))
    } finally {
      if (open.current) setPicking(false)
    }
  }

  function switchKind(kind: Kind): void {
    if (kind === draft.kind) return
    const color = mainColor(draft)
    if (kind === 'image') {
      // A gradient's first colour would veil the picture in black or whatever it began with: white is the neutral one.
      if (episode.backgroundImage === null) void chooseImage()
      else change({ kind: 'image', path: episode.backgroundImage, fit: 'width', opacity: 1, color: draft.kind === 'solid' ? color : '#ffffff' })
      return
    }
    if (kind === 'solid') {
      change({ kind: 'solid', color })
      return
    }
    const stops = 'stops' in draft ? draft.stops : [{ color, at: 0 }, { color: partner(color), at: 1 }]
    const repeatEvery = 'repeatEvery' in draft ? draft.repeatEvery : null
    const angle = 'angle' in draft ? draft.angle : kind === 'linear' ? 180 : 0
    change(kind === 'radial' ? { kind, stops, repeatEvery } : { kind, stops, repeatEvery, angle })
  }

  function setStops(stops: Gradient['stops']): void {
    if (draft.kind === 'solid' || draft.kind === 'image') return
    change({ ...draft, stops })
  }

  const swatch = (bg: StripBackground): Record<string, string> => stripBackgroundStyle(bg, { imageUrl: null, bottom: 36 })

  return (
    <ToolPopover label="Background" anchor={anchor} onClose={onClose}>
      <div className="background-editor">
        <div className="bg-kinds" role="radiogroup" aria-label="Kind">
          {KINDS.map(({ kind, label }) => (
            <button key={kind} type="button" role="radio" aria-label={label} aria-checked={draft.kind === kind} disabled={picking} onClick={() => switchKind(kind)}>
              {label}
            </button>
          ))}
        </div>

        {draft.kind === 'solid' && (
          <>
            <ColourField colourLabel="Colour" hexLabel="Colour hex" value={draft.color} onChange={(color) => change({ kind: 'solid', color })} />
            <div className="bg-swatches">
              {COLOR_PRESETS.map((color) => (
                <button key={color} type="button" className="bg-swatch" aria-label={color} title={color} style={{ background: color }} onClick={() => change({ kind: 'solid', color })} />
              ))}
            </div>
          </>
        )}

        {draft.kind !== 'solid' && draft.kind !== 'image' && (
          <>
            <div className="bg-stops">
              {draft.stops.map((stop, i) => (
                <div key={i} className="bg-stop">
                  <ColourField
                    colourLabel={`Stop ${i + 1} colour`}
                    hexLabel={`Stop ${i + 1} hex`}
                    value={stop.color}
                    onChange={(color) => setStops(draft.stops.map((s, j) => (j === i ? { ...s, color } : s)))}
                  />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    aria-label={`Stop ${i + 1} position`}
                    value={Math.round(stop.at * 100)}
                    onChange={(e) => setStops(draft.stops.map((s, j) => (j === i ? { ...s, at: Number(e.target.value) / 100 } : s)))}
                  />
                  <button type="button" className="icon-button" aria-label={`Remove stop ${i + 1}`} disabled={draft.stops.length <= 2} onClick={() => setStops(draft.stops.filter((_, j) => j !== i))}>
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              disabled={draft.stops.length >= MAX_STOPS}
              onClick={() => {
                // Between the last two stops, in the last one's colour: a new stop that changes nothing until it is moved.
                const last = draft.stops[draft.stops.length - 1]
                const before = draft.stops[draft.stops.length - 2]
                setStops([...draft.stops, { color: last.color, at: Math.round(((last.at + before.at) / 2) * 100) / 100 }])
              }}
            >
              Add stop
            </button>
            <div className="bg-numbers">
              {draft.kind !== 'radial' && <NumberField label="Angle" value={draft.angle} min={0} max={360} message="Enter an angle from 0 to 360" onChange={(angle) => change({ ...draft, angle: angle ?? 0 })} />}
              <NumberField
                label="Repeat every (px)"
                value={draft.repeatEvery}
                min={20}
                max={20000}
                nullable
                placeholder="No repeat"
                message="Enter 20 to 20000, or leave it empty"
                onChange={(repeatEvery) => change({ ...draft, repeatEvery })}
              />
            </div>
            <div className="bg-presets" aria-label="Preset gradients">
              {GRADIENT_PRESETS.map((preset) => (
                <button key={preset.name} type="button" className="bg-preset" aria-label={preset.name} title={preset.name} onClick={() => change(preset.background)}>
                  <span className="bg-preset-art" style={swatch(preset.background)} />
                  <span>{preset.name}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {draft.kind === 'image' && (
          <>
            <p className="bg-image-name">{draft.path.split('/').pop()}</p>
            <button type="button" disabled={picking} onClick={() => void chooseImage()}>
              Choose another image
            </button>
            <label className="bg-number">
              <span>Fit</span>
              <select value={draft.fit} onChange={(e) => change({ ...draft, fit: e.target.value as typeof draft.fit })}>
                <option value="width">Fit to width</option>
                <option value="tile">Tile</option>
                <option value="stretch">Stretch</option>
              </select>
            </label>
            <label className="bg-number">
              <span>Opacity</span>
              <input type="range" min={0} max={100} step={1} value={Math.round(draft.opacity * 100)} onChange={(e) => change({ ...draft, opacity: Number(e.target.value) / 100 })} />
            </label>
            <div className="bg-number">
              <span>Colour behind the image</span>
              <ColourField colourLabel="Image colour" hexLabel="Image colour hex" value={draft.color} onChange={(color) => change({ ...draft, color })} />
            </div>
          </>
        )}

        {error !== null && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
    </ToolPopover>
  )
}
