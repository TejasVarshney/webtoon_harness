import { useEffect, useMemo, useRef } from 'react'
import { assetUrl } from '@shared/asset-url'
import type { ToolResult } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { useChatStore } from '../../stores/chat-store'
import { AssistantMessage } from './AssistantMessage'
import { ToolCallCard } from './ToolCallCard'

const NO_MESSAGES: never[] = []

export interface MessageListProps {
  threadKey: string
  /** What an empty thread says: a title line and a hint under it. */
  emptyTitle?: string
  emptyHint?: string
}

/** Renders one thread (the main chat, or a panel side chat). User messages show text and images only, never the state snapshot. */
export function MessageList({
  threadKey,
  emptyTitle = 'Start with the premise, a character or the next scene.',
  emptyHint = 'The agent writes the story bible, designs the cast and draws the panels into the strip on the right.'
}: MessageListProps) {
  const messages = useChatStore((s) => s.messages[threadKey] ?? NO_MESSAGES)
  const streaming = useChatStore((s) => s.streaming[threadKey] ?? '')
  const notices = useChatStore((s) => s.notices[threadKey] ?? NO_MESSAGES)
  const projectId = useAppStore((s) => s.projectId)
  const endRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => {
    const byCall = new Map<string, ToolResult>()
    for (const m of messages) if (m.role === 'tool') for (const r of m.results) byCall.set(r.toolCallId, r)
    return byCall
  }, [messages])

  useEffect(() => {
    // jsdom has no scrollIntoView.
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [messages, streaming, notices])

  return (
    <div className="message-list" data-testid="message-list">
      <div className="thread">
        {messages.length === 0 && streaming === '' && notices.length === 0 && (
          <div className="thread-empty">
            <p className="thread-empty-title">{emptyTitle}</p>
            <p className="placeholder">{emptyHint}</p>
          </div>
        )}
        {messages.map((m) => {
          if (m.role === 'user') {
            return (
              <div key={m.id} className="message message-user" data-testid="message-user">
                {m.text !== '' && <p>{m.text}</p>}
                {projectId !== null && m.imagePaths.length > 0 && (
                  <div className="message-images">
                    {m.imagePaths.map((rel) => (
                      <img key={rel} src={assetUrl(projectId, rel)} alt="" />
                    ))}
                  </div>
                )}
              </div>
            )
          }
          if (m.role === 'assistant') {
            return (
              <div key={m.id} className="assistant-turn">
                {m.text.trim() !== '' && <AssistantMessage text={m.text} />}
                {m.toolCalls.map((call) => (
                  <ToolCallCard key={call.id} call={call} result={results.get(call.id)} projectId={projectId} />
                ))}
              </div>
            )
          }
          // Tool results are shown inside the card of the call they answer.
          return null
        })}
        {streaming !== '' && <AssistantMessage text={streaming} streaming />}
        {notices.map((n) => (
          <p key={n.id} role="alert" className="error notice">
            {n.text}
          </p>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  )
}
