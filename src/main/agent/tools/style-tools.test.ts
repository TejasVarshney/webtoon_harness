import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolResult } from '@shared/types'
import { BUILTIN_STYLES } from '../../domain/style-presets'
import { testServices, type TestServices } from '../../test/test-services'
import { buildAgentTools } from '.'
import type { ToolContext } from './registry'

let s: TestServices | undefined
afterEach(async () => {
  await s?.cleanup()
  s = undefined
})

let n = 0
const INK_NOIR = BUILTIN_STYLES.find((b) => b.id === 'ink-noir')!

async function setup() {
  s = await testServices()
  const services = s
  const ctx = await services.projects.create({ title: 'Moon Diary' })
  const toolCtx: ToolContext = { project: ctx, services, signal: new AbortController().signal, threadKey: 'ses_0000000001' }
  const run = (name: string, input: unknown): Promise<ToolResult> => buildAgentTools({ vision: false }).execute({ id: `call_${++n}`, name, input }, toolCtx)
  const style = async (): Promise<string> => (await services.projects.getMeta(ctx)).stylePreset
  const locked = (usage: { sheets: number; panels: number }) => vi.spyOn(services.styles, 'usage').mockResolvedValue(usage)
  return { services, ctx, run, style, locked }
}

// Results carry JSON on success and the message on failure.
const body = (r: ToolResult): any => (r.ok ? JSON.parse(r.content) : r.content)

describe('list_styles', () => {
  it('shows the library, the current style and canChange', async () => {
    const { run, style } = await setup()
    const r = await run('list_styles', {})
    expect(r.ok).toBe(true)
    expect(body(r).styles).toHaveLength(10)
    expect(body(r).styles[0]).toEqual({ id: 'korean-webtoon', name: 'Korean webtoon', text: await style(), builtin: true })
    expect(body(r).current).toBe(await style())
    expect(body(r).canChange).toBe(true)
    expect(body(r).lockedBy).toBeUndefined()
  })

  it('says when it is locked', async () => {
    const { run, locked } = await setup()
    locked({ sheets: 2, panels: 1 })
    const r = await run('list_styles', {})
    expect(body(r).canChange).toBe(false)
    expect(body(r).lockedBy).toEqual({ sheets: 2, panels: 1 })
  })
})

describe('set_style', () => {
  it('applies a library style', async () => {
    const { run, style } = await setup()
    const r = await run('set_style', { styleId: 'ink-noir' })
    expect(r.ok).toBe(true)
    expect(body(r)).toEqual({ style: INK_NOIR.text })
    expect(await style()).toBe(INK_NOIR.text)
  })

  it('applies written text, normalized', async () => {
    const { run, style } = await setup()
    expect((await run('set_style', { text: 'Crayon scribbles.' })).ok).toBe(true)
    expect(await style()).toBe('Crayon scribbles')
  })

  it.each([[{}], [{ styleId: 'ink-noir', text: 'Crayon scribbles' }]])('needs exactly one of styleId or text: %j', async (input) => {
    const { run, style } = await setup()
    const before = await style()
    const r = await run('set_style', input)
    expect(r.ok).toBe(false)
    expect(body(r)).toContain('Pass exactly one of styleId or text.')
    expect(await style()).toBe(before)
  })

  it('rejects bad text as a message', async () => {
    const { run } = await setup()
    const r = await run('set_style', { text: 'with speech bubbles' })
    expect(r.ok).toBe(false)
    expect(body(r)).toContain('A style describes how the art looks.')
  })

  it('reports an unknown id', async () => {
    const { run } = await setup()
    const r = await run('set_style', { styleId: 'nope' })
    expect(r.ok).toBe(false)
    expect(body(r)).toContain('Unknown style: nope')
  })

  it('is refused when the project has art', async () => {
    const { run, style, locked } = await setup()
    const before = await style()
    locked({ sheets: 3, panels: 12 })
    const r = await run('set_style', { styleId: 'ink-noir' })
    expect(r.ok).toBe(false)
    expect(body(r)).toContain('The style is locked: this project already has 3 sheets and 12 panels drawn in it, and new art would not match them. Ask the user to switch it with the Style button in the chat header.')
    expect(await style()).toBe(before)
  })

  it('uses the singular for one', async () => {
    const { run, locked } = await setup()
    locked({ sheets: 1, panels: 1 })
    expect(body(await run('set_style', { text: 'Crayon scribbles' }))).toContain('already has 1 sheet and 1 panel drawn')
  })
})

describe('create_style', () => {
  it('adds to the library and applies nothing', async () => {
    const { run, services, style } = await setup()
    const before = await style()
    const r = await run('create_style', { name: 'Rainy city', text: 'Muted blue-gray wash.' })
    expect(r.ok).toBe(true)
    expect(body(r).style).toMatchObject({ name: 'Rainy city', text: 'Muted blue-gray wash', builtin: false })
    expect(services.styleLibrary.get(body(r).style.id)).toBeDefined()
    expect(await style()).toBe(before)
  })

  it('works when the project is locked', async () => {
    const { run, locked } = await setup()
    locked({ sheets: 1, panels: 0 })
    expect((await run('create_style', { name: 'Rainy city', text: 'Muted wash' })).ok).toBe(true)
  })

  it('reports a name clash as a message', async () => {
    const { run } = await setup()
    const r = await run('create_style', { name: 'watercolor', text: 'Muted wash' })
    expect(r.ok).toBe(false)
    expect(body(r)).toContain('There is already a style named watercolor.')
  })
})

describe('update_style', () => {
  it('edits a custom style and changes no project', async () => {
    const { run, services, ctx, style } = await setup()
    const created = await services.styleLibrary.create({ name: 'Mine', text: 'Ink wash' })
    await services.styles.apply(ctx, created.text)
    const r = await run('update_style', { styleId: created.id, text: 'New look' })
    expect(r.ok).toBe(true)
    expect(services.styleLibrary.get(created.id)?.text).toBe('New look')
    expect(await style()).toBe('Ink wash')
  })

  it('refuses a built-in', async () => {
    const { run, services } = await setup()
    const r = await run('update_style', { styleId: 'watercolor', text: 'Wet wash' })
    expect(r.ok).toBe(false)
    expect(body(r)).toContain('Built-in styles can only be edited by the user.')
    expect(services.styleLibrary.get('watercolor')?.edited).toBe(false)
  })

  it('reports an unknown id', async () => {
    const { run } = await setup()
    expect(body(await run('update_style', { styleId: 'nope', name: 'X' }))).toContain('Unknown style: nope')
  })
})

describe('the tool set', () => {
  it('offers no delete tool for styles', () => {
    expect(buildAgentTools({ vision: true }).names().filter((t) => /delete.*style/.test(t))).toEqual([])
  })

  it('are the four tools before read_workflow_doc at the end of the agent tool set, with or without vision', () => {
    for (const vision of [true, false]) expect(buildAgentTools({ vision }).names().slice(-5, -1)).toEqual(['list_styles', 'set_style', 'create_style', 'update_style'])
  })

  it('read_workflow_doc stays the last tool', () => {
    expect(buildAgentTools({ vision: false }).names().at(-1)).toBe('read_workflow_doc')
  })
})
