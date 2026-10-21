import Markdown from 'react-markdown'

export interface AssistantMessageProps {
  text: string
  /** True while the text is still arriving; shown as plain text so half-written markdown does not jump around. */
  streaming?: boolean
}

/** Markdown only: `react-markdown` ignores raw HTML unless a plugin enables it, and none is installed. Images are dropped (the model must not trigger loads). */
export function AssistantMessage({ text, streaming = false }: AssistantMessageProps) {
  return (
    <div className="message message-assistant" data-testid="message-assistant" data-streaming={streaming ? 'true' : undefined}>
      {streaming ? <p className="streaming-text">{text}</p> : <Markdown disallowedElements={['img']}>{text}</Markdown>}
    </div>
  )
}
