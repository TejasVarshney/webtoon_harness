import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { tempProject } from './temp-project'

describe('tempProject', () => {
  it('builds a store on a temp root with a space in its path, holding one project', async () => {
    const { store, ctx, root, cleanup } = await tempProject()
    try {
      expect(root).toContain(' ')
      expect(ctx.paths.root.startsWith(root)).toBe(true)
      expect((await store.list()).projects.map((p) => p.id)).toEqual([ctx.id])
      expect(await store.open(ctx.id)).toBe(ctx)
    } finally {
      await cleanup()
    }
  })

  it('collects every bus emission, starting with the one for the project it created', async () => {
    const { store, ctx, bus, events, cleanup } = await tempProject()
    try {
      expect(events).toEqual([{ type: 'project.changed', projectId: ctx.id }])
      bus.emit({ type: 'models.changed' })
      await store.updateMeta(ctx, { title: 'Renamed' })
      expect(events).toEqual([
        { type: 'project.changed', projectId: ctx.id },
        { type: 'models.changed' },
        { type: 'project.changed', projectId: ctx.id }
      ])
    } finally {
      await cleanup()
    }
  })

  it('cleanup removes the root, and gives each call its own root', async () => {
    const one = await tempProject()
    const two = await tempProject()
    expect(one.root).not.toBe(two.root)
    await one.cleanup()
    await two.cleanup()
    expect(fs.existsSync(one.root)).toBe(false)
    expect(fs.existsSync(two.root)).toBe(false)
  })
})
