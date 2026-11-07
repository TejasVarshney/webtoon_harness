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
  const menu = useRef<HTMLDivElement>(null)
  /** Where the open menu sits: fixed to the window, its bottom edge just above the button, so the stage's clip cannot cut it. */
  const [spot, setSpot] = useState<{ left: number; bottom: number } | null>(null)

  function toggle(): void {
    const rect = button.current?.getBoundingClientRect()
    if (!open && rect) setSpot({ left: rect.left, bottom: window.innerHeight - rect.top + 4 })
    setOpen(!open)
  }

  // A press anywhere else closes it. Native and in the capture phase, since the zoom bar stops React's presses. The
  // menu stays where the button was when it opened, so a resize closes it rather than tracking the button.
  useEffect(() => {
    if (!open) return
    function onPress(e: PointerEvent): void {
      if (!(e.target instanceof Node) || !root.current?.contains(e.target)) setOpen(false)
    }
    const close = (): void => setOpen(false)
    document.addEventListener('pointerdown', onPress, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onPress, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  // The first choice takes the focus when the menu opens, and only then.
  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true })
  }, [open])

  return (
    <div
      ref={root}
      className="stage-add"
      onBlur={(e) => {
        // Focus leaving the button and its menu closes it, so a later Escape is the workspace's.
        if (!(e.relatedTarget instanceof Node && root.current?.contains(e.relatedTarget))) setOpen(false)
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || !open) return
        // Closing the menu is all Escape does here: the workspace would otherwise take it as "go back".
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
        button.current?.focus()
      }}
    >
      <button ref={button} type="button" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={toggle}>
        <MessageSquarePlus size={16} aria-hidden="true" />
        Add bubble
      </button>
      {open && (
        <div ref={menu} className="context-menu" role="menu" aria-label="Add bubble" style={spot ?? undefined}>
          {CHOICES.map(({ shape, label }) => (
            <button
              key={shape}
              type="button"
              role="menuitem"
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
