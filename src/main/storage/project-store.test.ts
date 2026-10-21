import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppEvent } from '@shared/types'
import { EntityNotFoundError, CorruptFileError } from '../domain/errors'
import { EventBus } from '../events/bus'
import { ProjectStore, type ProjectContext, type ProjectMetaPatch } from './project-store'

// A fresh bus, store and root per test. The root has a space in it on purpose: every path the
// store builds must survive one. (tempProject() is not used here because it pre-creates a project.)
let root: string
let events: AppEvent[]
let store: ProjectStore

beforeEach(async () => {
  root = await fs.promises.mkdtemp(join(os.tmpdir(), 'webtoon store test '))
  const bus = new EventBus()
  events = []
  bus.subscribe((e) => events.push(e))
  store = new ProjectStore({ projectsRoot: root, bus })
})

afterEach(async () => {
  await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 5 })
})

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('ProjectStore.create', () => {
  it('creates a project with defaults, dirs, hook and event', async () => {
    const onCreate = vi.fn()
    store.addHooks({ onCreate })
    const ctx = await store.create({ title: 'Moon Diary' })
    const meta = await store.getMeta(ctx)
    expect(meta).toMatchObject({ title: 'Moon Diary', storyMode: 'user' })
    for (const d of ['story', 'characters', 'episodes', 'panels', 'sessions', 'uploads', 'agent']) {
      expect(fs.existsSync(join(ctx.paths.projectFile(), '..', d))).toBe(true)
    }
    expect(onCreate).toHaveBeenCalledWith(ctx)
    expect(events).toContainEqual({ type: 'project.changed', projectId: ctx.id })
  })

  it('puts the project in <projectsRoot>/<id> and fills the schema defaults', async () => {
    const ctx = await store.create({ title: 'Moon Diary' })
    expect(ctx.id).toMatch(/^prj_[0-9a-f]{10}$/)
    expect(ctx.paths.projectFile()).toBe(join(root, ctx.id, 'project.json'))
    expect(ctx.problems).toEqual([])
    const meta = await store.getMeta(ctx)
    expect(meta).toMatchObject({
      id: ctx.id,
      logline: '',
      stylePreset: 'Clean full-color Korean webtoon style, crisp line art, soft cel shading, expressive faces',
      defaultAspect: '2:3',
      autopilotPanels: 4,
      consistencyRetries: 1
    })
    expect(meta.createdAt).toBe(meta.updatedAt)
  })

  it('stores the logline and style preset it was given', async () => {
    const ctx = await store.create({ title: 'T', logline: 'A girl and the moon', stylePreset: 'Watercolor' })
    expect(await store.getMeta(ctx)).toMatchObject({ logline: 'A girl and the moon', stylePreset: 'Watercolor' })
  })

  it('runs hooks from several addHooks calls in registration order, each awaited', async () => {
    const order: string[] = []
    store.addHooks({
      onCreate: async () => {
        await sleep(20)
        order.push('first')
      }
    })
    store.addHooks({ onOpen: async () => undefined })
    store.addHooks({
      onCreate: async () => {
        order.push('second')
      }
    })
    await store.create({ title: 'T' })
    expect(order).toEqual(['first', 'second'])
  })

  it('does not emit when a hook fails', async () => {
    store.addHooks({
      onCreate: async () => {
        throw new Error('seed failed')
      }
    })
    await expect(store.create({ title: 'T' })).rejects.toThrow('seed failed')
    expect(events).toEqual([])
  })
})

describe('ProjectStore.list', () => {
  it('is empty when the projects root does not exist yet', async () => {
    await fs.promises.rm(root, { recursive: true, force: true })
    expect(await store.list()).toEqual({ projects: [], problems: [] })
  })

  it('lists newest first and reports corrupt projects', async () => {
    const a = await store.create({ title: 'A' })
    const b = await store.create({ title: 'B' })
    const c = await store.create({ title: 'C' })
    await fs.promises.writeFile(c.paths.projectFile(), '{ "id": "oops", ')
    // Folders that are not projects are ignored, not reported.
    await fs.promises.mkdir(join(root, 'notes'))
    await fs.promises.writeFile(join(root, 'stray.txt'), 'hello')

    const { projects, problems } = await store.list()
    expect(projects.map((p) => p.id)).toEqual([b.id, a.id])
    expect(problems).toHaveLength(1)
    expect(problems[0].path).toBe(`${c.id}/project.json`)
    expect(problems[0].path.endsWith('project.json')).toBe(true)
    expect(problems[0].message).toMatch(/invalid JSON/)
  })

  it('reports a project.json that parses but breaks the schema', async () => {
    const a = await store.create({ title: 'A' })
    await fs.promises.writeFile(a.paths.projectFile(), JSON.stringify({ id: a.id }))
    const { projects, problems } = await store.list()
    expect(projects).toEqual([])
    expect(problems).toHaveLength(1)
    expect(problems[0].message).toMatch(/schema/)
  })

  it('reports a project.json that cannot be read at all, without failing the whole list', async () => {
    const a = await store.create({ title: 'A' })
    const b = await store.create({ title: 'B' })
    // A directory named project.json makes readFile fail with EISDIR (not ENOENT).
    await fs.promises.rm(a.paths.projectFile())
    await fs.promises.mkdir(a.paths.projectFile())
    const { projects, problems } = await store.list()
    expect(projects.map((p) => p.id)).toEqual([b.id])
    expect(problems).toHaveLength(1)
    expect(problems[0].path).toBe(`${a.id}/project.json`)
  })

  it('reports a project folder whose project.json names a different id', async () => {
    const a = await store.create({ title: 'A' })
    await fs.promises.cp(join(root, a.id), join(root, `${a.id} copy`), { recursive: true })
    const { projects, problems } = await store.list()
    expect(projects.map((p) => p.id)).toEqual([a.id])
    expect(problems).toHaveLength(1)
    expect(problems[0].path).toBe(`${a.id} copy/project.json`)
    expect(problems[0].message).toMatch(/does not match/)
  })

  it('moves a project to the top when its meta is updated', async () => {
    const a = await store.create({ title: 'A' })
    const b = await store.create({ title: 'B' })
    expect((await store.list()).projects.map((p) => p.id)).toEqual([b.id, a.id])
    await store.updateMeta(a, { title: 'A2' })
    expect((await store.list()).projects.map((p) => p.title)).toEqual(['A2', 'B'])
  })

  it('finds projects created by an earlier store instance on the same root', async () => {
    const a = await store.create({ title: 'A' })
    const other = new ProjectStore({ projectsRoot: root, bus: new EventBus() })
    expect((await other.list()).projects.map((p) => p.id)).toEqual([a.id])
  })
})

describe('ProjectStore.open', () => {
  it('runs onOpen once and rejects unknown ids', async () => {
    const created = await store.create({ title: 'A' })
    const fresh = new ProjectStore({ projectsRoot: root, bus: new EventBus() })
    const onOpen = vi.fn()
    fresh.addHooks({ onOpen })
    const first = await fresh.open(created.id)
    const second = await fresh.open(created.id)
    expect(second).toBe(first)
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(first)
    await expect(fresh.open('prj_ffffffffff')).rejects.toBeInstanceOf(EntityNotFoundError)
    await expect(fresh.open('prj_ffffffffff')).rejects.toThrow('Unknown project: prj_ffffffffff')
  })

  it('hands out the ctx create() returned, and still runs onOpen the first time', async () => {
    const onOpen = vi.fn()
    store.addHooks({ onOpen })
    const created = await store.create({ title: 'A' })
    expect(onOpen).not.toHaveBeenCalled()
    const opened = await store.open(created.id)
    expect(opened).toBe(created)
    expect(onOpen).toHaveBeenCalledTimes(1)
    await store.open(created.id)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('runs onOpen once when opens race', async () => {
    const created = await store.create({ title: 'A' })
    const fresh = new ProjectStore({ projectsRoot: root, bus: new EventBus() })
    const onOpen = vi.fn(async () => sleep(10))
    fresh.addHooks({ onOpen })
    const [x, y, z] = await Promise.all([fresh.open(created.id), fresh.open(created.id), fresh.open(created.id)])
    expect(y).toBe(x)
    expect(z).toBe(x)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('retries the hooks after a failed open instead of caching the failure', async () => {
    const created = await store.create({ title: 'A' })
    const fresh = new ProjectStore({ projectsRoot: root, bus: new EventBus() })
    const onOpen = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined)
    fresh.addHooks({ onOpen })
    await expect(fresh.open(created.id)).rejects.toThrow('boom')
    await expect(fresh.open(created.id)).resolves.toMatchObject({ id: created.id })
    expect(onOpen).toHaveBeenCalledTimes(2)
  })

  it.each(['..', '../prj_0000000001', 'prj_a/b', 'prj_a\\b', 'PRJ_ABC', 'prj_', '', 'chr_0000000001'])(
    'treats the malformed id %j as unknown instead of touching the file system',
    async (id) => {
      await expect(store.open(id)).rejects.toBeInstanceOf(EntityNotFoundError)
    }
  )

  it('is unknown when the folder has no project.json', async () => {
    await fs.promises.mkdir(join(root, 'prj_0000000bad'))
    await expect(store.open('prj_0000000bad')).rejects.toBeInstanceOf(EntityNotFoundError)
  })

  it('refuses a project whose project.json is corrupt, with a CorruptFileError', async () => {
    const created = await store.create({ title: 'A' })
    await fs.promises.writeFile(created.paths.projectFile(), 'not json')
    const fresh = new ProjectStore({ projectsRoot: root, bus: new EventBus() })
    await expect(fresh.open(created.id)).rejects.toBeInstanceOf(CorruptFileError)
  })

  it('gives each project its own mutex and problems list', async () => {
    const a = await store.create({ title: 'A' })
    const b = await store.create({ title: 'B' })
    expect(a.mutex).not.toBe(b.mutex)
    a.problems.push({ path: 'characters/chr_1.json', message: 'bad' })
    expect(b.problems).toEqual([])
    expect((await store.open(a.id)).problems).toHaveLength(1)
  })
})

describe('ProjectStore.updateMeta', () => {
  let ctx: ProjectContext
  beforeEach(async () => {
    ctx = await store.create({ title: 'Moon Diary' })
    events.length = 0
  })

  it('applies the patch, bumps updatedAt, persists and emits', async () => {
    const before = await store.getMeta(ctx)
    const after = await store.updateMeta(ctx, { title: 'Sun Diary', storyMode: 'ai', autopilotPanels: 6, defaultAspect: '16:9' })
    expect(after).toMatchObject({ title: 'Sun Diary', storyMode: 'ai', autopilotPanels: 6, defaultAspect: '16:9', logline: '' })
    expect(after.id).toBe(before.id)
    expect(after.createdAt).toBe(before.createdAt)
    expect(after.updatedAt > before.updatedAt).toBe(true)
    expect(await store.getMeta(ctx)).toEqual(after)
    expect(events).toEqual([{ type: 'project.changed', projectId: ctx.id }])
  })

  it('leaves a field alone when the patch names it as undefined', async () => {
    const after = await store.updateMeta(ctx, { logline: 'Kept', autopilotPanels: undefined, stylePreset: undefined })
    expect(after).toMatchObject({ logline: 'Kept', autopilotPanels: 4 })
    expect(after.stylePreset).toMatch(/^Clean full-color/)
  })

  it('cannot be used to rewrite the id, createdAt or updatedAt', async () => {
    const before = await store.getMeta(ctx)
    const sneaky = { id: 'prj_other', createdAt: '1999-01-01T00:00:00.000Z', updatedAt: '1999-01-01T00:00:00.000Z', title: 'Renamed' }
    const after = await store.updateMeta(ctx, sneaky as unknown as ProjectMetaPatch)
    expect(after.title).toBe('Renamed')
    expect(after.id).toBe(before.id)
    expect(after.createdAt).toBe(before.createdAt)
    expect(after.updatedAt > before.updatedAt).toBe(true)
  })

  it('rejects an invalid value without writing or emitting', async () => {
    const before = await store.getMeta(ctx)
    await expect(store.updateMeta(ctx, { autopilotPanels: 0 })).rejects.toThrow()
    await expect(store.updateMeta(ctx, { defaultAspect: '5:7' as never })).rejects.toThrow()
    expect(await store.getMeta(ctx)).toEqual(before)
    expect(events).toEqual([])
  })

  it('serializes concurrent updates so none is lost', async () => {
    await Promise.all([
      store.updateMeta(ctx, { title: 'T2' }),
      store.updateMeta(ctx, { logline: 'L2' }),
      store.updateMeta(ctx, { consistencyRetries: 3 })
    ])
    expect(await store.getMeta(ctx)).toMatchObject({ title: 'T2', logline: 'L2', consistencyRetries: 3 })
    expect(events).toHaveLength(3)
  })

  it('leaves no temp files behind', async () => {
    await store.updateMeta(ctx, { title: 'T2' })
    expect(fs.readdirSync(join(root, ctx.id)).filter((name) => name.includes('.tmp-'))).toEqual([])
  })
})
