import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ToolResult } from '@shared/types'
import { testServices, type TestServices } from '../../test/test-services'
import { ALL_TOOL_NAMES, buildAgentTools } from '.'
import { buildPanelChatTools } from './panel-chat-tools'
import type { ToolContext } from './registry'

let s: TestServices | undefined
afterEach(async () => {
  await s?.cleanup()
  s = undefined
})

let n = 0
const call = (name: string, input: unknown) => ({ id: `call_${++n}`, name, input })

const SHIPPED = [
  'reference/consistency-checklist',
  'reference/prompt-templates',
  'reference/webtoon-style-guide',
  'workflows/character-creation',
  'workflows/panel-editing',
  'workflows/panel-generation',
  'workflows/story-direction'
]
const template = (name: string): string => fs.readFileSync(path.resolve('resources', 'agent-docs', ...`${name}.md`.split('/')), 'utf8')

async function setup() {
  s = await testServices()
  const services = s
  const ctx = await services.projects.create({ title: 'Moon Diary' })
  const toolCtx: ToolContext = { project: ctx, services, signal: new AbortController().signal, threadKey: 'ses_0000000001' }
  const run = (input: unknown): Promise<ToolResult> => buildAgentTools({ vision: false }).execute(call('read_workflow_doc', input), toolCtx)
  return { services, ctx, run }
}

describe('read_workflow_doc', () => {
  it('is the last tool of the agent tool set, with or without vision', () => {
    for (const vision of [true, false]) expect(buildAgentTools({ vision }).names().at(-1)).toBe('read_workflow_doc')
  })

  it('returns the markdown of the project copy of a doc', async () => {
    const { run } = await setup()
    const r = await run({ name: 'workflows/panel-generation' })
    expect(r.ok, r.content).toBe(true)
    expect(r.content).toBe(template('workflows/panel-generation'))
  })

  it('reads the per-project copy, so a project edit applies', async () => {
    const { ctx, run } = await setup()
    await fs.promises.writeFile(path.join(ctx.paths.agentDocsDir(), 'workflows', 'story-direction.md'), '# Story Direction\n\nOur own rules.\n')
    expect((await run({ name: 'workflows/story-direction' })).content).toBe('# Story Direction\n\nOur own rules.\n')
  })

  it('forgives a trailing .md and a bare file name', async () => {
    const { run } = await setup()
    expect((await run({ name: 'workflows/panel-editing.md' })).content).toBe(template('workflows/panel-editing'))
    expect((await run({ name: 'prompt-templates' })).content).toBe(template('reference/prompt-templates'))
  })

  it('rejects an unknown name with the list of docs', async () => {
    const { run } = await setup()
    const r = await run({ name: 'nope' })
    expect(r.ok).toBe(false)
    expect(r.content).toBe(`Unknown doc: nope. Available: ${SHIPPED.join(', ')}`)
  })

  it('treats a name outside the docs folder as unknown', async () => {
    const { ctx, run } = await setup()
    await fs.promises.writeFile(path.join(ctx.paths.root, 'secret.md'), 'secret')
    for (const name of ['../secret', 'C:/secret', 'workflows/../../secret']) {
      const r = await run({ name })
      expect(r.ok).toBe(false)
      expect(r.content).toBe(`Unknown doc: ${name}. Available: ${SHIPPED.join(', ')}`)
    }
  })

  it('needs a name', async () => {
    const { run } = await setup()
    expect((await run({})).content).toMatch(/^Invalid input for read_workflow_doc: name/)
  })
})

describe('ALL_TOOL_NAMES', () => {
  it('is every tool of the main agent and of the panel side chat, once each', () => {
    const expected = [...buildAgentTools({ vision: true }).names(), ...buildPanelChatTools('pnl_0000000000', { vision: true }).names()]
    expect([...ALL_TOOL_NAMES].sort()).toEqual([...new Set(expected)].sort())
    expect(new Set(ALL_TOOL_NAMES).size).toBe(ALL_TOOL_NAMES.length)
    expect(ALL_TOOL_NAMES).toContain('read_workflow_doc')
    expect(ALL_TOOL_NAMES).toContain('view_current_image')
  })
})
