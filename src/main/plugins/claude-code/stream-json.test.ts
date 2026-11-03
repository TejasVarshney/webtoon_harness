import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { StreamJsonParser, type ClaudeStreamEvent } from './stream-json'

// hello.jsonl and tool.jsonl follow the `claude -p --output-format stream-json --verbose --include-partial-messages`
// shape: their init/status/result events are modelled on a real 2.1.309 run, and auth-failed.jsonl is a real capture.
// The model output inside hello/tool is hand-written (the recording machine was not signed in).
const fixture = (name: string): Buffer => readFileSync(path.resolve(__dirname, 'fixtures', name))

const SESSION_ID = '4548b1af-b0a3-40af-a149-9f9459fabaab'

const parseWhole = (buf: Buffer): ClaudeStreamEvent[] => {
  const parser = new StreamJsonParser()
  return [...parser.push(buf), ...parser.end()]
}

const parseByteByByte = (buf: Buffer): ClaudeStreamEvent[] => {
  const parser = new StreamJsonParser()
  const events: ClaudeStreamEvent[] = []
  for (let i = 0; i < buf.length; i++) events.push(...parser.push(buf.subarray(i, i + 1)))
  return [...events, ...parser.end()]
}

const jsonl = (...lines: unknown[]): Buffer => Buffer.from(lines.map((l) => JSON.stringify(l)).join('\n') + '\n')

describe('StreamJsonParser', () => {
  it('turns a plain reply into init, text deltas, one assistant text and an ok result', () => {
    const events = parseWhole(fixture('hello.jsonl'))
    expect(events[0]).toEqual({ kind: 'init', sessionId: SESSION_ID })
    const deltas = events.filter((e) => e.kind === 'text-delta')
    expect(deltas.length).toBeGreaterThanOrEqual(1)
    expect(deltas.map((e) => (e as { text: string }).text).join('')).toBe('Hi there → friend!')
    expect(events.filter((e) => e.kind === 'assistant-text')).toEqual([{ kind: 'assistant-text', text: 'Hi there → friend!' }])
    expect(events.at(-1)).toEqual({ kind: 'result', ok: true, subtype: 'success', text: 'Hi there → friend!', sessionId: SESSION_ID })
  })

  it('reports an empty assistant text for the message that only calls a tool', () => {
    const events = parseWhole(fixture('tool.jsonl'))
    expect(events.filter((e) => e.kind === 'assistant-text')).toEqual([
      { kind: 'assistant-text', text: '' },
      { kind: 'assistant-text', text: 'done.' }
    ])
    expect(events.at(-1)).toMatchObject({ kind: 'result', ok: true, text: 'done.' })
  })

  it('gives the same events when fed one byte at a time, with a multi-byte character split across chunks', () => {
    for (const name of ['hello.jsonl', 'tool.jsonl', 'auth-failed.jsonl']) {
      const buf = fixture(name)
      expect(parseByteByByte(buf)).toEqual(parseWhole(buf))
    }
    const arrow = Buffer.from('→')
    expect(arrow.length).toBe(3)
    const line = jsonl({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'a→b' } } })
    const cut = line.indexOf(arrow) + 1
    const parser = new StreamJsonParser()
    expect(parser.push(line.subarray(0, cut))).toEqual([])
    expect(parser.push(line.subarray(cut))).toEqual([{ kind: 'text-delta', text: 'a→b' }])
  })

  it('marks a result with is_error as not ok even though its subtype is success (real auth failure)', () => {
    const events = parseWhole(fixture('auth-failed.jsonl'))
    expect(events[0]).toMatchObject({ kind: 'init' })
    expect(events.at(-1)).toEqual({
      kind: 'result',
      ok: false,
      subtype: 'success',
      text: 'Failed to authenticate: OAuth session expired and could not be refreshed',
      sessionId: SESSION_ID
    })
  })

  it('maps error result subtypes to ok false', () => {
    const events = parseWhole(jsonl({ type: 'result', subtype: 'error_max_turns', is_error: true, session_id: 's1' }))
    expect(events).toEqual([{ kind: 'result', ok: false, subtype: 'error_max_turns', text: '', sessionId: 's1' }])
  })

  it('skips garbage lines, blank lines and unknown event types', () => {
    const lines = [
      'this is not json',
      '',
      '{"type":"rate_limit_event"}',
      '{"type":"system","subtype":"status"}',
      '{"type":"stream_event","event":{"type":"message_stop"}}',
      '[1,2,3]',
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' })
    ]
    expect(parseWhole(Buffer.from(lines.join('\r\n') + '\n'))).toEqual([{ kind: 'init', sessionId: 's1' }])
  })

  it('flushes a final line that has no trailing newline on end()', () => {
    const parser = new StreamJsonParser()
    expect(parser.push(Buffer.from(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' })))).toEqual([])
    expect(parser.end()).toEqual([{ kind: 'init', sessionId: 's1' }])
  })

  it('joins the text blocks of one assistant message and ignores its tool_use blocks', () => {
    const message = {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'a' }, { type: 'tool_use', id: 't', name: 'x', input: {} }, { type: 'text', text: 'b' }] }
    }
    expect(parseWhole(jsonl(message))).toEqual([{ kind: 'assistant-text', text: 'ab' }])
  })

  it('ignores messages from sub-agents (parent_tool_use_id set)', () => {
    const events = parseWhole(
      jsonl(
        { type: 'assistant', parent_tool_use_id: 'toolu_9', message: { content: [{ type: 'text', text: 'inner' }] } },
        { type: 'stream_event', parent_tool_use_id: 'toolu_9', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'inner' } } }
      )
    )
    expect(events).toEqual([])
  })
})
