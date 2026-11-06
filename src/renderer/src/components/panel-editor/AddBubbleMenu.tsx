import { useEffect, useRef, useState } from 'react'
import { MessageSquarePlus } from 'lucide-react'
import type { BubbleShape } from '@shared/types'

const CHOICES: { shape: BubbleShape; label: string }[] = [
  { shape: 'speech', label: 'Speech' },
  { shape: 'shout', label: 'Shout' },
  { shape: 'whisper', label: 'Whisper' },
  { shape: 'thought', label: 'Thought' },
  { shape: 'caption', label: 'Caption' },
  { shape: 'sfx', label: 'Sound effect' }
]

export interface AddBubbleMenuProps {
  /** Off while a new bubble is being typed. */
  disabled: boolean
  onAdd(shape: BubbleShape): void
}

/** The Add bubble button beside the stage's zoom bar, and its menu of the six shapes, opening upward. */
export function AddBubbleMenu({ disabled, onAdd }: AddBubbleMenuProps) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  // A press anywhere else closes it. Native and in the capture phase, since the zoom bar stops React's presses.
  useEffect(() => {
    if (!open) return
    function onPress(e: PointerEvent): void {
      if (!(e.target instanceof Node) || !root.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPress, true)
    return () => document.removeEventListener('pointerdown', onPress, true)
  }, [open])

  // The menu is closed when the button goes off, so a choice never lands while a bubble is being typed.
  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  return (
    <div
      ref={root}
      className="stage-add"
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !open) return
        // Closing the menu is all Escape does here: the workspace would otherwise take it as "go back".
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        button.current?.focus()
      }}
    >
      <button ref={button} type="button" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen((o) => !o)}>
        <MessageSquarePlus size={16} aria-hidden="true" />
        Add bubble
      </button>
      {open && (
        <div className="context-menu" role="menu" aria-label="Add bubble">
          {CHOICES.map(({ shape, label }, i) => (
            <button
              key={shape}
              type="button"
              role="menuitem"
              ref={i === 0 ? (el) => el?.focus({ preventScroll: true }) : undefined}
              onClick={() => {
                setOpen(false)
                onAdd(shape)
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
