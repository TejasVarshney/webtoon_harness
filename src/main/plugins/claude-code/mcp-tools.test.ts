import fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { loadImageForTextModel } from '../../domain/image-ops'
import { buildAgentTools } from '../../agent/tools'
import { defineTool, ToolRegistry } from '../../agent/tools/registry'
import { encodeSolidPng } from '../../models/providers/png'
import { testServices, type TestServices } from '../../test/test-services'
import { McpToolAdapter, NO_PROJECT } from './mcp-tools'

let s: TestServices | undefined
afterEach(async () => {
  await s?.cleanup()
  s = undefined
})

async function setup(registry?: ToolRegistry) {
  s = await testServices()
  const ctx = await s.projects.create({ title: 'Moon Diary' })
  const adapter = new McpToolAdapter({ services: s, activeContext: s.activeContext, ...(registry ? { registry } : {}) })
  const opts = { signal: new AbortController().signal, threadKey: 'ses_0000000001' }
  return { s, ctx, adapter, opts }
}

describe('McpToolAdapter', () => {
  it('lists the agent tools plus get_project_state, with the registry schemas', async () => {
    const { adapter } = await setup()
    const registry = buildAgentTools({ vision: true })
    const tools = adapter.listTools()
    expect(tools.map((t) => t.name)).toEqual([...registry.names(), 'get_project_state'])
    for (const spec of registry.specs()) expect(tools.find((t) => t.name === spec.name)?.inputSchema).toEqual(spec.inputSchema)
    expect(tools.at(-1)).toEqual({
      name: 'get_project_state',
      description: 'The current <project_state> snapshot: project, story mode, style, characters, items, current episode and its last panels. Call it before planning or drawing.',
      inputSchema: { type: 'object', properties: {} }
    })
  })

  it('makeCall builds a call with a call_ id', async () => {
    const { adapter } = await setup()
    expect(adapter.makeCall('list_characters', { a: 1 })).toEqual({ id: expect.stringMatching(/^call_[0-9a-f]{10}$/), name: 'list_characters', input: { a: 1 } })
  })

  it('runs a tool against the project', async () => {
    const { adapter, ctx, opts, s } = await setup()
    const toolCall = adapter.makeCall('create_character', { name: 'Mina', role: 'protagonist', appearanceLock: 'LOCK', generateBaseImage: false })
    const { result, toolResult } = await adapter.call(ctx, toolCall, opts)
    expect(result.isError).toBeUndefined()
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect(toolResult).toMatchObject({ toolCallId: toolCall.id, name: 'create_character', ok: true })
    expect(await s.characters.list(ctx)).toHaveLength(1)
  })

  it('maps a failed call to isError with the registry message', async () => {
    const { adapter, ctx, opts } = await setup()
    const { result, toolResult } = await adapter.call(ctx, adapter.makeCall('create_character', {}), opts)
    expect(result.isError).toBe(true)
    expect(toolResult.ok).toBe(false)
    expect(result.content).toHaveLength(1)
    const first = result.content[0]
    expect(first.type === 'text' && first.text).toMatch(/^Invalid input for create_character: /)
  })

  it('returns tool images as image content after the text', async () => {
    const png = encodeSolidPng(2, 2, [10, 20, 30])
    const stub = defineTool({
      name: 'draw',
      description: 'stub',
      input: z.object({}),
      handler: async (_input, ctx) => {
        await fs.promises.mkdir(ctx.project.paths.resolveAsset('characters'), { recursive: true })
        await fs.promises.writeFile(ctx.project.paths.resolveAsset('characters/x.png'), png)
        return { content: 'drew it', images: ['characters/x.png', 'characters/gone.png'] }
      }
    })
    const { adapter, ctx, opts, s } = await setup(new ToolRegistry([stub]))
    const { result, toolResult } = await adapter.call(ctx, adapter.makeCall('draw', {}), opts)
    const expected = await loadImageForTextModel(ctx, s.imageOps, 'characters/x.png')
    expect(toolResult.images).toEqual(['characters/x.png', 'characters/gone.png'])
    expect(result.isError).toBeUndefined()
    expect(result.content).toEqual([
      { type: 'text', text: 'drew it' },
      { type: 'image', data: expected.base64, mimeType: expected.mime },
      { type: 'text', text: '[image no longer available: characters/gone.png]' }
    ])
  })

  it('returns the project state snapshot for get_project_state', async () => {
    const { adapter, ctx, opts } = await setup()
    const toolCall = adapter.makeCall('get_project_state', {})
    const { result, toolResult } = await adapter.call(ctx, toolCall, opts)
    expect(toolResult).toMatchObject({ toolCallId: toolCall.id, name: 'get_project_state', ok: true, images: [] })
    expect(toolResult.content.startsWith('<project_state>')).toBe(true)
    expect(result).toEqual({ content: [{ type: 'text', text: toolResult.content }] })
  })

  it('get_project_state names the episode the window shows', async () => {
    const { adapter, ctx, opts, s } = await setup()
    const first = await s.episodes.create(ctx, { title: 'First Light' })
    const second = await s.episodes.create(ctx, { title: 'Second Moon' })
    s.activeContext.set({ projectId: ctx.id, episodeId: second.id })
    const { toolResult } = await adapter.call(ctx, adapter.makeCall('get_project_state', {}), opts)
    expect(toolResult.content).toContain('Second Moon')
    expect(toolResult.content).not.toContain('First Light')
    expect(first.id).not.toBe(second.id)
  })

  it('hands the request signal and thread key to the handler', async () => {
    const seen: { aborted: boolean; threadKey: string }[] = []
    const stub = defineTool({
      name: 'probe',
      description: 'stub',
      input: z.object({}),
      handler: async (_input, ctx) => {
        seen.push({ aborted: ctx.signal.aborted, threadKey: ctx.threadKey })
        return { content: 'ok' }
      }
    })
    const { adapter, ctx } = await setup(new ToolRegistry([stub]))
    const controller = new AbortController()
    controller.abort()
    await adapter.call(ctx, adapter.makeCall('probe', {}), { signal: controller.signal, threadKey: 'ses_000000abcd' })
    expect(seen).toEqual([{ aborted: true, threadKey: 'ses_000000abcd' }])
  })

  describe('activeProject', () => {
    it('is null with no project id set', async () => {
      const { adapter } = await setup()
      expect(await adapter.activeProject()).toBeNull()
    })

    it('opens the project the window shows', async () => {
      const { adapter, ctx, s } = await setup()
      s.activeContext.set({ projectId: ctx.id, episodeId: null })
      expect((await adapter.activeProject())?.id).toBe(ctx.id)
    })

    it('is null when that project no longer opens', async () => {
      const { adapter, s } = await setup()
      s.activeContext.set({ projectId: 'prj_0000000000', episodeId: null })
      expect(await adapter.activeProject()).toBeNull()
    })
  })

  describe('instructions', () => {
    const paragraph =
      'You are connected to the Webtoon AI Harness through MCP. Call `get_project_state` before you plan or draw, and again after the user may have changed things. Read workflow docs with `read_workflow_doc`.'

    it('is the connection paragraph alone without a project', async () => {
      const { adapter } = await setup()
      const text = await adapter.instructions(null)
      expect(text).toBe(paragraph)
      expect(text).toContain('get_project_state')
    })

    it('puts the project prompt before the connection paragraph', async () => {
      const { adapter, ctx } = await setup()
      const text = await adapter.instructions(ctx)
      expect(text.endsWith(`\n\n${paragraph}`)).toBe(true)
      expect(text.length).toBeGreaterThan(paragraph.length + 100)
    })
  })

  it('exports the no-project message', () => {
    expect(NO_PROJECT).toBe('Open a project in the Webtoon AI Harness window first.')
  })
})
