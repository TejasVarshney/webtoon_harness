import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ChatMessage } from '@shared/types'
import { loadMockScript, MockImageProvider, MockTextProvider, resetMockScripts } from './mock'
import type { TextTurnRequest } from './types'

const dir = mkdtempSync(join(tmpdir(), 'mock-script-'))
let n = 0
function writeScript(script: unknown): string {
  const p = join(dir, `script-${n++}.json`)
  writeFileSync(p, typeof script === 'string' ? script : JSON.stringify(script))
  return p
}

function req(text: string, signal: AbortSignal = new AbortController().signal): TextTurnRequest {
  const user: ChatMessage = {
    id: 'msg_0000000001',
    role: 'user',
    text,
    imagePaths: [],
    stateSnapshot: null,
    createdAt: '2026-01-01T00:00:00.000Z'
  }
  return { system: '', messages: [user], tools: [], loadImage: async () => ({ mime: 'image/png', base64: '' }), signal }
}

beforeEach(() => resetMockScripts())

describe('MockTextProvider', () => {
  it('plays the script then echoes', async () => {
    const p = new MockTextProvider(
      writeScript({ turns: [{ toolCalls: [{ name: 'list_characters', input: {} }] }, { text: 'Done.' }] })
    )
    const r1 = await p.runTurn(req('hi'))
    expect(r1).toMatchObject({ stopReason: 'tool_use', toolCalls: [{ id: 'mock_call_1', name: 'list_characters', input: {} }] })
    const deltas: string[] = []
    const r2 = await p.runTurn({ ...req('hi'), onTextDelta: (d) => deltas.push(d) })
    expect(r2).toMatchObject({ text: 'Done.', stopReason: 'end', toolCalls: [] })
    expect(deltas).toEqual(['Done.'])
    expect((await p.runTurn(req('again'))).text).toBe('(mock) again')
  })

  it('shares the cursor across instances and keeps call ids unique', async () => {
    const path = writeScript({ turns: [{ toolCalls: [{ name: 'a', input: {} }] }, { toolCalls: [{ name: 'b', input: {} }] }] })
    const a = await new MockTextProvider(path).runTurn(req('x'))
    const b = await new MockTextProvider(path).runTurn(req('x'))
    expect(a.toolCalls[0].id).toBe('mock_call_1')
    expect(b.toolCalls[0].id).toBe('mock_call_2')
  })

  it('echoes without a script and never makes tool calls', async () => {
    const r = await new MockTextProvider(null).runTurn(req('hello'))
    expect(r).toMatchObject({ text: '(mock) hello', toolCalls: [], stopReason: 'end', raw: null })
  })

  it('rejects with AbortError when already aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(new MockTextProvider(null).runTurn(req('x', ac.signal))).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('reports a bad script file clearly', () => {
    expect(() => loadMockScript(writeScript('{not json'))).toThrow(/Invalid mock script/)
    expect(() => loadMockScript(writeScript({ turns: [{ toolCalls: [{ input: {} }] }] }))).toThrow(/Invalid mock script .*name/)
  })
})

describe('MockImageProvider', () => {
  const base = { prompt: 'a cat', references: [], signal: new AbortController().signal }

  it('honors aspect', async () => {
    const r = await new MockImageProvider().generate({ ...base, aspect: '2:3' })
    expect(r.mime).toBe('image/png')
    expect(r.data.readUInt32BE(16)).toBe(256)
    expect(r.data.readUInt32BE(20)).toBe(384)
  })

  it('is deterministic and varies with mode, prompt and reference count', async () => {
    const p = new MockImageProvider()
    const gen = await p.generate({ ...base, aspect: '1:1' })
    expect((await p.generate({ ...base, aspect: '1:1' })).data.equals(gen.data)).toBe(true)
    const src = { mime: 'image/png', data: gen.data, label: 's' }
    const edit = await p.edit({ ...base, aspect: '1:1', source: src })
    expect(edit.data.equals(gen.data)).toBe(false)
    expect((await p.generate({ ...base, prompt: 'a dog', aspect: '1:1' })).data.equals(gen.data)).toBe(false)
    expect((await p.generate({ ...base, references: [src], aspect: '1:1' })).data.equals(gen.data)).toBe(false)
  })

  it('rejects with AbortError when already aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    await expect(new MockImageProvider().generate({ ...base, aspect: '1:1', signal: ac.signal })).rejects.toMatchObject({
      name: 'AbortError'
    })
  })
})
