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

    const edited = await h['episodes:update']({ projectId, episodeId: second.id, patch: { synopsis: 'Mina burns it.' } })
    expect(edited).toMatchObject({ id: second.id, title: 'The Letter', synopsis: 'Mina burns it.', number: 2 })
    await expect(h['episodes:update']({ projectId, episodeId: 'epi_ffffffffff', patch: { synopsis: 'x' } })).rejects.toThrow('Unknown episode: epi_ffffffffff')
  })

  it('refuses a new title', async () => {
    const { h, projectId, episode } = await setup()
    // @ts-expect-error a title is not part of the patch type; the runtime check must refuse it too
    await expect(h['episodes:update']({ projectId, episodeId: episode.id, patch: { title: 'New' } })).rejects.toThrow()
    expect((await h['episodes:list']({ projectId }))[0].title).toBe('Episode 1')
  })
})

describe('episodes:setBackground and episodes:pickBackgroundImage', () => {
  it('stores the picked image as the background, keeps what is stored on a cancel, and refuses a path it did not store', async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'episode background '))
    tmp = dir
    const file = path.join(dir, 'sky.JPG')
    await fs.promises.writeFile(file, Buffer.from([1, 2, 3]))
    const picker = vi.fn<PickFiles>(async () => [file])
    const { h, projectId, episode, ctx } = await setup(picker)
    const stored = await h['episodes:pickBackgroundImage']({ projectId, episodeId: episode.id }, { sender: 'window' })
    expect(picker).toHaveBeenCalledWith({ sender: 'window' }, expect.objectContaining({ multiple: false }))
    const image = stored!.background as { kind: 'image'; path: string }
    expect(image.path).toMatch(/\.jpg$/)
    expect([...fs.readFileSync(ctx.paths.resolveAsset(image.path))]).toEqual([1, 2, 3])

    const gradient = { kind: 'linear' as const, angle: 90, repeatEvery: null, stops: [{ color: '#000000', at: 0 }, { color: '#ffffff', at: 1 }] }
    expect((await h['episodes:setBackground']({ projectId, episodeId: episode.id, background: gradient })).background).toEqual(gradient)
    await expect(h['episodes:setBackground']({ projectId, episodeId: episode.id, background: { ...image, path: `episode-backgrounds/${episode.id}/other.png`, fit: 'width', opacity: 1, color: '#ffffff' } })).rejects.toThrow(/did not store/)
    await expect(h['episodes:setBackground']({ projectId, episodeId: episode.id, background: { kind: 'solid', color: 'red' } })).rejects.toThrow(/^Invalid input/)
    expect((await h['episodes:setBackground']({ projectId, episodeId: episode.id, background: null })).background).toBeNull()
  })

  it('returns null when the dialog is cancelled and refuses a file that is not an image', async () => {
    let chosen: string[] = []
    const { h, projectId, episode } = await setup(async () => chosen)
    expect(await h['episodes:pickBackgroundImage']({ projectId, episodeId: episode.id })).toBeNull()
    chosen = ['notes.txt']
    await expect(h['episodes:pickBackgroundImage']({ projectId, episodeId: episode.id })).rejects.toThrow(/png, jpg or webp/)
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

  it('places panels and reads the episode in that order', async () => {
    const { h, projectId, draft, episode } = await setup()
    const a = (await h['panels:create']({ projectId, draft: draft({ description: 'A' }), generate: false })).panel
    await h['panels:create']({ projectId, draft: draft({ description: 'B' }), generate: false })
    await h['panels:place']({ projectId, episodeId: episode.id, moves: [{ panelId: a.id, placement: { x: 0, y: 5000, width: 100 } }] })
    const listed = await h['panels:list']({ projectId, episodeId: episode.id })
    expect(listed.map((p) => p.description)).toEqual(['B', 'A'])
    expect(listed.every((p) => p.placement !== null)).toBe(true)
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

describe('panels:crop', () => {
  it('stores the area of a ready version as a new current version', async () => {
    const { h, projectId, draft, get, settled } = await setup()
    const { panel } = await h['panels:create']({ projectId, draft: draft(), generate: true })
    const [drawn] = (await settled(panel.id)).versions
    const version = await h['panels:crop']({ projectId, panelId: panel.id, versionId: drawn.id, area: { x: 0.25, y: 0, width: 0.5, height: 1 } })
    expect(version).toMatchObject({ source: 'crop', status: 'ready', parentVersionId: drawn.id })
    expect((await get(panel.id)).currentVersionId).toBe(version.id)
  })

  it.each([
    ['an empty area', { x: 0.2, y: 0.2, width: 0, height: 0.5 }],
    ['an area past the edge', { x: 0.6, y: 0, width: 0.5, height: 1 }],
    ['a negative corner', { x: -0.1, y: 0, width: 0.5, height: 0.5 }],
    ['a shape that is not one', { x: 0, y: 0, width: 0.5, height: 0.5 }, '5:4']
  ])('refuses %s and changes nothing', async (_name, area, aspect?: string) => {
    const { h, projectId, draft, get, settled } = await setup()
    const { panel } = await h['panels:create']({ projectId, draft: draft(), generate: true })
    const [drawn] = (await settled(panel.id)).versions
    await expect(h['panels:crop']({ projectId, panelId: panel.id, versionId: drawn.id, area, ...(aspect ? { aspect: aspect as never } : {}) })).rejects.toThrow()
    expect((await get(panel.id)).versions).toHaveLength(1)
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

describe('panels:saveSketch and panels:readSketch', () => {
  const dataUrl = (bytes: Buffer): string => `data:image/png;base64,${bytes.toString('base64')}`

  it('stores a PNG data URL as the sketch, reads it back as one, and forgets it with null', async () => {
    const { h, projectId, draft, get, ctx } = await setup()
    const { panel } = await h['panels:create']({ projectId, draft: draft({ description: '' }), generate: false })
    expect(await h['panels:readSketch']({ projectId, panelId: panel.id })).toBeNull()
    const saved = await h['panels:saveSketch']({ projectId, panelId: panel.id, png: dataUrl(PNG) })
    expect(saved.sketchPath).toMatch(/^panels\/pnl_[0-9a-f]{10}\/sketch-[a-z0-9]+\.png$/)
    expect(fs.readFileSync(ctx.paths.resolveAsset(saved.sketchPath!))).toEqual(PNG)
    expect(await h['panels:readSketch']({ projectId, panelId: panel.id })).toBe(dataUrl(PNG))
    expect((await h['panels:saveSketch']({ projectId, panelId: panel.id, png: null })).sketchPath).toBeNull()
    expect((await get(panel.id)).versions).toEqual([])
  })

  it('refuses anything that is not a PNG data URL, and leaves the panel untouched', async () => {
    const { h, projectId, draft, get } = await setup()
    const { panel } = await h['panels:create']({ projectId, draft: draft(), generate: false })
    await expect(h['panels:saveSketch']({ projectId, panelId: panel.id, png: 'data:image/jpeg;base64,AAAA' })).rejects.toThrow()
    await expect(h['panels:saveSketch']({ projectId, panelId: panel.id, png: dataUrl(Buffer.from('not a png at all')) })).rejects.toThrow('Sketch is not a PNG image')
    expect((await get(panel.id)).sketchPath ?? null).toBeNull()
  })
})

describe('panels:previewPrompt', () => {
  it('returns the prompt a new panel would be drawn with and writes nothing', async () => {
    const { h, projectId, draft, cast, s, ctx, episode } = await setup()
    const before = fs.readdirSync(ctx.paths.panelsDir())
    const out = await h['panels:previewPrompt']({ projectId, draft: draft({ characters: cast }), hasSketch: true })
    expect(out.prompt).toContain('[ACTION] Mina opens the door.')
    expect(out.references.map((r) => r.label)).toEqual(['Mina', 'layout sketch'])
    expect(out.droppedPanelIds).toEqual([])
    expect(fs.readdirSync(ctx.paths.panelsDir())).toEqual(before)
    expect((await s.episodes.get(ctx, episode.id)).panelIds).toEqual([])
  })

  it('refuses a request whose hasSketch is not a boolean', async () => {
    const { h, projectId, draft } = await setup()
    await expect(h['panels:previewPrompt']({ projectId, draft: draft(), hasSketch: 'yes' as never })).rejects.toThrow('Invalid input: hasSketch')
  })

  it('refuses a bad draft and rejects what the prompt cannot be built from', async () => {
    const { h, projectId, draft } = await setup()
    await expect(h['panels:previewPrompt']({ projectId, draft: draft({ shot: 'huge' as never }), hasSketch: false })).rejects.toThrow()
    await expect(h['panels:previewPrompt']({ projectId, draft: draft({ episodeId: 'epi_ffffffffff' }), hasSketch: false })).rejects.toThrow('Unknown episode: epi_ffffffffff')
  })
})

describe('panels:create with a sketch', () => {
  const dataUrl = (bytes: Buffer): string => `data:image/png;base64,${bytes.toString('base64')}`

  it('stores the sketch before the background draw, so the first version sends it', async () => {
    const { h, projectId, draft, settled, ctx } = await setup()
    const { panel } = await h['panels:create']({ projectId, draft: draft(), generate: true, sketchPng: dataUrl(PNG) })
    expect(panel.sketchPath).toMatch(/^panels\/pnl_[0-9a-f]{10}\/sketch-[a-z0-9]+\.png$/)
    expect(fs.readFileSync(ctx.paths.resolveAsset(panel.sketchPath!))).toEqual(PNG)
    const done = await settled(panel.id)
    expect(done.versions[0].referenceImagePaths).toContain(panel.sketchPath)
  })

  it('refuses a sketch that is not a PNG and creates no panel', async () => {
    const { s, h, projectId, draft, ctx, episode } = await setup()
    await expect(h['panels:create']({ projectId, draft: draft(), generate: true, sketchPng: dataUrl(Buffer.from('not a png at all')) })).rejects.toThrow('Sketch is not a PNG image')
    await expect(h['panels:create']({ projectId, draft: draft(), generate: true, sketchPng: 'data:image/jpeg;base64,AAAA' })).rejects.toThrow()
    expect(fs.readdirSync(ctx.paths.panelsDir())).toEqual([])
    expect((await s.episodes.get(ctx, episode.id)).panelIds).toEqual([])
  })
})
