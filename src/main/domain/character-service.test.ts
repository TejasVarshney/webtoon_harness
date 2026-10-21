import fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { writeJsonAtomic } from '../storage/atomic'
import { ProviderError } from '../models/providers/types'
import { encodeSolidPng } from '../models/providers/png'
import { makeCharacter, makeVariation } from '../test/factories'
import { testServices } from '../test/test-services'
import { tempProject, type TempProject } from '../test/temp-project'
import { CharacterInUseError, CharacterService, DuplicateCharacterError, type PanelUsageLookup } from './character-service'
import type { ImageGenRequest, ImageService } from './image-service'

const input = (name = 'Mina') => ({ name, role: 'protagonist' as const, appearanceLock: 'LOCK' })
const PNG = encodeSolidPng(2, 3, [1, 2, 3])

let tp: TempProject | undefined
afterEach(async () => {
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
