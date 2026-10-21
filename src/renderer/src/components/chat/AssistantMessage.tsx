import type { ReactNode } from 'react'
import Markdown from 'react-markdown'

/**
 * Model-authored links must never navigate the privileged window. http(s) links go through `window.open`,
 * which the main process denies and forwards to the system browser; anything else is plain text.
 */
function SafeLink({ href, children }: { href?: string; children?: ReactNode }) {
  if (href === undefined || !/^https?:\/\//i.test(href)) return <span>{children}</span>
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault()
        window.open(href)
      }}
    >
      {children}
    </a>
  )
}

export interface AssistantMessageProps {
  text: string
  /** True while the text is still arriving; shown as plain text so half-written markdown does not jump around. */
  streaming?: boolean
}

/** Markdown only: `react-markdown` ignores raw HTML unless a plugin enables it, and none is installed. Images are dropped (the model must not trigger loads). */
export function AssistantMessage({ text, streaming = false }: AssistantMessageProps) {
  return (
    <div className="message message-assistant" data-testid="message-assistant" data-streaming={streaming ? 'true' : undefined}>
      {streaming ? <p className="streaming-text">{text}</p> : <Markdown disallowedElements={['img']} components={{ a: SafeLink }}>{text}</Markdown>}
    </div>
  )
}
