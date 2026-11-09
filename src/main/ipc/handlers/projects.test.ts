import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_STYLE_PRESET } from '@shared/schemas'
import { testServices, type TestServices } from '../../test/test-services'
import { projectsHandlers, type HandlerMap } from './projects'

let s: TestServices | undefined
afterEach(async () => {
  await s?.cleanup()
  s = undefined
})

async function setup() {
  s = await testServices()
  return projectsHandlers(s) as Required<HandlerMap>
}

describe('projects IPC handlers: the style', () => {
  it('create normalizes a given style', async () => {
    const h = await setup()
    expect((await h['projects:create']({ title: 'T', stylePreset: 'Ink wash.' })).stylePreset).toBe('Ink wash')
  })

  it('create rejects a style asking for lettering', async () => {
    const h = await setup()
    await expect(h['projects:create']({ title: 'T', stylePreset: 'Hand lettering everywhere' })).rejects.toThrow('A style describes how the art looks.')
  })

  it('create without a style gets the default', async () => {
    const h = await setup()
    expect((await h['projects:create']({ title: 'T' })).stylePreset).toBe(DEFAULT_STYLE_PRESET)
  })

  it('update normalizes a style patch', async () => {
    const h = await setup()
    const { id } = await h['projects:create']({ title: 'T' })
    expect((await h['projects:update']({ projectId: id, patch: { stylePreset: 'Ink wash.\n' } })).stylePreset).toBe('Ink wash')
  })

  it('update leaves the style alone when the patch has none', async () => {
    const h = await setup()
    const { id, stylePreset } = await h['projects:create']({ title: 'T' })
    expect((await h['projects:update']({ projectId: id, patch: { title: 'U' } })).stylePreset).toBe(stylePreset)
  })
})
