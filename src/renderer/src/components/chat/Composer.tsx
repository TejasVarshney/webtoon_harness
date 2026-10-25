import { useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowUp, Paperclip, Square, X } from 'lucide-react'
import { api } from '../../api'
import { useAppStore } from '../../stores/app-store'

export interface ComposerProps {
  onSend(text: string, imagePaths: string[]): void
  running: boolean
  onStop(): void
  /** Controlled text. Without it the composer keeps its own. */
  value?: string
  onValueChange?(text: string): void
  /** Show the Attach button. Default true; a thread whose send has no room for images turns it off. */
  allowAttach?: boolean
  /** Controls set in the composer's footer, between Attach and Send (the main chat's model picker). */
  tools?: ReactNode
  placeholder?: string
}

/** The textarea grows with its text up to this height, then scrolls. */
const MAX_INPUT_HEIGHT = 240

export function Composer({
  onSend,
  running,
  onStop,
  value,
  onValueChange,
  allowAttach = true,
  tools,
  placeholder = 'Ask for the next scene, a character, a change…'
}: ComposerProps) {
  const projectId = useAppStore((s) => s.projectId)
  const [ownText, setOwnText] = useState('')
  const text = value ?? ownText
  function setText(next: string): void {
    if (value === undefined) setOwnText(next)
    onValueChange?.(next)
  }
  const [images, setImages] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = inputRef.current
    if (el === null) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`
    el.style.overflowY = el.scrollHeight > MAX_INPUT_HEIGHT ? 'auto' : 'hidden'
  }, [text])

  const canSend = !running && (text.trim() !== '' || images.length > 0)

  function send(): void {
    if (!canSend) return
    onSend(text.trim(), images)
    setText('')
    setImages([])
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    // `isComposing`: Enter confirms an IME candidate and must not send.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      send()
    }
  }

  async function attach(): Promise<void> {
    if (projectId === null) return
    setError(null)
    try {
      const { paths } = await api.invoke('uploads:pickImages', { projectId })
      setImages((prev) => [...prev, ...paths.filter((p) => !prev.includes(p))])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="composer" data-running={running ? 'true' : undefined}>
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {/* A click on the box's padding puts the caret in the text, as if the whole box were the field. */}
      <div
        className="composer-box"
        onMouseDown={(e) => {
          if (e.target !== e.currentTarget) return
          e.preventDefault()
          inputRef.current?.focus()
        }}
      >
        {images.length > 0 && (
          <ul className="composer-attachments">
            {images.map((p) => (
              <li key={p}>
                <span>{p.split('/').pop()}</span>
                <button type="button" className="icon-button" aria-label={`Remove ${p}`} onClick={() => setImages((prev) => prev.filter((x) => x !== p))}>
                  <X size={13} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={inputRef}
          data-testid="composer-input"
          aria-label="Message"
          rows={1}
          placeholder={placeholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="composer-footer">
          {allowAttach && (
            <button
              type="button"
              className="icon-button"
              data-testid="composer-attach"
              aria-label="Attach images"
              title="Attach images"
              disabled={projectId === null}
              onClick={() => void attach()}
            >
              <Paperclip size={16} aria-hidden="true" />
            </button>
          )}
          {tools}
          <span className="composer-spacer" />
          {running ? (
            <button type="button" className="send-button send-button-stop" data-testid="composer-stop" aria-label="Stop" title="Stop the agent" onClick={onStop}>
              <Square size={12} fill="currentColor" aria-hidden="true" />
            </button>
          ) : (
            <button type="button" className="send-button" data-testid="composer-send" aria-label="Send" title="Send (Enter)" disabled={!canSend} onClick={send}>
              <ArrowUp size={17} strokeWidth={2.25} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
