import fs from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeJsonAtomic } from '../storage/atomic'
import { ProviderError } from '../models/providers/types'
import { encodeSolidPng } from '../models/providers/png'
import { makeCharacter, makeVariation } from '../test/factories'
import { testServices } from '../test/test-services'
import { tempProject, type TempProject } from '../test/temp-project'
import { CharacterInUseError, CharacterService, DuplicateCharacterError, type PanelUsageLookup } from './character-service'
import type { ImageGenRequest, ImageService } from './image-service'

// Failure injection: while `disk.failJsonWrites > 0`, that many writeJsonAtomic calls reject.
const disk = vi.hoisted(() => ({ failJsonWrites: 0 }))
vi.mock('../storage/atomic', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storage/atomic')>()
  return {
    ...actual,
    writeJsonAtomic: async (path: string, value: unknown) => {
      if (disk.failJsonWrites > 0) {
        disk.failJsonWrites--
        throw new Error('disk full')
      }
      return actual.writeJsonAtomic(path, value)
    }
  }
})

const input = (name = 'Mina') => ({ name, role: 'protagonist' as const, appearanceLock: 'LOCK' })
const PNG = encodeSolidPng(2, 3, [1, 2, 3])

let tp: TempProject | undefined
afterEach(async () => {
  disk.failJsonWrites = 0
  await tp?.cleanup()
  tp = undefined
})

type Gen = (req: ImageGenRequest) => Promise<{ data: Buffer; ext: 'png' | 'jpg' | 'webp' }>

async function setup(gen: Gen = async () => ({ data: PNG, ext: 'png' }), used: string[] = []) {
  const t = await tempProject()
  tp = t
  const calls: ImageGenRequest[] = []
  const images = {
    generate: (_c: unknown, req: ImageGenRequest) => {
      calls.push(req)
      return gen(req)
    }
  } as unknown as ImageService
  const trashed: string[] = []
  const usage: PanelUsageLookup = { panelsUsingCharacter: async () => used, panelsUsingVariation: async () => used }
  const svc = new CharacterService({ bus: t.bus, images, projects: t.store, usage, trash: async (p) => void trashed.push(p) })
  return { svc, calls, trashed, ctx: t.ctx, events: t.events }
}

describe('CharacterService', () => {
  it('creates with a pending base variation and rejects duplicates', async () => {
    const { svc, ctx, events } = await setup()
    events.length = 0
    const c = await svc.create(ctx, input('Mina'), 'user')
    expect(c.id).toMatch(/^chr_[0-9a-f]{10}$/)
    expect(c.variations).toMatchObject([{ kind: 'base', name: 'Base', status: 'pending', imagePath: null, characterId: c.id }])
    expect(events).toContainEqual({ type: 'character.changed', projectId: ctx.id, characterId: c.id })
    await expect(svc.create(ctx, input('mina'), 'user')).rejects.toBeInstanceOf(DuplicateCharacterError)
    await svc.archive(ctx, c.id)
    await expect(svc.create(ctx, input('mina'), 'user')).resolves.toBeDefined()
  })

  it('generates the base image', async () => {
    const { svc, calls, ctx } = await setup()
    const c = await svc.create(ctx, input(), 'user')
    const v = await svc.generateVariationImage(ctx, c.id, c.variations[0].id)
    expect(v.status).toBe('ready')
    expect(v.imagePath).toMatch(/^characters\/chr_[0-9a-f]{10}\/var_[0-9a-f]{10}_[0-9a-f]{6}\.png$/)
    expect(fs.existsSync(ctx.paths.resolveAsset(v.imagePath!))).toBe(true)
    expect(calls[0].references).toEqual([])
    expect(calls[0].aspect).toBe('2:3')
    expect(calls[0].prompt).toContain('LOCK')
    expect((await svc.get(ctx, c.id)).variations[0].status).toBe('ready')
  })

  it('variation uses the base as reference', async () => {
    const { svc, calls, ctx } = await setup()
    const c = await svc.create(ctx, input(), 'user')
    const base = await svc.generateVariationImage(ctx, c.id, c.variations[0].id)
    const v = await svc.addVariation(ctx, c.id, { name: 'Outfit: School uniform', kind: 'outfit', delta: 'navy blazer' }, 'ai')
    expect(v.status).toBe('pending')
    const out = await svc.generateVariationImage(ctx, c.id, v.id)
    expect(out.status).toBe('ready')
    expect(calls[1].references).toEqual([{ relPath: base.imagePath, label: 'base reference' }])
    expect(calls[1].prompt).toContain('Variation: Outfit: School uniform — ')
  })

  it('variation fails cleanly without a ready base', async () => {
    const { svc, calls, ctx } = await setup()
    const c = await svc.create(ctx, input(), 'user')
    const v = await svc.addVariation(ctx, c.id, { name: 'Outfit', kind: 'outfit', delta: 'x' }, 'user')
    const out = await svc.generateVariationImage(ctx, c.id, v.id)
    expect(out).toMatchObject({ status: 'failed', error: 'Base reference image is not ready' })
    expect(calls).toHaveLength(0)
  })

  it('generation errors mark failed without throwing and keep the previous image (Review Focus 2)', async () => {
    let fail = false
    const { svc, ctx } = await setup(async () => {
      if (fail) throw new ProviderError('unknown', 'boom')
      return { data: PNG, ext: 'png' }
    })
    const c = await svc.create(ctx, input(), 'user')
    const first = await svc.generateVariationImage(ctx, c.id, c.variations[0].id)
    fail = true
    const out = await svc.generateVariationImage(ctx, c.id, c.variations[0].id)
    expect(out).toMatchObject({ status: 'failed', error: 'boom', imagePath: first.imagePath })
    expect((await svc.get(ctx, c.id)).variations[0]).toMatchObject({ status: 'failed', error: 'boom', imagePath: first.imagePath })
    expect(fs.existsSync(ctx.paths.resolveAsset(first.imagePath!))).toBe(true)
  })

  it('shows pending while generating and does not hold the mutex across the image call (Ruling T15a)', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const { svc, ctx } = await setup(async () => {
      await gate
      return { data: PNG, ext: 'png' }
    })
    const c = await svc.create(ctx, input(), 'user')
    const running = svc.generateVariationImage(ctx, c.id, c.variations[0].id)
    await new Promise((r) => setTimeout(r, 30))
    expect((await svc.get(ctx, c.id)).variations[0].status).toBe('pending')
    await svc.update(ctx, c.id, { role: 'minor' })
    release()
    expect((await running).status).toBe('ready')
    expect((await svc.get(ctx, c.id)).role).toBe('minor')
  })

  it('an aborted generation ends failed Cancelled', async () => {
    const { svc, ctx } = await setup(async () => {
      const e = new Error('x')
      e.name = 'AbortError'
      throw e
    })
    const c = await svc.create(ctx, input(), 'user')
    const out = await svc.generateVariationImage(ctx, c.id, c.variations[0].id, { signal: new AbortController().signal })
    expect(out).toMatchObject({ status: 'failed', error: 'Cancelled' })
  })

  it('recovers interrupted generations', async () => {
    const { svc, ctx } = await setup()
    const ch = makeCharacter({ id: 'chr_aaaaaaaaaa', variations: [makeVariation({ characterId: 'chr_aaaaaaaaaa', status: 'pending' })] })
    await writeJsonAtomic(ctx.paths.characterFile(ch.id), ch)
    await svc.recoverInterrupted(ctx)
    expect((await svc.get(ctx, ch.id)).variations[0]).toMatchObject({ status: 'failed', error: 'Interrupted: the app closed during generation' })
  })

  it('refuses to delete a used character but archives (Review Focus 4)', async () => {
    const { svc, ctx, trashed } = await setup(undefined, ['pnl_1'])
    const c = await svc.create(ctx, input(), 'user')
    await expect(svc.delete(ctx, c.id)).rejects.toMatchObject({ name: 'CharacterInUseError', panelIds: ['pnl_1'] })
    await expect(svc.delete(ctx, c.id)).rejects.toBeInstanceOf(CharacterInUseError)
    expect(trashed).toEqual([])
    await svc.archive(ctx, c.id)
    expect((await svc.list(ctx)).map((x) => x.id)).toEqual([])
    expect((await svc.list(ctx, { includeArchived: true })).map((x) => x.id)).toEqual([c.id])
  })

  it('deletes an unused character to the trash', async () => {
    const { svc, ctx, trashed } = await setup()
    const c = await svc.create(ctx, input(), 'user')
    await svc.generateVariationImage(ctx, c.id, c.variations[0].id)
    await svc.delete(ctx, c.id)
    expect(trashed).toEqual([ctx.paths.characterFile(c.id), ctx.paths.characterDir(c.id)])
  })

  it('refuses to delete the base variation or a used variation', async () => {
    const { svc, ctx } = await setup()
    const c = await svc.create(ctx, input(), 'user')
    await expect(svc.deleteVariation(ctx, c.id, c.variations[0].id)).rejects.toThrow(/base/i)
    const v = await svc.addVariation(ctx, c.id, { name: 'Outfit', kind: 'outfit', delta: 'x' }, 'user')
    await svc.deleteVariation(ctx, c.id, v.id)
    expect((await svc.get(ctx, c.id)).variations).toHaveLength(1)
    const used = await setup(undefined, ['pnl_1'])
    const c2 = await used.svc.create(used.ctx, input('Zed'), 'user')
    const v2 = await used.svc.addVariation(used.ctx, c2.id, { name: 'Outfit', kind: 'outfit', delta: 'x' }, 'user')
    await expect(used.svc.deleteVariation(used.ctx, c2.id, v2.id)).rejects.toBeInstanceOf(CharacterInUseError)
  })

  it('uploads an image and validates the extension', async () => {
    const { svc, ctx } = await setup()
    const c = await svc.create(ctx, input(), 'user')
    const v = await svc.uploadVariationImage(ctx, c.id, c.variations[0].id, PNG, 'png')
    expect(v.status).toBe('ready')
    expect(fs.readFileSync(ctx.paths.resolveAsset(v.imagePath!)).equals(PNG)).toBe(true)
    await expect(svc.uploadVariationImage(ctx, c.id, c.variations[0].id, PNG, 'gif' as 'png')).rejects.toThrow(/extension/i)
  })

  it('flags appearance lock changes', async () => {
    const { svc, ctx } = await setup()
    const c = await svc.create(ctx, input(), 'user')
    expect((await svc.update(ctx, c.id, { appearanceLock: 'NEW' })).appearanceLockChanged).toBe(true)
    const same = await svc.update(ctx, c.id, { appearanceLock: 'NEW', appearance: { hair: 'red' } })
    expect(same.appearanceLockChanged).toBe(false)
    expect(same.character.appearance.hair).toBe('red')
  })

  it('skips and reports a corrupt character file (Review Focus 5)', async () => {
    const { svc, ctx } = await setup()
    const c = await svc.create(ctx, input(), 'user')
    await fs.promises.writeFile(ctx.paths.characterFile('chr_ffffffffff'), '{oops')
    expect((await svc.list(ctx)).map((x) => x.id)).toEqual([c.id])
    expect(ctx.problems.map((p) => p.path)).toContain('characters/chr_ffffffffff.json')
  })
})

describe('CharacterService recording failures', () => {
  const imagesIn = (ctx: { paths: { characterDir(id: string): string } }, id: string): string[] => {
    try {
      return fs.readdirSync(ctx.paths.characterDir(id))
    } catch {
      return []
    }
  }

  it('records failed and removes the orphan image when the success write fails', async () => {
    const { svc, ctx } = await setup(async () => {
      disk.failJsonWrites = 1
      return { data: PNG, ext: 'png' }
    })
    const c = await svc.create(ctx, input(), 'user')
    const out = await svc.generateVariationImage(ctx, c.id, c.variations[0].id)
    expect(out).toMatchObject({ status: 'failed', error: 'disk full' })
    expect((await svc.get(ctx, c.id)).variations[0]).toMatchObject({ status: 'failed', error: 'disk full', imagePath: null })
    expect(imagesIn(ctx, c.id)).toEqual([])
  })

  it('resolves failed, never throws, and leaves recoverInterrupted as backstop when every write fails', async () => {
    const { svc, ctx } = await setup(async () => {
      disk.failJsonWrites = 2
      return { data: PNG, ext: 'png' }
    })
    const c = await svc.create(ctx, input(), 'user')
    const out = await svc.generateVariationImage(ctx, c.id, c.variations[0].id)
    expect(out).toMatchObject({ status: 'failed', error: 'disk full' })
    expect(imagesIn(ctx, c.id)).toEqual([])
    expect((await svc.get(ctx, c.id)).variations[0].status).toBe('pending')
    await svc.recoverInterrupted(ctx)
    expect((await svc.get(ctx, c.id)).variations[0]).toMatchObject({ status: 'failed', error: 'Interrupted: the app closed during generation' })
  })

  it('resolves failed and leaves a file corrupted mid-generation alone', async () => {
    let file = ''
    const { svc, ctx } = await setup(async () => {
      await fs.promises.writeFile(file, '{oops')
      return { data: PNG, ext: 'png' }
    })
    const c = await svc.create(ctx, input(), 'user')
    file = ctx.paths.characterFile(c.id)
    const out = await svc.generateVariationImage(ctx, c.id, c.variations[0].id)
    expect(out.status).toBe('failed')
    expect(out.error).toMatch(/corrupt/i)
    expect(fs.readFileSync(file, 'utf8')).toBe('{oops')
    expect(imagesIn(ctx, c.id)).toEqual([])
  })

  it('reports Variation was deleted when the variation is removed mid-generation', async () => {
    let drop: () => Promise<void> = async () => undefined
    const { svc, ctx } = await setup(async () => {
      await drop()
      return { data: PNG, ext: 'png' }
    })
    const c = await svc.create(ctx, input(), 'user')
    await svc.generateVariationImage(ctx, c.id, c.variations[0].id)
    const v = await svc.addVariation(ctx, c.id, { name: 'Outfit', kind: 'outfit', delta: 'x' }, 'user')
    drop = () => svc.deleteVariation(ctx, c.id, v.id)
    const out = await svc.generateVariationImage(ctx, c.id, v.id)
    expect(out).toMatchObject({ id: v.id, status: 'failed', error: 'Variation was deleted' })
    expect((await svc.get(ctx, c.id)).variations).toHaveLength(1)
    expect(imagesIn(ctx, c.id)).toHaveLength(1)
  })

  it('reports Variation was deleted when the character is removed mid-generation', async () => {
    let file = ''
    const { svc, ctx } = await setup(async () => {
      await fs.promises.rm(file)
      return { data: PNG, ext: 'png' }
    })
    const c = await svc.create(ctx, input(), 'user')
    file = ctx.paths.characterFile(c.id)
    expect(await svc.generateVariationImage(ctx, c.id, c.variations[0].id)).toMatchObject({ status: 'failed', error: 'Variation was deleted' })
    expect(imagesIn(ctx, c.id)).toEqual([])
  })

  it('upload never marks pending and leaves the variation untouched when recording fails', async () => {
    const { svc, ctx } = await setup()
    const c = await svc.create(ctx, input(), 'user')
    const ready = await svc.generateVariationImage(ctx, c.id, c.variations[0].id)
    disk.failJsonWrites = 1
    await expect(svc.uploadVariationImage(ctx, c.id, c.variations[0].id, PNG, 'jpg')).rejects.toThrow('disk full')
    expect((await svc.get(ctx, c.id)).variations[0]).toMatchObject({ status: 'ready', imagePath: ready.imagePath })
    expect(imagesIn(ctx, c.id)).toHaveLength(1)
  })

  it('serializes concurrent creates of the same name', async () => {
    const { svc, ctx } = await setup()
    const results = await Promise.allSettled([svc.create(ctx, input('Mina'), 'user'), svc.create(ctx, input('mina'), 'user')])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(DuplicateCharacterError)
    expect(await svc.list(ctx)).toHaveLength(1)
  })

  it('recoverInterrupted skips a corrupt file, reports it, and still recovers the others', async () => {
    const { svc, ctx } = await setup()
    const ch = makeCharacter({ id: 'chr_aaaaaaaaaa', variations: [makeVariation({ characterId: 'chr_aaaaaaaaaa', status: 'pending' })] })
    await writeJsonAtomic(ctx.paths.characterFile(ch.id), ch)
    await fs.promises.writeFile(ctx.paths.characterFile('chr_ffffffffff'), '{oops')
    await expect(svc.recoverInterrupted(ctx)).resolves.toBeUndefined()
    expect((await svc.get(ctx, ch.id)).variations[0].status).toBe('failed')
    expect(ctx.problems.map((p) => p.path)).toContain('characters/chr_ffffffffff.json')
  })

  it('recoverInterrupted keeps going when one character cannot be rewritten', async () => {
    const { svc, ctx } = await setup()
    const mk = (id: string) => makeCharacter({ id, name: id, variations: [makeVariation({ characterId: id, status: 'pending' })] })
    await writeJsonAtomic(ctx.paths.characterFile('chr_aaaaaaaaaa'), mk('chr_aaaaaaaaaa'))
    await writeJsonAtomic(ctx.paths.characterFile('chr_bbbbbbbbbb'), mk('chr_bbbbbbbbbb'))
    disk.failJsonWrites = 1
    await expect(svc.recoverInterrupted(ctx)).resolves.toBeUndefined()
    const states = [(await svc.get(ctx, 'chr_aaaaaaaaaa')).variations[0].status, (await svc.get(ctx, 'chr_bbbbbbbbbb')).variations[0].status]
    expect(states.sort()).toEqual(['failed', 'pending'])
    expect(ctx.problems).toHaveLength(1)
  })
})

describe('createServices wiring', () => {
  it('recovers interrupted generations when a project is first opened', async () => {
    const s1 = await testServices()
    let s2: Awaited<ReturnType<typeof testServices>> | undefined
    try {
      const ctx = await s1.projects.create({ title: 'P' })
      const c = await s1.characters.create(ctx, input(), 'user')
      s2 = await testServices({ projectsRoot: s1.projectsRoot })
      const reopened = await s2.projects.open(ctx.id)
      expect((await s2.characters.get(reopened, c.id)).variations[0]).toMatchObject({ status: 'failed', error: 'Interrupted: the app closed during generation' })
    } finally {
      await s2?.cleanup()
      await s1.cleanup()
    }
  })
})
