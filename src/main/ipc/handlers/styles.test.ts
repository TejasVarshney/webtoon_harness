import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_STYLES } from '../../domain/style-presets'
import { testServices, type TestServices } from '../../test/test-services'
import type { HandlerMap } from './projects'
import { stylesHandlers } from './styles'

let s: TestServices | undefined
afterEach(async () => {
  await s?.cleanup()
  s = undefined
})

const WATERCOLOR = BUILTIN_STYLES.find((b) => b.id === 'watercolor')!.text

async function setup() {
  s = await testServices()
  const ctx = await s.projects.create({ title: 'Moon Diary' })
  const h = stylesHandlers(s) as Required<HandlerMap>
  return { services: s, ctx, projectId: ctx.id, h }
}

describe('styles IPC handlers', () => {
  it('lists the library with no load error', async () => {
    const { h } = await setup()
    const { styles, loadError } = await h['styles:list']({})
    expect(styles).toHaveLength(10)
    expect(loadError).toBeNull()
  })

  it('creates, updates and deletes a style', async () => {
    const { h } = await setup()
    const created = await h['styles:create']({ name: 'Mine', text: 'Ink wash.' })
    expect(created.text).toBe('Ink wash')
    expect((await h['styles:update']({ id: created.id, patch: { name: 'Yours' } })).name).toBe('Yours')
    await h['styles:delete']({ id: created.id })
    expect((await h['styles:list']({})).styles).toHaveLength(10)
  })

  it('resets an edited built-in', async () => {
    const { h } = await setup()
    await h['styles:update']({ id: 'watercolor', patch: { text: 'Wet wash' } })
    expect(await h['styles:reset']({ id: 'watercolor' })).toMatchObject({ text: WATERCOLOR, edited: false })
  })

  it('rejects a non-string name', async () => {
    const { h } = await setup()
    await expect(h['styles:create']({ name: 3 as never, text: 'Ink wash' })).rejects.toThrow('Invalid input: name:')
  })

  it('applies a library style to a project', async () => {
    const { h, projectId } = await setup()
    expect((await h['styles:apply']({ projectId, styleId: 'watercolor' })).stylePreset).toBe(WATERCOLOR)
  })

  it('applying an unknown style fails and leaves the project', async () => {
    const { h, services, ctx, projectId } = await setup()
    const before = (await services.projects.getMeta(ctx)).stylePreset
    await expect(h['styles:apply']({ projectId, styleId: 'nope' })).rejects.toThrow('Unknown style: nope')
    expect((await services.projects.getMeta(ctx)).stylePreset).toBe(before)
  })

  it('editing the style a project uses leaves the project text', async () => {
    const { h, services, ctx, projectId } = await setup()
    await h['styles:apply']({ projectId, styleId: 'watercolor' })
    await h['styles:update']({ id: 'watercolor', patch: { text: 'Wet wash' } })
    expect((await services.projects.getMeta(ctx)).stylePreset).toBe(WATERCOLOR)
  })

  it('deleting the style a project uses leaves the project text', async () => {
    const { h, services, ctx, projectId } = await setup()
    const created = await h['styles:create']({ name: 'Mine', text: 'Ink wash' })
    await h['styles:apply']({ projectId, styleId: created.id })
    await h['styles:delete']({ id: created.id })
    expect((await services.projects.getMeta(ctx)).stylePreset).toBe('Ink wash')
  })

  it('applies even when the project has art', async () => {
    const { h, services, projectId } = await setup()
    vi.spyOn(services.styles, 'usage').mockResolvedValue({ sheets: 1, panels: 0 })
    expect((await h['styles:apply']({ projectId, styleId: 'watercolor' })).stylePreset).toBe(WATERCOLOR)
  })

  it('stops reporting a corrupt file once it is removed', async () => {
    const { h, services } = await setup()
    const file = path.join(services.userDataDir, 'styles.json')
    await fs.promises.mkdir(services.userDataDir, { recursive: true })
    await fs.promises.writeFile(file, '{"custom": oops')
    await services.styleLibrary.load()
    expect((await h['styles:list']({})).loadError).not.toBeNull()
    await fs.promises.rm(file)
    expect((await h['styles:list']({})).loadError).toBeNull()
  })

  it('reports usage', async () => {
    const { h, projectId } = await setup()
    expect(await h['styles:usage']({ projectId })).toEqual({ sheets: 0, panels: 0 })
  })
})
