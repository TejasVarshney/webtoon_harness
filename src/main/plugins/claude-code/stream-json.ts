/** What the Claude Code backend needs from `claude -p --output-format stream-json --verbose --include-partial-messages`. */
export type ClaudeStreamEvent =
  | { kind: 'init'; sessionId: string }
  | { kind: 'text-delta'; text: string }
  /** The text blocks of one finished assistant message, joined; '' when it had only tool_use blocks. */
  | { kind: 'assistant-text'; text: string }
  | { kind: 'result'; ok: boolean; subtype: string; text: string; sessionId: string }

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown): string => (typeof value === 'string' ? value : '')

function toEvent(line: Json): ClaudeStreamEvent | null {
  // Output of a sub-agent is not part of the conversation the user sees.
  if (line.parent_tool_use_id) return null
  switch (line.type) {
    case 'system':
      return line.subtype === 'init' ? { kind: 'init', sessionId: str(line.session_id) } : null
    case 'stream_event': {
      const event = line.event
      if (!isObject(event) || event.type !== 'content_block_delta' || !isObject(event.delta)) return null
      return event.delta.type === 'text_delta' ? { kind: 'text-delta', text: str(event.delta.text) } : null
    }
    case 'assistant': {
      const content = isObject(line.message) ? line.message.content : null
      if (!Array.isArray(content)) return null
      const text = content.map((block) => (isObject(block) && block.type === 'text' ? str(block.text) : '')).join('')
      return { kind: 'assistant-text', text }
    }
    case 'result': {
      const subtype = str(line.subtype)
      // A failed run can still report subtype "success" (for example an expired sign-in), so is_error decides too.
      return { kind: 'result', ok: subtype === 'success' && line.is_error !== true, subtype, text: str(line.result), sessionId: str(line.session_id) }
    }
    default:
      return null
  }
}

/**
 * Turns the child process's stdout into events. Chunks may split lines and multi-byte characters anywhere;
 * unknown event types and lines that are not JSON objects are skipped.
 */
export class StreamJsonParser {
  private readonly decoder = new TextDecoder()
  private pending = ''

  push(chunk: Buffer): ClaudeStreamEvent[] {
    this.pending += this.decoder.decode(chunk, { stream: true })
    const lines = this.pending.split('\n')
    this.pending = lines.pop() ?? ''
    return this.parseLines(lines)
  }

  end(): ClaudeStreamEvent[] {
    const rest = this.pending + this.decoder.decode()
    this.pending = ''
    return this.parseLines([rest])
  }

  private parseLines(lines: string[]): ClaudeStreamEvent[] {
    const events: ClaudeStreamEvent[] = []
    for (const raw of lines) {
      const text = raw.trim()
      if (!text) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        continue
      }
      const event = isObject(parsed) ? toEvent(parsed) : null
      if (event) events.push(event)
    }
    return events
  }
}
