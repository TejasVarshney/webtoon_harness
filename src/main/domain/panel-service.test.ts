import fs from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Panel, PanelDraft, PanelVersion } from '@shared/types'
import { NoModelForRoleError, type ModelRegistry } from '../models/registry'
import { ProviderError, type ImageEditRequest, type ImageProvider, type ImageRequest, type ImageResult } from '../models/providers/types'
import { encodeSolidPng } from '../models/providers/png'
import { writeFileAtomic, writeJsonAtomic } from '../storage/atomic'
import type { ProjectContext } from '../storage/project-store'
import { makeCharacter, makePanel, makeVariation } from '../test/factories'
import { tempProject, type TempProject } from '../test/temp-project'
import { testServices } from '../test/test-services'
import { CharacterInUseError, CharacterService } from './character-service'
import { EntityNotFoundError } from './errors'
import { EpisodeService } from './episode-service'
import { createIdentityImageOps } from './image-ops'
import { ImageService } from './image-service'
import { PanelService, PanelValidationError } from './panel-service'

// Failure injection: while `disk.failJsonWrites > 0`, that many writeJsonAtomic calls reject.
// Episode writes consume the counter too, so tests arm it at the exact moment they mean.
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

const INTERRUPTED = 'Interrupted: the app closed during generation'
const USER = { createdBy: 'user' as const, strictMentions: false }
const AGENT = { createdBy: 'ai' as const, strictMentions: true }
const VERSION_KEYS = ['check', 'createdAt', 'error', 'id', 'imagePath', 'instruction', 'parentVersionId', 'prompt', 'referenceImagePaths', 'source', 'status']

let counter = 0
const nextPng = (): Buffer => encodeSolidPng(2, 2, [++counter % 250, 7, 7])
const PNG = encodeSolidPng(2, 3, [1, 2, 3])

let tp: TempProject | undefined
afterEach(async () => {
  disk.failJsonWrites = 0
  vi.restoreAllMocks()
  await tp?.cleanup()
  tp = undefined
})

interface Behavior {
  generate: (req: ImageRequest) => Promise<ImageResult>
  edit: (req: ImageEditRequest) => Promise<ImageResult>
}

async function setup() {
  const t = await tempProject()
  tp = t
  const calls: { fn: 'generate' | 'edit'; req: ImageRequest | ImageEditRequest }[] = []
  const roles: string[] = []
  const noModel = new Set<string>()
  const maxRefs: Record<string, number> = {}
  const behavior: Behavior = {
    generate: async () => ({ mime: 'image/png', data: nextPng() }),
    edit: async () => ({ mime: 'image/png', data: nextPng() })
  }
  // A real ImageService over a fake registry and provider: references are really loaded from disk.
  const registry = {
    resolve: (role: string) => {
      roles.push(role)
      if (noModel.has(role)) throw new NoModelForRoleError(role as 'image')
      return { endpoint: { kind: 'mock' }, model: { maxReferenceImages: maxRefs[role] ?? 4 }, apiKey: null }
    }
  } as unknown as ModelRegistry
  const provider: ImageProvider = {
    generate: (req) => {
      calls.push({ fn: 'generate', req })
      return behavior.generate(req)
    },
    edit: (req) => {
      calls.push({ fn: 'edit', req })
      return behavior.edit(req)
    }
  }
  const images = new ImageService({ registry, imageOps: createIdentityImageOps(), createImageProvider: () => provider })
  const trashed: string[] = []
  const trash = async (p: string): Promise<void> => {
    trashed.push(p)
    await fs.promises.rm(p, { recursive: true, force: true })
  }
  const episodes = new EpisodeService({ bus: t.bus })
  let svc!: PanelService
  const characters = new CharacterService({
    bus: t.bus,
    images,
    projects: t.store,
    trash,
    usage: { panelsUsingCharacter: (c, id) => svc.panelsUsingCharacter(c, id), panelsUsingVariation: (c, id) => svc.panelsUsingVariation(c, id) }
  })
  svc = new PanelService({ bus: t.bus, projects: t.store, episodes, characters, images, trash })
  const [epi] = await episodes.list(t.ctx)
  t.events.length = 0
  return { svc, characters, episodes, epi, ctx: t.ctx, events: t.events, store: t.store, trashed, calls, roles, noModel, maxRefs, behavior }
}

interface Cast {
  id: string
  name: string
  varId: string
  varId2: string
  imagePath: string
}

/** A character whose base variation (and a second variation) are `ready` with real image files. */
async function addCharacter(ctx: ProjectContext, key: string, name: string, over: { archived?: boolean; ready?: boolean } = {}): Promise<Cast> {
  const id = `chr_${key}`
  const varId = `var_${key}`
  const varId2 = `var_${key.slice(0, 9)}2`
  const imagePath = `characters/${id}/${varId}.png`
  await writeFileAtomic(ctx.paths.resolveAsset(imagePath), PNG)
  const status = over.ready === false ? ('failed' as const) : ('ready' as const)
  const variation = (vid: string, kind: 'base' | 'outfit') =>
    makeVariation({ id: vid, characterId: id, name: kind === 'base' ? 'Base' : 'Outfit', kind, status, imagePath: status === 'ready' ? imagePath : null })
  await writeJsonAtomic(ctx.paths.characterFile(id), makeCharacter({ id, name, archived: over.archived ?? false, variations: [variation(varId, 'base'), variation(varId2, 'outfit')] }))
  return { id, name, varId, varId2, imagePath }
}

const mina = (ctx: ProjectContext): Promise<Cast> => addCharacter(ctx, 'aaaaaaaaaa', 'Mina')
const zed = (ctx: ProjectContext): Promise<Cast> => addCharacter(ctx, 'bbbbbbbbbb', 'Zed')

const castOf = (c: Cast, extra: { variationId?: string; action?: string } = {}) => ({
  characterId: c.id,
  variationId: extra.variationId ?? c.varId,
  action: extra.action ?? '',
  expression: '',
  position: 'center' as const
})

const draft = (episodeId: string, over: Partial<PanelDraft> = {}): PanelDraft => ({
  episodeId,
  description: 'A door opens.',
  setting: 'Hallway',
  shot: 'medium',
  characters: [],
  dialogue: [],
  ...over
})

/** Writes a panel file by hand and appends it to its episode: for states the service itself never produces. */
async function plant(ctx: ProjectContext, episodes: EpisodeService, panel: Panel): Promise<void> {
  await writeJsonAtomic(ctx.paths.panelFile(panel.id), panel)
  await episodes.insertPanel(ctx, panel.episodeId, panel.id, undefined)
}

const version = (over: Partial<PanelVersion> = {}): PanelVersion => ({
  id: 'ver_0000000001',
  source: 'generate',
  status: 'ready',
  error: null,
  imagePath: null,
  prompt: 'p',
  referenceImagePaths: [],
  instruction: null,
  parentVersionId: null,
  check: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  ...over
})

/** Like `plant`, with one ready image as the current version. */
async function plantWithImage(ctx: ProjectContext, episodes: EpisodeService, panel: Panel): Promise<void> {
  const rel = `panels/${panel.id}/ver_0000000001.png`
  await writeFileAtomic(ctx.paths.resolveAsset(rel), PNG)
  await plant(ctx, episodes, { ...panel, versions: [version({ source: 'upload', imagePath: rel })], currentVersionId: 'ver_0000000001' })
}

const panelImages = (ctx: ProjectContext, id: string): string[] => {
  try {
    return fs.readdirSync(ctx.paths.panelDir(id))
  } catch {
    return []
  }
}

describe('PanelService create and list', () => {
  it('auto-creates Episode 1 and inserts panels in order', async () => {
    const { svc, episodes, ctx } = await setup()
    const eps = await episodes.list(ctx)
    expect(eps).toHaveLength(1)
    const ep = eps[0]
    const p1 = (await svc.create(ctx, draft(ep.id, { description: 'one' }), USER)).panel
    const p2 = (await svc.create(ctx, draft(ep.id, { description: 'two' }), USER)).panel
    const p3 = (await svc.create(ctx, draft(ep.id, { description: 'three', afterPanelId: p1.id }), USER)).panel
    expect((await svc.list(ctx, ep.id)).map((p) => p.id)).toEqual([p1.id, p3.id, p2.id])
    const p0 = (await svc.create(ctx, draft(ep.id, { description: 'zero', afterPanelId: null }), USER)).panel
    expect((await svc.list(ctx, ep.id)).map((p) => p.description)).toEqual(['zero', 'one', 'three', 'two'])
    expect((await episodes.get(ctx, ep.id)).panelIds).toEqual([p0.id, p1.id, p3.id, p2.id])
  })

  it('fills defaults: aspect from the project, dlg ids, empty history', async () => {
    const { svc, store, epi, ctx, events } = await setup()
    const m = await mina(ctx)
    await store.updateMeta(ctx, { defaultAspect: '16:9' })
    events.length = 0
    const { panel, warnings } = await svc.create(
      ctx,
      draft(epi.id, { characters: [castOf(m)], dialogue: [{ speakerId: m.id, kind: 'speech', text: 'Hi' }, { speakerId: null, kind: 'narration', text: 'Night.' }] }),
      AGENT
    )
    expect(warnings).toEqual([])
    expect(panel).toMatchObject({ episodeId: epi.id, aspect: '16:9', continuityNotes: '', offPanelMentions: [], versions: [], currentVersionId: null, createdBy: 'ai' })
    expect(panel.id).toMatch(/^pnl_[0-9a-f]{10}$/)
    expect(panel.dialogue.map((d) => d.id)).toEqual([expect.stringMatching(/^dlg_[0-9a-f]{10}$/), expect.stringMatching(/^dlg_[0-9a-f]{10}$/)])
    expect(panel.dialogue[0]).toMatchObject({ speakerId: m.id, kind: 'speech', text: 'Hi' })
    expect(await svc.get(ctx, panel.id)).toEqual(panel)
    expect(events).toEqual(expect.arrayContaining([{ type: 'panel.changed', projectId: ctx.id, panelId: panel.id }, { type: 'episode.changed', projectId: ctx.id, episodeId: epi.id }]))
    const explicit = (await svc.create(ctx, draft(epi.id, { aspect: '1:1' }), USER)).panel
    expect(explicit.aspect).toBe('1:1')
  })

  it('rejects invalid drafts with all issues and writes nothing', async () => {
    const { svc, epi, episodes, ctx } = await setup()
    const err = await svc
      .create(ctx, draft(epi.id, { characters: [castOf({ id: 'chr_ffffffffff', varId: 'var_ffffffffff' } as Cast)], dialogue: [{ speakerId: 'chr_eeeeeeeeee', kind: 'speech', text: 'x' }] }), USER)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PanelValidationError)
    expect((err as PanelValidationError).issues).toEqual(['Unknown character: chr_ffffffffff', 'Unknown speaker: chr_eeeeeeeeee'])
    expect((err as Error).message).toBe('Unknown character: chr_ffffffffff\nUnknown speaker: chr_eeeeeeeeee')
    expect((err as Error).name).toBe('PanelValidationError')
    expect(fs.readdirSync(ctx.paths.panelsDir())).toEqual([])
    expect((await episodes.get(ctx, epi.id)).panelIds).toEqual([])
  })

  it('rejects archived characters and unready variations for new panels', async () => {
    const { svc, epi, ctx } = await setup()
    const m = await addCharacter(ctx, 'aaaaaaaaaa', 'Mina', { archived: true })
    const z = await addCharacter(ctx, 'bbbbbbbbbb', 'Zed', { ready: false })
    await expect(svc.create(ctx, draft(epi.id, { characters: [castOf(m)] }), USER)).rejects.toMatchObject({ issues: ['Character Mina is archived'] })
    await expect(svc.create(ctx, draft(epi.id, { characters: [castOf(z)] }), USER)).rejects.toMatchObject({ issues: ['Variation "Base" of Zed has no ready reference image'] })
  })

  it('turns the mention guard into a warning for the editor and an error for the agent', async () => {
    const { svc, epi, ctx } = await setup()
    await zed(ctx)
    const d = draft(epi.id, { description: 'Zed waits outside.' })
    const manual = await svc.create(ctx, d, USER)
    expect(manual.warnings).toHaveLength(1)
    expect(manual.warnings[0]).toMatch(/^Mentioned but not attached: Zed/)
    await expect(svc.create(ctx, d, AGENT)).rejects.toBeInstanceOf(PanelValidationError)
    expect(await svc.list(ctx, epi.id)).toHaveLength(1)
  })

  it('refuses an unknown episode or anchor panel and leaves no panel file behind', async () => {
    const { svc, epi, ctx } = await setup()
    await expect(svc.create(ctx, draft('epi_ffffffffff'), USER)).rejects.toBeInstanceOf(EntityNotFoundError)
    await expect(svc.create(ctx, draft(epi.id, { afterPanelId: 'pnl_ffffffffff' }), USER)).rejects.toThrow('Unknown panel: pnl_ffffffffff')
    expect(fs.readdirSync(ctx.paths.panelsDir())).toEqual([])
  })

  it('removes the panel file again when inserting it into the episode fails', async () => {
    const { svc, epi, episodes, ctx } = await setup()
    vi.spyOn(episodes, 'insertPanel').mockRejectedValueOnce(new Error('episode locked'))
    await expect(svc.create(ctx, draft(epi.id), USER)).rejects.toThrow('episode locked')
    expect(fs.readdirSync(ctx.paths.panelsDir())).toEqual([])
  })

  it('get throws EntityNotFoundError for an unknown panel', async () => {
    const { svc, ctx } = await setup()
    await expect(svc.get(ctx, 'pnl_ffffffffff')).rejects.toThrow('Unknown panel: pnl_ffffffffff')
  })

  it('list skips and reports a corrupt panel file, and skips a missing one (Review Focus 5)', async () => {
    const { svc, epi, episodes, ctx } = await setup()
    const a = (await svc.create(ctx, draft(epi.id, { description: 'a' }), USER)).panel
    const b = (await svc.create(ctx, draft(epi.id, { description: 'b' }), USER)).panel
    const c = (await svc.create(ctx, draft(epi.id, { description: 'c' }), USER)).panel
    await episodes.insertPanel(ctx, epi.id, 'pnl_eeeeeeeeee', undefined)
    await fs.promises.writeFile(ctx.paths.panelFile(b.id), '{oops')
    expect((await svc.list(ctx, epi.id)).map((p) => p.id)).toEqual([a.id, c.id])
    expect(ctx.problems.map((p) => p.path)).toEqual([`panels/${b.id}.json`])
    await svc.list(ctx, epi.id)
    expect(ctx.problems).toHaveLength(1)
  })

  it('previousPanel is the panel before it in episode order, else null', async () => {
    const { svc, epi, ctx } = await setup()
    const p1 = (await svc.create(ctx, draft(epi.id), USER)).panel
    const p2 = (await svc.create(ctx, draft(epi.id), USER)).panel
    expect((await svc.previousPanel(ctx, p2.id))?.id).toBe(p1.id)
    expect(await svc.previousPanel(ctx, p1.id)).toBeNull()
    await expect(svc.previousPanel(ctx, 'pnl_ffffffffff')).rejects.toBeInstanceOf(EntityNotFoundError)
  })
})

describe('PanelService update', () => {
  it('concurrent updates do not lose fields', async () => {
    const { svc, epi, ctx } = await setup()
    const p = (await svc.create(ctx, draft(epi.id), USER)).panel
    await Promise.all([svc.update(ctx, p.id, { description: 'New description' }, USER), svc.update(ctx, p.id, { setting: 'New setting' }, USER)])
    expect(await svc.get(ctx, p.id)).toMatchObject({ description: 'New description', setting: 'New setting' })
  })

  it('changes only the named fields and gives replaced dialogue fresh ids', async () => {
    const { svc, epi, ctx, events } = await setup()
    const m = await mina(ctx)
    const p = (await svc.create(ctx, draft(epi.id, { characters: [castOf(m)], continuityNotes: 'rain', dialogue: [{ speakerId: null, kind: 'narration', text: 'old' }] }), USER)).panel
    events.length = 0
    const { panel } = await svc.update(ctx, p.id, { dialogue: [{ speakerId: m.id, kind: 'thought', text: 'new' }], shot: 'close-up' }, USER)
    expect(panel).toMatchObject({ shot: 'close-up', description: p.description, setting: p.setting, continuityNotes: 'rain', characters: p.characters })
    expect(panel.dialogue).toEqual([{ id: expect.stringMatching(/^dlg_/), speakerId: m.id, kind: 'thought', text: 'new' }])
    expect(panel.dialogue[0].id).not.toBe(p.dialogue[0].id)
    expect(await svc.get(ctx, p.id)).toEqual(panel)
    expect(events).toEqual([{ type: 'panel.changed', projectId: ctx.id, panelId: p.id }])
    await expect(svc.update(ctx, 'pnl_ffffffffff', { shot: 'wide' }, USER)).rejects.toBeInstanceOf(EntityNotFoundError)
  })

  it('validates the merged panel and leaves the file untouched on error', async () => {
    const { svc, epi, ctx } = await setup()
    const p = (await svc.create(ctx, draft(epi.id), USER)).panel
    const before = fs.readFileSync(ctx.paths.panelFile(p.id), 'utf8')
    await expect(svc.update(ctx, p.id, { dialogue: [{ speakerId: 'chr_eeeeeeeeee', kind: 'speech', text: 'x' }] }, USER)).rejects.toMatchObject({ issues: ['Unknown speaker: chr_eeeeeeeeee'] })
    expect(fs.readFileSync(ctx.paths.panelFile(p.id), 'utf8')).toBe(before)
    await zed(ctx)
    const warned = await svc.update(ctx, p.id, { description: 'Zed arrives.' }, USER)
    expect(warned.warnings[0]).toMatch(/Mentioned but not attached: Zed/)
    expect(warned.panel.description).toBe('Zed arrives.')
    await expect(svc.update(ctx, p.id, { description: 'Zed leaves.' }, AGENT)).rejects.toBeInstanceOf(PanelValidationError)
    expect((await svc.get(ctx, p.id)).description).toBe('Zed arrives.')
  })

  it('rejects casting the same character twice', async () => {
    const { svc, epi, ctx } = await setup()
    const m = await mina(ctx)
    const p = (await svc.create(ctx, draft(epi.id, { characters: [castOf(m)] }), USER)).panel
    await expect(svc.update(ctx, p.id, { characters: [castOf(m), castOf(m, { variationId: m.varId2 })] }, USER)).rejects.toMatchObject({ issues: ['Mina is cast twice'] })
  })

  it('keeps a since-archived character editable and regenerable, but rejects archived casts that are new or changed (Review Focus 4)', async () => {
    const { svc, characters, epi, ctx, calls } = await setup()
    const m = await mina(ctx)
    const z = await zed(ctx)
    const p = (await svc.create(ctx, draft(epi.id, { characters: [castOf(m)] }), USER)).panel
    await characters.archive(ctx, m.id)
    await characters.archive(ctx, z.id)

    const dialogue = await svc.update(ctx, p.id, { dialogue: [{ speakerId: m.id, kind: 'speech', text: 'Still here.' }] }, AGENT)
    expect(dialogue.panel.dialogue[0].text).toBe('Still here.')
    const acted = await svc.update(ctx, p.id, { characters: [castOf(m, { action: 'runs' })] }, AGENT)
    expect(acted.panel.characters[0].action).toBe('runs')

    await expect(svc.update(ctx, p.id, { characters: [castOf(m), castOf(z)] }, AGENT)).rejects.toMatchObject({ issues: ['Character Zed is archived'] })
    await expect(svc.update(ctx, p.id, { characters: [castOf(m, { variationId: m.varId2 })] }, AGENT)).rejects.toMatchObject({ issues: ['Character Mina is archived'] })
    await expect(svc.update(ctx, p.id, { characters: [castOf(m), castOf(m, { variationId: m.varId2 })] }, AGENT)).rejects.toMatchObject({ issues: ['Character Mina is archived'] })
    await expect(svc.create(ctx, draft(epi.id, { characters: [castOf(m)] }), AGENT)).rejects.toMatchObject({ issues: ['Character Mina is archived'] })

    const v = await svc.generate(ctx, p.id)
    expect(v.status).toBe('ready')
    expect(v.referenceImagePaths).toEqual([m.imagePath])
    expect(calls).toHaveLength(1)
  })

  it('accepts an update of a panel whose unchanged cast variation later went failed, but still checks new or changed entries (Ruling T18b)', async () => {
    const { svc, characters, epi, ctx } = await setup()
    const m = await mina(ctx)
    const p = (await svc.create(ctx, draft(epi.id, { characters: [castOf(m)] }), AGENT)).panel
    // Mina's base regeneration fails (the old image path is kept, as CharacterService does); her outfit never worked.
    const stored = await characters.get(ctx, m.id)
    await writeJsonAtomic(ctx.paths.characterFile(m.id), { ...stored, variations: stored.variations.map((v) => ({ ...v, status: 'failed', error: 'boom' })) })

    const dialogue = await svc.update(ctx, p.id, { dialogue: [{ speakerId: m.id, kind: 'speech', text: 'Still here.' }] }, AGENT)
    expect(dialogue.panel.dialogue[0].text).toBe('Still here.')
    const acted = await svc.update(ctx, p.id, { characters: [castOf(m, { action: 'runs' })] }, AGENT)
    expect(acted.panel.characters[0].action).toBe('runs')

    await expect(svc.update(ctx, p.id, { characters: [castOf(m, { variationId: m.varId2 })] }, AGENT)).rejects.toMatchObject({ issues: ['Variation "Outfit" of Mina has no ready reference image'] })
    await expect(svc.update(ctx, p.id, { characters: [castOf(m), castOf(m, { variationId: m.varId2 })] }, AGENT)).rejects.toMatchObject({
      issues: ['Mina is cast twice', 'Variation "Outfit" of Mina has no ready reference image']
    })
    expect((await svc.get(ctx, p.id)).characters.map((c) => c.variationId)).toEqual([m.varId])
  })

  it('still reports an unknown character or foreign variation in an unchanged cast entry', async () => {
    const { svc, episodes, epi, ctx } = await setup()
    const m = await mina(ctx)
    await plant(ctx, episodes, makePanel({ id: 'pnl_8888888888', episodeId: epi.id, characters: [{ characterId: 'chr_ffffffffff', variationId: 'var_ffffffffff' }] }))
    await plant(ctx, episodes, makePanel({ id: 'pnl_9999999999', episodeId: epi.id, characters: [{ characterId: m.id, variationId: 'var_ffffffffff' }] }))
    const dialogue = [{ speakerId: null, kind: 'narration' as const, text: 'x' }]
    await expect(svc.update(ctx, 'pnl_8888888888', { dialogue }, USER)).rejects.toMatchObject({ issues: ['Unknown character: chr_ffffffffff'] })
    await expect(svc.update(ctx, 'pnl_9999999999', { dialogue }, USER)).rejects.toMatchObject({ issues: ['Variation var_ffffffffff does not belong to Mina'] })
  })
})

describe('PanelService generate', () => {
  it('uses the previous ready panel as a reference and becomes current', async () => {
    const { svc, epi, ctx, calls } = await setup()
    const m = await mina(ctx)
    const p1 = (await svc.create(ctx, draft(epi.id, { characters: [castOf(m)] }), USER)).panel
    const p2 = (await svc.create(ctx, draft(epi.id, { characters: [castOf(m)] }), USER)).panel
    const v1 = await svc.generate(ctx, p1.id)
    const v2 = await svc.generate(ctx, p2.id)
    expect(v1.prompt).not.toContain('[CONTINUITY]')
    expect(v1.referenceImagePaths).toEqual([m.imagePath])
    expect(v2.referenceImagePaths).toContain(v1.imagePath)
    expect(v2.referenceImagePaths).toEqual([m.imagePath, v1.imagePath])
    expect(v2.prompt).toContain('[CONTINUITY]')
    expect((await svc.get(ctx, p2.id)).currentVersionId).toBe(v2.id)
    expect((await svc.get(ctx, p1.id)).currentVersionId).toBe(v1.id)
    expect(calls[1].req.references.map((r) => r.label)).toEqual(['Mina', 'previous panel'])
    expect(calls[1].req.prompt).toBe(v2.prompt)
    expect(calls[1].req.aspect).toBe('2:3')
  })

  it('records a complete version: every field set, image saved under the panel folder', async () => {
    const { svc, epi, ctx, behavior } = await setup()
    behavior.generate = async () => ({ mime: 'image/jpeg', data: PNG })
    const p = (await svc.create(ctx, draft(epi.id), USER)).panel
    const v = await svc.generate(ctx, p.id)
    expect(Object.keys(v).sort()).toEqual(VERSION_KEYS)
    expect(v).toMatchObject({ source: 'generate', status: 'ready', error: null, instruction: null, parentVersionId: null, check: null, referenceImagePaths: [] })
    expect(v.id).toMatch(/^ver_[0-9a-f]{10}$/)
    expect(v.imagePath).toBe(`panels/${p.id}/${v.id}.jpg`)
    expect(fs.readFileSync(ctx.paths.resolveAsset(v.imagePath!)).equals(PNG)).toBe(true)
    const stored = await svc.get(ctx, p.id)
    expect(stored.versions).toEqual([v])
    expect(stored.currentVersionId).toBe(v.id)
  })

  it('uses no continuity when the immediately previous panel has no ready image (does not skip back)', async () => {
    const { svc, epi, ctx } = await setup()
    const p1 = (await svc.create(ctx, draft(epi.id), USER)).panel
    await svc.create(ctx, draft(epi.id), USER)
    const p3 = (await svc.create(ctx, draft(epi.id), USER)).panel
    const v1 = await svc.generate(ctx, p1.id)
    const v3 = await svc.generate(ctx, p3.id)
    expect(v3.prompt).not.toContain('[CONTINUITY]')
    expect(v3.referenceImagePaths).not.toContain(v1.imagePath)
  })

  it('references the previous panel’s current ready version, not its latest failed attempt', async () => {
    const { svc, epi, ctx, behavior } = await setup()
    const p1 = (await svc.create(ctx, draft(epi.id), USER)).panel
    const p2 = (await svc.create(ctx, draft(epi.id), USER)).panel
    const v1 = await svc.generate(ctx, p1.id)
    behavior.generate = async () => {
      throw new ProviderError('unknown', 'boom')
    }
    expect((await svc.generate(ctx, p1.id)).status).toBe('failed')
    behavior.generate = async () => ({ mime: 'image/png', data: nextPng() })
    const v2 = await svc.generate(ctx, p2.id)
    expect(v2.referenceImagePaths).toEqual([v1.imagePath])
  })

  it('caps references by the image role’s limit', async () => {
    const { svc, epi, ctx, maxRefs, roles } = await setup()
    const m = await mina(ctx)
    maxRefs.image = 1
    const p1 = (await svc.create(ctx, draft(epi.id), USER)).panel
    const p2 = (await svc.create(ctx, draft(epi.id, { characters: [castOf(m)] }), USER)).panel
    await svc.generate(ctx, p1.id)
    const v2 = await svc.generate(ctx, p2.id)
    expect(roles).toContain('image')
    expect(v2.referenceImagePaths).toEqual([m.imagePath])
    expect(v2.prompt).toContain('(no reference image)')
  })

  it('appends extraInstruction as a [FIX] line', async () => {
    const { svc, epi, ctx, calls } = await setup()
    const p = (await svc.create(ctx, draft(epi.id), USER)).panel
    const plain = await svc.generate(ctx, p.id)
    const fixed = await svc.generate(ctx, p.id, { extraInstruction: 'Fix these consistency issues: wrong hair' })
    expect(fixed.prompt).toBe(`${plain.prompt}\n[FIX] Fix these consistency issues: wrong hair`)
    expect(calls[1].req.prompt).toBe(fixed.prompt)
    const blank = await svc.generate(ctx, p.id, { extraInstruction: '  ' })
    expect(blank.prompt).toBe(plain.prompt)
  })

  it('a failed generation keeps the previous good version current (Review Focus 2)', async () => {
    const { svc, epi, ctx, behavior, events } = await setup()
    const p = (await svc.create(ctx, draft(epi.id), USER)).panel
    const v1 = await svc.generate(ctx, p.id)
    behavior.generate = async () => {
      throw new ProviderError('unknown', 'boom')
    }
    events.length = 0
    const v2 = await svc.generate(ctx, p.id)
    expect(v2).toMatchObject({ status: 'failed', error: 'boom', imagePath: null, source: 'generate' })
    expect(Object.keys(v2).sort()).toEqual(VERSION_KEYS)
    const stored = await svc.get(ctx, p.id)
    expect(stored.currentVersionId).toBe(v1.id)
    expect(stored.versions.map((v) => [v.id, v.status])).toEqual([[v1.id, 'ready'], [v2.id, 'failed']])
    expect(stored.versions[1].error).toBe('boom')
    expect(fs.existsSync(ctx.paths.resolveAsset(v1.imagePath!))).toBe(true)
    expect(panelImages(ctx, p.id)).toEqual([`${v1.id}.png`])
    expect(events.filter((e) => e.type === 'panel.changed').length).toBeGreaterThan(0)
  })

  it('shows a pending version while generating and does not hold the panel lock across the image call', async () => {
    const { svc, epi, ctx, behavior } = await setup()
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    behavior.generate = async () => {
      await gate
      return { mime: 'image/png', data: PNG }
    }
    const p = (await svc.create(ctx, draft(epi.id), USER)).panel
    const running = svc.generate(ctx, p.id)
    await new Promise((r) => setTimeout(r, 30))
    const during = await svc.get(ctx, p.id)
    expect(during.versions).toHaveLength(1)
    expect(during.versions[0]).toMatchObject({ status: 'pending', error: null, imagePath: null })
    expect(during.versions[0].prompt).toContain('[ACTION] A door opens.')
    expect(during.currentVersionId).toBeNull()
    await svc.update(ctx, p.id, { description: 'Edited meanwhile' }, USER)
    release()
    expect((await running).status).toBe('ready')
    expect(await svc.get(ctx, p.id)).toMatchObject({ description: 'Edited meanwhile', versions: [{ status: 'ready' }] })
  })

  it('an unknown or foreign variation becomes a failed version without calling the model (Ruling T18a)', async () => {
    const { svc, episodes, epi, ctx, calls } = await setup()
    const m = await mina(ctx)
    await plant(ctx, episodes, makePanel({ id: 'pnl_1111111111', episodeId: epi.id, characters: [{ characterId: 'chr_ffffffffff', variationId: 'var_ffffffffff' }] }))
    await plant(ctx, episodes, makePanel({ id: 'pnl_2222222222', episodeId: epi.id, characters: [{ characterId: m.id, variationId: 'var_ffffffffff' }] }))
    const unknown = await svc.generate(ctx, 'pnl_1111111111')
    expect(unknown).toMatchObject({ status: 'failed', error: 'Unknown character: chr_ffffffffff', imagePath: null, prompt: '', referenceImagePaths: [] })
    expect(Object.keys(unknown).sort()).toEqual(VERSION_KEYS)
    const foreign = await svc.generate(ctx, 'pnl_2222222222')
    expect(foreign).toMatchObject({ status: 'failed', error: 'Variation var_ffffffffff does not belong to Mina' })
    expect(calls).toEqual([])
    const stored = await svc.get(ctx, 'pnl_1111111111')
    expect(stored.versions).toEqual([unknown])
    expect(stored.currentVersionId).toBeNull()
  })

  it('a missing image model becomes a failed version, not a throw', async () => {
    const { svc, epi, ctx, noModel, calls } = await setup()
    const p = (await svc.create(ctx, draft(epi.id), USER)).panel
    const ok = await svc.generate(ctx, p.id)
    noModel.add('image')
    const out = await svc.generate(ctx, p.id)
    expect(out).toMatchObject({ status: 'failed', error: "No model assigned to role 'image'. Open Settings → Models." })
    expect(calls).toHaveLength(1)
    expect((await svc.get(ctx, p.id)).currentVersionId).toBe(ok.id)
  })

  it('an aborted generation ends failed Cancelled and passes the signal through', async () => {
    const { svc, epi, ctx, behavior } = await setup()
    behavior.generate = (req) => new Promise((_, reject) => req.signal.addEventListener('abort', () => reject(req.signal.reason)))
    const p = (await svc.create(ctx, draft(epi.id), USER)).panel
    const ac = new AbortController()
    const running = svc.generate(ctx, p.id, { signal: ac.signal })
    await new Promise((r) => setTimeout(r, 30))
    ac.abort()
    expect(await running).toMatchObject({ status: 'failed', error: 'Cancelled' })
    expect((await svc.get(ctx, p.id)).versions[0]).toMatchObject({ status: 'failed', error: 'Cancelled' })
  })

  it('throws only for an unknown panel', async () => {
    const { svc, ctx } = await setup()
    await expect(svc.generate(ctx, 'pnl_ffffffffff')).rejects.toBeInstanceOf(EntityNotFoundError)
  })
})

describe('PanelService recording failures (Review Focus 2)', () => {
  it('records failed and removes the orphan image when the success write fails', async () => {
    const { svc, epi, ctx, behavior } = await setup()
    behavior.generate = async () => {
      disk.failJsonWrites = 1
      return { mime: 'image/png', data: PNG }
    }
    const p = (await svc.create(ctx, draft(epi.id), USER)).panel
    const out = await svc.generate(ctx, p.id)
    expect(out).toMatchObject({ status: 'failed', error: 'disk full', imagePath: null })
    const stored = await svc.get(ctx, p.id)
    expect(stored.versions).toMatchObject([{ status: 'failed', error: 'disk full', imagePath: null }])
    expect(stored.currentVersionId).toBeNull()
    expect(panelImages(ctx, p.id)).toEqual([])
  })

  it('resolves failed, never throws, and leaves recoverInterrupted as the backstop when every write fails', async () => {
    const { svc, epi, ctx, behavior } = await setup()
    behavior.generate = async () => {
      disk.failJsonWrites = 2
      return { mime: 'image/png', data: PNG }
    }
    const p = (await svc.create(ctx, draft(epi.id), USER)).panel
    const out = await svc.generate(ctx, p.id)
    expect(out).toMatchObject({ status: 'failed', error: 'disk full' })
    expect(panelImages(ctx, p.id)).toEqual([])
    expect((await svc.get(ctx, p.id)).versions[0].status).toBe('pending')
    await svc.recoverInterrupted(ctx)
    expect((await svc.get(ctx, p.id)).versions[0]).toMatchObject({ status: 'failed', error: INTERRUPTED })
  })

  it('resolves failed without calling the model when the pending version cannot be saved', async () => {
    const { svc, epi, ctx, calls } = await setup()
    const p = (await svc.create(ctx, draft(epi.id), USER)).panel
    disk.failJsonWrites = 1
    const out = await svc.generate(ctx, p.id)
    expect(out).toMatchObject({ status: 'failed', error: 'disk full' })
    expect(calls).toEqual([])
    expect((await svc.get(ctx, p.id)).versions).toEqual([])
  })

  it('resolves failed and leaves a file corrupted mid-generation alone', async () => {
    const { svc, epi, ctx, behavior } = await setup()
    let file = ''
    behavior.generate = async () => {
      await fs.promises.writeFile(file, '{oops')
      return { mime: 'image/png', data: PNG }
    }
    const p = (await svc.create(ctx, draft(epi.id), USER)).panel
    file = ctx.paths.panelFile(p.id)
    const out = await svc.generate(ctx, p.id)
    expect(out.status).toBe('failed')
    expect(out.error).toMatch(/corrupt/i)
    expect(fs.readFileSync(file, 'utf8')).toBe('{oops')
    expect(panelImages(ctx, p.id)).toEqual([])
  })

  it('reports Panel was deleted, writing nothing, when the panel is deleted mid-generation', async () => {
    const { svc, epi, ctx, behavior, events } = await setup()
    let drop: () => Promise<void> = async () => undefined
    behavior.generate = async () => {
      await drop()
      return { mime: 'image/png', data: PNG }
    }
    const p = (await svc.create(ctx, draft(epi.id), USER)).panel
    drop = () => svc.delete(ctx, p.id)
    events.length = 0
    const out = await svc.generate(ctx, p.id)
    expect(out).toMatchObject({ status: 'failed', error: 'Panel was deleted' })
    expect(fs.existsSync(ctx.paths.panelFile(p.id))).toBe(false)
    expect(panelImages(ctx, p.id)).toEqual([])
    expect(fs.existsSync(ctx.paths.panelDir(p.id))).toBe(false)
  })

  it('reports Panel was deleted when the panel file vanishes before the pending version is saved', async () => {
    const { svc, epi, ctx, calls } = await setup()
    const p = (await svc.create(ctx, draft(epi.id), USER)).panel
    const real = svc.get.bind(svc)
    vi.spyOn(svc, 'get').mockImplementationOnce(async (c, id) => {
      const panel = await real(c, id)
      await fs.promises.rm(c.paths.panelFile(id))
      return panel
    })
    expect(await svc.generate(ctx, p.id)).toMatchObject({ status: 'failed', error: 'Panel was deleted' })
    expect(calls).toEqual([])
  })
})

describe('PanelService editImage', () => {
  it('creates a child version from the current image through the imageEdit role', async () => {
    const { svc, epi, ctx, calls, roles, behavior } = await setup()
    const m = await mina(ctx)
    const p = (await svc.create(ctx, draft(epi.id, { characters: [castOf(m)] }), USER)).panel
    const v1 = await svc.generate(ctx, p.id)
    roles.length = 0
    behavior.edit = async () => ({ mime: 'image/webp', data: PNG })
    const v2 = await svc.editImage(ctx, p.id, 'make it rain')
    expect(v2).toMatchObject({ source: 'edit', status: 'ready', parentVersionId: v1.id, instruction: 'make it rain', error: null, check: null, referenceImagePaths: [m.imagePath] })
    expect(Object.keys(v2).sort()).toEqual(VERSION_KEYS)
    expect(v2.prompt).toContain('Edit the first image: make it rain')
    expect(v2.prompt).toContain('Mina: Slim build')
    expect(v2.imagePath).toBe(`panels/${p.id}/${v2.id}.webp`)
    expect(roles).toContain('imageEdit')
    expect(roles).not.toContain('image')
    const call = calls.find((c) => c.fn === 'edit')!
    expect((call.req as ImageEditRequest).source.data.equals(fs.readFileSync(ctx.paths.resolveAsset(v1.imagePath!)))).toBe(true)
    expect(call.req.references.map((r) => r.label)).toEqual(['Mina'])
    expect(call.req.prompt).toBe(v2.prompt)
    const stored = await svc.get(ctx, p.id)
    expect(stored.currentVersionId).toBe(v2.id)
    expect(stored.versions.map((v) => v.id)).toEqual([v1.id, v2.id])
  })

  it('a failed edit keeps the previous version current', async () => {
    const { svc, epi, ctx, behavior } = await setup()
    const p = (await svc.create(ctx, draft(epi.id), USER)).panel
    const v1 = await svc.generate(ctx, p.id)
    behavior.edit = async () => {
      throw new ProviderError('rate_limit', 'slow down')
    }
    const v2 = await svc.editImage(ctx, p.id, 'x')
    expect(v2).toMatchObject({ status: 'failed', error: 'slow down', source: 'edit', parentVersionId: v1.id, instruction: 'x' })
    expect((await svc.get(ctx, p.id)).currentVersionId).toBe(v1.id)
  })

  it('with no ready image, records a failed version without calling the model', async () => {
    const { svc, epi, ctx, calls } = await setup()
    const p = (await svc.create(ctx, draft(epi.id), USER)).panel
    const out = await svc.editImage(ctx, p.id, 'make it rain')
    expect(out).toMatchObject({ status: 'failed', error: 'No ready image to edit', source: 'edit', parentVersionId: null, instruction: 'make it rain' })
    expect(calls).toEqual([])
    expect((await svc.get(ctx, p.id)).versions).toEqual([out])
  })

  it('a missing imageEdit model becomes a failed version', async () => {
    const { svc, epi, ctx, noModel, calls } = await setup()
    const p = (await svc.create(ctx, draft(epi.id), USER)).panel
    const v1 = await svc.generate(ctx, p.id)
    noModel.add('imageEdit')
    const out = await svc.editImage(ctx, p.id, 'x')
    expect(out).toMatchObject({ status: 'failed', error: "No model assigned to role 'imageEdit'. Open Settings → Models.", parentVersionId: v1.id })
    expect(calls.filter((c) => c.fn === 'edit')).toEqual([])
    expect((await svc.get(ctx, p.id)).currentVersionId).toBe(v1.id)
  })

  it('an unknown character or a foreign variation becomes a failed version without calling the model', async () => {
    const { svc, episodes, epi, ctx, calls } = await setup()
    const m = await mina(ctx)
    await plantWithImage(ctx, episodes, makePanel({ id: 'pnl_3333333333', episodeId: epi.id, characters: [{ characterId: 'chr_ffffffffff', variationId: 'var_ffffffffff' }] }))
    await plantWithImage(ctx, episodes, makePanel({ id: 'pnl_4444444444', episodeId: epi.id, characters: [{ characterId: m.id, variationId: 'var_ffffffffff' }] }))
    expect(await svc.editImage(ctx, 'pnl_3333333333', 'x')).toMatchObject({ status: 'failed', error: 'Unknown character: chr_ffffffffff', parentVersionId: 'ver_0000000001' })
    expect(await svc.editImage(ctx, 'pnl_4444444444', 'x')).toMatchObject({ status: 'failed', error: 'Variation var_ffffffffff does not belong to Mina' })
    expect(calls).toEqual([])
    expect((await svc.get(ctx, 'pnl_3333333333')).currentVersionId).toBe('ver_0000000001')
  })
})

describe('PanelService uploadImage and revert', () => {
  it('uploads an image as a ready upload version that becomes current', async () => {
    const { svc, epi, ctx, events } = await setup()
    const p = (await svc.create(ctx, draft(epi.id), USER)).panel
    const v1 = await svc.generate(ctx, p.id)
    events.length = 0
    const up = await svc.uploadImage(ctx, p.id, PNG, 'jpg')
    expect(up).toMatchObject({ source: 'upload', status: 'ready', error: null, prompt: '', referenceImagePaths: [], instruction: null, parentVersionId: null, check: null })
    expect(Object.keys(up).sort()).toEqual(VERSION_KEYS)
    expect(up.imagePath).toBe(`panels/${p.id}/${up.id}.jpg`)
    expect(fs.readFileSync(ctx.paths.resolveAsset(up.imagePath!)).equals(PNG)).toBe(true)
    const stored = await svc.get(ctx, p.id)
    expect(stored.currentVersionId).toBe(up.id)
    expect(stored.versions.map((v) => v.id)).toEqual([v1.id, up.id])
    expect(events).toEqual([{ type: 'panel.changed', projectId: ctx.id, panelId: p.id }])
  })

  it('rejects an unsupported extension and leaves the panel untouched when saving fails', async () => {
    const { svc, epi, ctx } = await setup()
    const p = (await svc.create(ctx, draft(epi.id), USER)).panel
    await expect(svc.uploadImage(ctx, p.id, PNG, 'gif' as 'png')).rejects.toThrow(/extension/i)
    disk.failJsonWrites = 1
    await expect(svc.uploadImage(ctx, p.id, PNG, 'png')).rejects.toThrow('disk full')
    expect((await svc.get(ctx, p.id)).versions).toEqual([])
    expect(panelImages(ctx, p.id)).toEqual([])
    await expect(svc.uploadImage(ctx, 'pnl_ffffffffff', PNG, 'png')).rejects.toBeInstanceOf(EntityNotFoundError)
  })

  it('revert switches the current version without deleting any', async () => {
    const { svc, epi, ctx, events } = await setup()
    const p = (await svc.create(ctx, draft(epi.id), USER)).panel
    const v1 = await svc.generate(ctx, p.id)
    const v2 = await svc.generate(ctx, p.id)
    expect((await svc.get(ctx, p.id)).currentVersionId).toBe(v2.id)
    events.length = 0
    const reverted = await svc.revert(ctx, p.id, v1.id)
    expect(reverted.currentVersionId).toBe(v1.id)
    expect(reverted.versions.map((v) => v.id)).toEqual([v1.id, v2.id])
    expect((await svc.get(ctx, p.id)).currentVersionId).toBe(v1.id)
    expect(fs.existsSync(ctx.paths.resolveAsset(v2.imagePath!))).toBe(true)
    expect(events).toEqual([{ type: 'panel.changed', projectId: ctx.id, panelId: p.id }])
  })

  it('revert refuses an unknown or non-ready version', async () => {
    const { svc, epi, ctx, behavior } = await setup()
    const p = (await svc.create(ctx, draft(epi.id), USER)).panel
    const v1 = await svc.generate(ctx, p.id)
    behavior.generate = async () => {
      throw new Error('boom')
    }
    const failed = await svc.generate(ctx, p.id)
    await expect(svc.revert(ctx, p.id, 'ver_ffffffffff')).rejects.toBeInstanceOf(EntityNotFoundError)
    await expect(svc.revert(ctx, p.id, 'ver_ffffffffff')).rejects.toThrow('Unknown version: ver_ffffffffff')
    await expect(svc.revert(ctx, p.id, failed.id)).rejects.toBeInstanceOf(EntityNotFoundError)
    expect((await svc.get(ctx, p.id)).currentVersionId).toBe(v1.id)
  })
})

describe('PanelService delete, move and usage', () => {
  it('delete trashes the JSON, image folder and side chat, and removes the panel from its episode', async () => {
    const { svc, episodes, epi, ctx, trashed, events } = await setup()
    const p1 = (await svc.create(ctx, draft(epi.id), USER)).panel
    const p2 = (await svc.create(ctx, draft(epi.id), USER)).panel
    await svc.generate(ctx, p1.id)
    await fs.promises.writeFile(ctx.paths.panelChatFile(p1.id), '{"id":"msg_0000000001"}\n')
    events.length = 0
    await svc.delete(ctx, p1.id)
    expect(trashed).toEqual([ctx.paths.panelFile(p1.id), ctx.paths.panelDir(p1.id), ctx.paths.panelChatFile(p1.id)])
    expect(fs.existsSync(ctx.paths.panelChatFile(p1.id))).toBe(false)
    expect((await episodes.get(ctx, epi.id)).panelIds).toEqual([p2.id])
    await expect(svc.get(ctx, p1.id)).rejects.toBeInstanceOf(EntityNotFoundError)
    expect(events).toEqual(expect.arrayContaining([{ type: 'panel.changed', projectId: ctx.id, panelId: p1.id }, { type: 'episode.changed', projectId: ctx.id, episodeId: epi.id }]))
    trashed.length = 0
    await svc.delete(ctx, p2.id)
    expect(trashed).toEqual([ctx.paths.panelFile(p2.id)])
    await expect(svc.delete(ctx, p2.id)).rejects.toBeInstanceOf(EntityNotFoundError)
  })

  it('delete still works when the episode is gone', async () => {
    const { svc, ctx, trashed } = await setup()
    await writeJsonAtomic(ctx.paths.panelFile('pnl_5555555555'), makePanel({ id: 'pnl_5555555555', episodeId: 'epi_ffffffffff' }))
    await svc.delete(ctx, 'pnl_5555555555')
    expect(trashed).toEqual([ctx.paths.panelFile('pnl_5555555555')])
  })

  it('move reorders within the episode and announces both', async () => {
    const { svc, epi, ctx, events } = await setup()
    const [a, b, c] = [
      (await svc.create(ctx, draft(epi.id, { description: 'a' }), USER)).panel,
      (await svc.create(ctx, draft(epi.id, { description: 'b' }), USER)).panel,
      (await svc.create(ctx, draft(epi.id, { description: 'c' }), USER)).panel
    ]
    events.length = 0
    await svc.move(ctx, c.id, 0)
    expect((await svc.list(ctx, epi.id)).map((p) => p.id)).toEqual([c.id, a.id, b.id])
    expect(events).toEqual(expect.arrayContaining([{ type: 'panel.changed', projectId: ctx.id, panelId: c.id }, { type: 'episode.changed', projectId: ctx.id, episodeId: epi.id }]))
    await expect(svc.move(ctx, 'pnl_ffffffffff', 0)).rejects.toBeInstanceOf(EntityNotFoundError)
  })

  it('reports which panels use a character or variation, including cast, speakers and panels outside any episode', async () => {
    const { svc, epi, ctx } = await setup()
    const m = await mina(ctx)
    const z = await zed(ctx)
    const cast = (await svc.create(ctx, draft(epi.id, { characters: [castOf(m, { variationId: m.varId2 })] }), USER)).panel
    const speaker = (await svc.create(ctx, draft(epi.id, { dialogue: [{ speakerId: m.id, kind: 'speech', text: 'hi' }] }), USER)).panel
    await writeJsonAtomic(ctx.paths.panelFile('pnl_6666666666'), makePanel({ id: 'pnl_6666666666', episodeId: epi.id, characters: [castOf(m)] }))
    await fs.promises.writeFile(ctx.paths.panelChatFile('pnl_6666666666'), `{"id":"${m.id}"}\n`)
    await fs.promises.writeFile(ctx.paths.panelFile('pnl_7777777777'), '{oops')
    expect((await svc.panelsUsingCharacter(ctx, m.id)).sort()).toEqual([cast.id, speaker.id, 'pnl_6666666666'].sort())
    expect(await svc.panelsUsingCharacter(ctx, z.id)).toEqual([])
    expect(await svc.panelsUsingVariation(ctx, m.varId2)).toEqual([cast.id])
    expect(await svc.panelsUsingVariation(ctx, m.varId)).toEqual(['pnl_6666666666'])
    expect(await svc.panelsUsingVariation(ctx, 'var_ffffffffff')).toEqual([])
  })

  it('a character or variation used by a panel cannot be deleted, only archived (Review Focus 4)', async () => {
    const { svc, characters, epi, ctx, trashed } = await setup()
    const m = await mina(ctx)
    const p = (await svc.create(ctx, draft(epi.id, { characters: [castOf(m, { variationId: m.varId2 })] }), USER)).panel
    await expect(characters.delete(ctx, m.id)).rejects.toBeInstanceOf(CharacterInUseError)
    await expect(characters.delete(ctx, m.id)).rejects.toMatchObject({ panelIds: [p.id] })
    await expect(characters.deleteVariation(ctx, m.id, m.varId2)).rejects.toMatchObject({ name: 'CharacterInUseError', panelIds: [p.id] })
    expect(trashed).toEqual([])
    await characters.archive(ctx, m.id)
    expect((await characters.get(ctx, m.id)).archived).toBe(true)
    await svc.delete(ctx, p.id)
    await expect(characters.deleteVariation(ctx, m.id, m.varId2)).resolves.toBeUndefined()
    await expect(characters.delete(ctx, m.id)).resolves.toBeUndefined()
  })
})

describe('PanelService recoverInterrupted', () => {
  const pendingPanel = (id: string, epi: string): Panel =>
    makePanel({
      id,
      episodeId: epi,
      versions: [version({ imagePath: `panels/${id}/ver_0000000001.png` }), version({ id: 'ver_0000000002', status: 'pending' })],
      currentVersionId: 'ver_0000000001'
    })

  it('fails every pending version and keeps the current one', async () => {
    const { svc, epi, ctx, events } = await setup()
    await writeJsonAtomic(ctx.paths.panelFile('pnl_aaaaaaaaaa'), pendingPanel('pnl_aaaaaaaaaa', epi.id))
    events.length = 0
    await svc.recoverInterrupted(ctx)
    const p = await svc.get(ctx, 'pnl_aaaaaaaaaa')
    expect(p.versions.map((v) => [v.status, v.error])).toEqual([['ready', null], ['failed', INTERRUPTED]])
    expect(p.currentVersionId).toBe('ver_0000000001')
    expect(events).toEqual([{ type: 'panel.changed', projectId: ctx.id, panelId: 'pnl_aaaaaaaaaa' }])
  })

  it('skips a corrupt panel file, reports it, and still recovers the others', async () => {
    const { svc, epi, ctx } = await setup()
    await writeJsonAtomic(ctx.paths.panelFile('pnl_aaaaaaaaaa'), pendingPanel('pnl_aaaaaaaaaa', epi.id))
    await fs.promises.writeFile(ctx.paths.panelFile('pnl_ffffffffff'), '{oops')
    await expect(svc.recoverInterrupted(ctx)).resolves.toBeUndefined()
    expect((await svc.get(ctx, 'pnl_aaaaaaaaaa')).versions[1].status).toBe('failed')
    expect(ctx.problems.map((p) => p.path)).toEqual(['panels/pnl_ffffffffff.json'])
  })

  it('keeps going when one panel cannot be rewritten', async () => {
    const { svc, epi, ctx } = await setup()
    await writeJsonAtomic(ctx.paths.panelFile('pnl_aaaaaaaaaa'), pendingPanel('pnl_aaaaaaaaaa', epi.id))
    await writeJsonAtomic(ctx.paths.panelFile('pnl_bbbbbbbbbb'), pendingPanel('pnl_bbbbbbbbbb', epi.id))
    disk.failJsonWrites = 1
    await expect(svc.recoverInterrupted(ctx)).resolves.toBeUndefined()
    const states = [(await svc.get(ctx, 'pnl_aaaaaaaaaa')).versions[1].status, (await svc.get(ctx, 'pnl_bbbbbbbbbb')).versions[1].status]
    expect(states.sort()).toEqual(['failed', 'pending'])
    expect(ctx.problems).toHaveLength(1)
  })

  it('never throws when the panels folder cannot be read', async () => {
    const { svc, ctx } = await setup()
    vi.spyOn(fs.promises, 'readdir').mockRejectedValueOnce(Object.assign(new Error('access denied'), { code: 'EACCES' }))
    await expect(svc.recoverInterrupted(ctx)).resolves.toBeUndefined()
    expect(ctx.problems).toEqual([{ path: 'panels', message: 'access denied' }])
  })
})

describe('createServices wiring', () => {
  const input = { name: 'Mina', role: 'protagonist' as const, appearanceLock: 'LOCK' }

  it('wires panels into character deletion and the full generate flow (Review Focus 4)', async () => {
    const trashed: string[] = []
    const s = await testServices({
      trash: async (p) => {
        trashed.push(p)
        await fs.promises.rm(p, { recursive: true, force: true })
      }
    })
    try {
      const ctx = await s.projects.create({ title: 'P' })
      const ch = await s.characters.create(ctx, input, 'user')
      await s.characters.generateVariationImage(ctx, ch.id, ch.variations[0].id)
      const [ep] = await s.episodes.list(ctx)
      const cast = { characterId: ch.id, variationId: ch.variations[0].id, action: '', expression: '', position: 'center' as const }
      const { panel } = await s.panels.create(ctx, draft(ep.id, { description: 'Mina waits.', characters: [cast] }), AGENT)
      await expect(s.characters.delete(ctx, ch.id)).rejects.toMatchObject({ name: 'CharacterInUseError', panelIds: [panel.id] })
      const v = await s.panels.generate(ctx, panel.id)
      expect(v.status).toBe('ready')
      expect((await s.panels.get(ctx, panel.id)).currentVersionId).toBe(v.id)
      await s.panels.delete(ctx, panel.id)
      await s.characters.delete(ctx, ch.id)
      expect(trashed).toContain(ctx.paths.panelFile(panel.id))
    } finally {
      await s.cleanup()
    }
  })

  it('recovers interrupted panel versions when a project is first opened', async () => {
    const s1 = await testServices()
    let s2: Awaited<ReturnType<typeof testServices>> | undefined
    try {
      const ctx = await s1.projects.create({ title: 'P' })
      const [ep] = await s1.episodes.list(ctx)
      const { panel } = await s1.panels.create(ctx, draft(ep.id), USER)
      await writeJsonAtomic(ctx.paths.panelFile(panel.id), {
        ...panel,
        versions: [version({ status: 'pending' })]
      })
      s2 = await testServices({ projectsRoot: s1.projectsRoot })
      const reopened = await s2.projects.open(ctx.id)
      expect((await s2.panels.get(reopened, panel.id)).versions[0]).toMatchObject({ status: 'failed', error: INTERRUPTED })
    } finally {
      await s2?.cleanup()
      await s1.cleanup()
    }
  })
})
