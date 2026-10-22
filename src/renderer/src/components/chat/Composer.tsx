import { useState, type KeyboardEvent } from 'react'
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
}

export function Composer({ onSend, running, onStop, value, onValueChange, allowAttach = true }: ComposerProps) {
  const projectId = useAppStore((s) => s.projectId)
  const [ownText, setOwnText] = useState('')
  const text = value ?? ownText
  function setText(next: string): void {
    if (value === undefined) setOwnText(next)
    onValueChange?.(next)
  }
  const [images, setImages] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

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
    <div className="composer">
      {images.length > 0 && (
        <ul className="composer-attachments">
          {images.map((p) => (
            <li key={p}>
              <span>{p.split('/').pop()}</span>
              <button type="button" aria-label={`Remove ${p}`} onClick={() => setImages((prev) => prev.filter((x) => x !== p))}>
                x
              </button>
            </li>
          ))}
        </ul>
      )}
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="composer-row">
        {allowAttach && (
          <button type="button" data-testid="composer-attach" aria-label="Attach images" disabled={projectId === null} onClick={() => void attach()}>
            Attach
          </button>
        )}
        <textarea
          data-testid="composer-input"
          aria-label="Message"
          rows={2}
          placeholder="Message the agent. Enter to send, Shift+Enter for a new line."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {running ? (
          <button type="button" data-testid="composer-stop" onClick={onStop}>
            Stop
          </button>
        ) : (
          <button type="button" data-testid="composer-send" disabled={!canSend} onClick={send}>
            Send
          </button>
        )}
      </div>
    </div>
  )
}
