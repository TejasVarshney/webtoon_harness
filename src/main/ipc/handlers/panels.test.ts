import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Panel, PanelDraft } from '@shared/types'
import { encodeSolidPng } from '../../models/providers/png'
import { testServices, type TestServices } from '../../test/test-services'
import type { HandlerMap } from './projects'
import { panelsHandlers } from './panels'
import type { PickFiles } from './uploads'

let s: TestServices | undefined
let tmp: string | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  await s?.cleanup()
  if (tmp) await fs.promises.rm(tmp, { recursive: true, force: true })
  s = undefined
  tmp = undefined
})

const PNG = encodeSolidPng(2, 3, [9, 9, 9])
const GHOST_PANEL = 'pnl_ffffffffff'

async function setup(pickFiles?: PickFiles) {
  s = await testServices()
  const services = s
  const ctx = await services.projects.create({ title: 'Moon Diary' })
  // The first open runs the onOpen hooks (interrupted-generation recovery), so do it before any test data exists.
  await services.projects.open(ctx.id)
  const h = panelsHandlers(services, { pickFiles }) as Required<HandlerMap>
  const projectId = ctx.id
  const [episode] = await h['episodes:list']({ projectId })

  const mina = await services.characters.create(ctx, { name: 'Mina', role: 'protagonist', appearanceLock: 'LOCK' }, 'user')
  await services.characters.generateVariationImage(ctx, mina.id, mina.variations[0].id)
  const base = (await services.characters.get(ctx, mina.id)).variations[0]
  const cast = [{ characterId: mina.id, variationId: base.id, action: '', expression: '', position: 'center' as const }]
  const draft = (o: Partial<PanelDraft> = {}): PanelDraft => ({ episodeId: episode.id, description: 'Mina opens the door.', setting: 'Hallway', shot: 'medium', characters: [], dialogue: [], ...o })
  const get = (id: string): Promise<Panel> => services.panels.get(ctx, id)
  /**
   * Fire-and-forget generation must finish before cleanup removes the project folder. Polls gently: on Windows a
   * rename cannot replace a file that a reader has open at that instant, so a tight poll would starve the writer.
   */
  async function settled(id: string): Promise<Panel> {
    const t0 = Date.now()
    for (;;) {
      const p = await get(id)
      if (p.versions.length > 0 && p.versions.every((v) => v.status !== 'pending')) return p
      if (Date.now() - t0 > 5000) throw new Error('timeout waiting for generation')
      await new Promise((r) => setTimeout(r, 40))
    }
  }
  return { s: services, ctx, h, projectId, episode, cast, draft, get, settled }
}

/** Holds the next image generation until `release()`. */
function gateImages(services: TestServices) {
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  const spy = vi.spyOn(services.images, 'generate').mockImplementation(async () => {
    await gate
    return { data: PNG, ext: 'png' }
  })
  return { release, spy }
}

async function failure(task: Promise<unknown>): Promise<Error> {
  try {
    await task
  } catch (error) {
    return error as Error
  }
  throw new Error('expected the call to reject')
}

describe('episodes IPC handlers', () => {
  it('lists the automatic Episode 1, creates the next one and updates only what is named', async () => {
    const { h, projectId, episode } = await setup()
    expect(episode).toMatchObject({ number: 1, title: 'Episode 1', panelIds: [] })
    const second = await h['episodes:create']({ projectId, title: 'The Letter', synopsis: 'Mina finds a letter.' })
    expect(second).toMatchObject({ number: 2, title: 'The Letter', synopsis: 'Mina finds a letter.' })
    expect((await h['episodes:list']({ projectId })).map((e) => e.number)).toEqual([1, 2])

    const renamed = await h['episodes:update']({ projectId, episodeId: second.id, patch: { title: 'The Letter, Again' } })
    expect(renamed).toMatchObject({ id: second.id, title: 'The Letter, Again', synopsis: 'Mina finds a letter.', number: 2 })
    await expect(h['episodes:update']({ projectId, episodeId: 'epi_ffffffffff', patch: { title: 'x' } })).rejects.toThrow('Unknown episode: epi_ffffffffff')
  })
})

describe('panels:create', () => {
  it('returns at once with no image yet and generates in the background', async () => {
    const { s, h, projectId, draft, cast, get, settled } = await setup()
    const { release, spy } = gateImages(s)
    const { panel, warnings } = await h['panels:create']({ projectId, draft: draft({ characters: cast }), generate: true })
    expect(warnings).toEqual([])
    expect(panel).toMatchObject({ createdBy: 'user', versions: [], currentVersionId: null })
    expect((await get(panel.id)).versions.every((v) => v.status === 'pending')).toBe(true)
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
    release()
    const done = await settled(panel.id)
    expect(done.versions).toMatchObject([{ status: 'ready', error: null, source: 'generate' }])
    expect(done.currentVersionId).toBe(done.versions[0].id)
  })

  it('without generate makes no image call', async () => {
    const { s, h, projectId, draft, get } = await setup()
    const spy = vi.spyOn(s.images, 'generate')
    const { panel } = await h['panels:create']({ projectId, draft: draft(), generate: false })
    await new Promise((r) => setTimeout(r, 20))
    expect(spy).not.toHaveBeenCalled()
    expect((await get(panel.id)).versions).toEqual([])
  })

  it('turns the mention guard into a warning, not an error, for the manual editor', async () => {
    const { s, ctx, h, projectId, draft, cast } = await setup()
    await s.characters.create(ctx, { name: 'Jin', role: 'supporting', appearanceLock: 'LOCK' }, 'user')
    const { panel, warnings } = await h['panels:create']({ projectId, draft: draft({ characters: cast, description: 'Mina waits while Jin watches.' }), generate: false })
    expect(panel.id).toMatch(/^pnl_/)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('Mentioned but not attached: Jin')
  })

  it('rejects a malformed draft before anything is written', async () => {
    const { h, projectId, draft, episode, s, ctx } = await setup()
    await expect(h['panels:create']({ projectId, draft: draft({ shot: 'huge' as never }), generate: false })).rejects.toThrow()
    await expect(h['panels:create']({ projectId, draft: { episodeId: episode.id } as never, generate: false })).rejects.toThrow()
    expect((await s.episodes.get(ctx, episode.id)).panelIds).toEqual([])
  })

  it('reports validation issues as a plain Error with one issue per line, which the UI shows as is', async () => {
    const { h, projectId, draft } = await setup()
    const error = await failure(
      h['panels:create']({
        projectId,
        draft: draft({
          characters: [{ characterId: 'chr_ffffffffff', variationId: 'var_ffffffffff', action: '', expression: '', position: 'center' }],
          dialogue: [{ speakerId: 'chr_eeeeeeeeee', kind: 'speech', text: 'Hi' }]
        }),
        generate: true
      })
    )
    expect(error.name).toBe('Error')
    expect(error.message).toBe('Unknown character: chr_ffffffffff\nUnknown speaker: chr_eeeeeeeeee')
  })

  it('refuses an unknown episode and an unknown anchor, and starts no generation', async () => {
    const { s, h, projectId, draft } = await setup()
    const spy = vi.spyOn(s.images, 'generate')
    await expect(h['panels:create']({ projectId, draft: draft({ episodeId: 'epi_ffffffffff' }), generate: true })).rejects.toThrow('Unknown episode: epi_ffffffffff')
    await expect(h['panels:create']({ projectId, draft: draft({ afterPanelId: GHOST_PANEL }), generate: true })).rejects.toThrow(`Unknown panel: ${GHOST_PANEL}`)
    expect(spy).not.toHaveBeenCalled()
  })

  it('inserts after the given panel', async () => {
    const { h, projectId, draft, episode, s, ctx } = await setup()
    const a = (await h['panels:create']({ projectId, draft: draft({ description: 'A' }), generate: false })).panel
    const b = (await h['panels:create']({ projectId, draft: draft({ description: 'B' }), generate: false })).panel
    const c = (await h['panels:create']({ projectId, draft: draft({ description: 'C', afterPanelId: a.id }), generate: false })).panel
    expect((await s.episodes.get(ctx, episode.id)).panelIds).toEqual([a.id, c.id, b.id])
    expect((await h['panels:list']({ projectId, episodeId: episode.id })).map((p) => p.description)).toEqual(['A', 'C', 'B'])
  })

  it('logs, and does not reject, when the background generation itself throws', async () => {
    const { s, h, projectId, draft } = await setup()
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.spyOn(s.panels, 'generate').mockRejectedValue(new Error('disk gone'))
    const { panel } = await h['panels:create']({ projectId, draft: draft(), generate: true })
    await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(1))
    expect(log.mock.calls[0].join(' ')).toContain('disk gone')
    expect(panel.id).toMatch(/^pnl_/)
  })
})

describe('panels:list, get and update', () => {
  it('lists an episode in order and gets one panel', async () => {
    const { h, projectId, draft, episode } = await setup()
    const a = (await h['panels:create']({ projectId, draft: draft({ description: 'A' }), generate: false })).panel
    await h['panels:create']({ projectId, draft: draft({ description: 'B' }), generate: false })
    expect((await h['panels:list']({ projectId, episodeId: episode.id })).map((p) => p.description)).toEqual(['A', 'B'])
    expect(await h['panels:get']({ projectId, panelId: a.id })).toMatchObject({ id: a.id, description: 'A' })
    await expect(h['panels:get']({ projectId, panelId: GHOST_PANEL })).rejects.toThrow(`Unknown panel: ${GHOST_PANEL}`)
  })

  it('updates the named fields and returns warnings instead of failing on a mention', async () => {
    const { s, ctx, h, projectId, draft, cast, get } = await setup()
    await s.characters.create(ctx, { name: 'Jin', role: 'supporting', appearanceLock: 'LOCK' }, 'user')
    const { panel } = await h['panels:create']({ projectId, draft: draft({ characters: cast }), generate: false })
    const out = await h['panels:update']({ projectId, panelId: panel.id, patch: { description: 'Mina greets Jin.', shot: 'wide' } })
    expect(out.panel).toMatchObject({ id: panel.id, description: 'Mina greets Jin.', shot: 'wide', setting: 'Hallway' })
    expect(out.warnings).toHaveLength(1)
    expect(out.warnings[0]).toContain('Mentioned but not attached: Jin')
    expect((await get(panel.id)).shot).toBe('wide')
  })

  it('rejects a malformed patch, maps validation issues to a plain Error and refuses an unknown panel', async () => {
    const { h, projectId, draft, get } = await setup()
    const { panel } = await h['panels:create']({ projectId, draft: draft(), generate: false })
    await expect(h['panels:update']({ projectId, panelId: panel.id, patch: { shot: 'huge' } as never })).rejects.toThrow()
    const error = await failure(h['panels:update']({ projectId, panelId: panel.id, patch: { dialogue: [{ speakerId: 'chr_eeeeeeeeee', kind: 'speech', text: 'Hi' }] } }))
    expect(error.name).toBe('Error')
    expect(error.message).toBe('Unknown speaker: chr_eeeeeeeeee')
    await expect(h['panels:update']({ projectId, panelId: GHOST_PANEL, patch: { description: 'x' } })).rejects.toThrow(`Unknown panel: ${GHOST_PANEL}`)
    expect((await get(panel.id)).dialogue).toEqual([])
  })
})

describe('panels:generate', () => {
  it('starts generation without waiting for it, and rejects an unknown panel up front', async () => {
    const { s, h, projectId, draft, settled } = await setup()
    const { panel } = await h['panels:create']({ projectId, draft: draft(), generate: false })
    const spy = vi.spyOn(s.images, 'generate')
    await expect(h['panels:generate']({ projectId, panelId: GHOST_PANEL })).rejects.toThrow(`Unknown panel: ${GHOST_PANEL}`)
    expect(spy).not.toHaveBeenCalled()

    spy.mockRestore()
    const { release, spy: gated } = gateImages(s)
    await expect(h['panels:generate']({ projectId, panelId: panel.id })).resolves.toBeUndefined()
    await vi.waitFor(() => expect(gated).toHaveBeenCalledTimes(1))
    release()
    expect((await settled(panel.id)).versions).toMatchObject([{ status: 'ready' }])
  })

  it('a failed generation ends failed with the message and a retry makes a new version, logging nothing', async () => {
    const { s, ctx, h, projectId, draft, settled } = await setup()
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { panel } = await h['panels:create']({ projectId, draft: draft(), generate: false })
    await s.registry.assignRole('image', null)
    await h['panels:generate']({ projectId, panelId: panel.id })
    const failed = await settled(panel.id)
    expect(failed.versions).toMatchObject([{ status: 'failed', error: expect.stringContaining("No model assigned to role 'image'") }])
    expect(failed.currentVersionId).toBeNull()

    await s.registry.assignRole('image', 'mdl_000000000b')
    await h['panels:generate']({ projectId, panelId: panel.id })
    await vi.waitFor(async () => expect((await s.panels.get(ctx, panel.id)).versions).toHaveLength(2))
    const retried = await settled(panel.id)
    expect(retried.versions.map((v) => v.status)).toEqual(['failed', 'ready'])
    expect(log).not.toHaveBeenCalled()
  })
})

describe('panels:delete, move and revert', () => {
  it('deletes a panel to the trash and out of its episode', async () => {
    const { s, ctx, h, projectId, draft, episode } = await setup()
    const { panel } = await h['panels:create']({ projectId, draft: draft(), generate: false })
    await h['panels:delete']({ projectId, panelId: panel.id })
    expect(s.trashed).toContain(ctx.paths.panelFile(panel.id))
    expect((await s.episodes.get(ctx, episode.id)).panelIds).toEqual([])
    await expect(h['panels:delete']({ projectId, panelId: GHOST_PANEL })).rejects.toThrow(`Unknown panel: ${GHOST_PANEL}`)
  })

  it('moves a panel to an index', async () => {
    const { h, projectId, draft, episode } = await setup()
    const a = (await h['panels:create']({ projectId, draft: draft({ description: 'A' }), generate: false })).panel
    await h['panels:create']({ projectId, draft: draft({ description: 'B' }), generate: false })
    await h['panels:create']({ projectId, draft: draft({ description: 'C' }), generate: false })
    await h['panels:move']({ projectId, panelId: a.id, toIndex: 2 })
    expect((await h['panels:list']({ projectId, episodeId: episode.id })).map((p) => p.description)).toEqual(['B', 'C', 'A'])
  })

  it('reverts to an earlier ready version, and refuses an unknown or failed one', async () => {
    const { s, ctx, h, projectId, draft } = await setup()
    const { panel } = await h['panels:create']({ projectId, draft: draft(), generate: false })
    const first = await s.panels.generate(ctx, panel.id)
    const second = await s.panels.generate(ctx, panel.id)
    await s.registry.assignRole('image', null)
    const failed = await s.panels.generate(ctx, panel.id)
    expect((await h['panels:get']({ projectId, panelId: panel.id })).currentVersionId).toBe(second.id)

    const reverted = await h['panels:revert']({ projectId, panelId: panel.id, versionId: first.id })
    expect(reverted).toMatchObject({ id: panel.id, currentVersionId: first.id })
    expect(reverted.versions).toHaveLength(3)
    await expect(h['panels:revert']({ projectId, panelId: panel.id, versionId: failed.id })).rejects.toThrow(`Unknown version: ${failed.id}`)
    await expect(h['panels:revert']({ projectId, panelId: panel.id, versionId: 'ver_ffffffffff' })).rejects.toThrow('Unknown version: ver_ffffffffff')
  })
})

describe('panels:uploadImage', () => {
  async function files() {
    tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'panel upload '))
    const jpeg = path.join(tmp, 'Hero Shot.JPEG')
    const second = path.join(tmp, 'other.png')
    const text = path.join(tmp, 'notes.txt')
    await fs.promises.writeFile(jpeg, Buffer.from([1, 2, 3]))
    await fs.promises.writeFile(second, Buffer.from([4, 5]))
    await fs.promises.writeFile(text, 'x')
    return { jpeg, second, text }
  }

  it('stores the first picked file as a new current version and asks the picker for a single file', async () => {
    const f = await files()
    const picker = vi.fn<PickFiles>(async () => [f.jpeg, f.second])
    const { h, projectId, draft, ctx, get } = await setup(picker)
    const { panel } = await h['panels:create']({ projectId, draft: draft(), generate: false })
    const event = { sender: 'window' }
    const version = await h['panels:uploadImage']({ projectId, panelId: panel.id }, event)
    expect(picker).toHaveBeenCalledWith(event, expect.objectContaining({ multiple: false }))
    expect(version).toMatchObject({ source: 'upload', status: 'ready', imagePath: expect.stringMatching(/^panels\/pnl_[0-9a-f]{10}\/ver_[0-9a-f]{10}\.jpg$/) })
    expect([...fs.readFileSync(ctx.paths.resolveAsset(version!.imagePath!))]).toEqual([1, 2, 3])
    expect((await get(panel.id)).currentVersionId).toBe(version!.id)
  })

  it('returns null and changes nothing when the dialog is cancelled', async () => {
    const { h, projectId, draft, get } = await setup(async () => [])
    const { panel } = await h['panels:create']({ projectId, draft: draft(), generate: false })
    expect(await h['panels:uploadImage']({ projectId, panelId: panel.id })).toBeNull()
    expect((await get(panel.id)).versions).toEqual([])
  })

  it('rejects an unsupported file type and leaves the panel untouched', async () => {
    const f = await files()
    const { h, projectId, draft, get } = await setup(async () => [f.text])
    const { panel } = await h['panels:create']({ projectId, draft: draft(), generate: false })
    await expect(h['panels:uploadImage']({ projectId, panelId: panel.id })).rejects.toThrow(/png, jpg or webp/)
    expect((await get(panel.id)).versions).toEqual([])
  })

  it('rejects an unknown panel before opening the dialog', async () => {
    const picker = vi.fn<PickFiles>(async () => [])
    const { h, projectId } = await setup(picker)
    await expect(h['panels:uploadImage']({ projectId, panelId: GHOST_PANEL })).rejects.toThrow(`Unknown panel: ${GHOST_PANEL}`)
    expect(picker).not.toHaveBeenCalled()
  })
})
