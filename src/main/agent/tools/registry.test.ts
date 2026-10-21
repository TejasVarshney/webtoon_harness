import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ToolError, ToolRegistry, defineTool, type ToolContext } from './registry'

const ctx = { signal: new AbortController().signal, threadKey: 't' } as unknown as ToolContext

const echo = defineTool({
  name: 'echo',
  description: 'e',
  input: z.object({ s: z.string() }),
  handler: async ({ s }) => ({ content: s })
})

describe('ToolRegistry', () => {
  it('validates input and never throws', async () => {
    const reg = new ToolRegistry([echo])
    expect(await reg.execute({ id: '1', name: 'echo', input: { s: 1 } }, ctx)).toMatchObject({
      ok: false,
      content: expect.stringContaining('Invalid input for echo')
    })
    expect(await reg.execute({ id: '2', name: 'nope', input: {} }, ctx)).toMatchObject({ ok: false, content: 'Unknown tool: nope' })
    expect(reg.specs()[0].inputSchema).toMatchObject({ type: 'object', properties: { s: { type: 'string' } } })
    expect(reg.names()).toEqual(['echo'])
  })

  it('formats zod issues as path: message and rejects raw strings', async () => {
    const reg = new ToolRegistry([echo])
    const bad = await reg.execute({ id: '1', name: 'echo', input: { s: 1 } }, ctx)
    expect(bad.content).toMatch(/^Invalid input for echo: s: /)
    const raw = await reg.execute({ id: '2', name: 'echo', input: '{"s":' }, ctx)
    expect(raw.content).toMatch(/^Invalid input for echo: \(root\): /)
    expect(raw.ok).toBe(false)
  })

  it('returns content, stringifies objects, and carries images and ids', async () => {
    const reg = new ToolRegistry([
      defineTool({ name: 'obj', description: 'o', input: z.object({}), handler: async () => ({ content: { a: 1 }, images: ['x.png'] }) }),
      echo
    ])
    expect(await reg.execute({ id: 'c1', name: 'obj', input: {} }, ctx)).toEqual({
      toolCallId: 'c1',
      name: 'obj',
      ok: true,
      content: '{"a":1}',
      images: ['x.png']
    })
    expect(await reg.execute({ id: 'c2', name: 'echo', input: { s: 'hi' } }, ctx)).toMatchObject({ ok: true, content: 'hi', images: [] })
  })

  it('turns handler throws into ok:false', async () => {
    const reg = new ToolRegistry([
      defineTool({
        name: 'boom',
        description: 'b',
        input: z.object({}),
        handler: async () => {
          throw new ToolError('nope')
        }
      }),
      defineTool({
        name: 'str',
        description: 'b',
        input: z.object({}),
        handler: async () => {
          throw 'weird'
        }
      })
    ])
    expect(await reg.execute({ id: '1', name: 'boom', input: {} }, ctx)).toMatchObject({ ok: false, content: 'nope' })
    expect(await reg.execute({ id: '2', name: 'str', input: {} }, ctx)).toMatchObject({ ok: false, content: 'weird' })
  })
})
