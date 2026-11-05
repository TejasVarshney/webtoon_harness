import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExportRequestSchema } from '@shared/schemas'
import { exportRows } from '@shared/strip-layout'
import type { Episode, ExportProgress, ExportRequest, ExportSnapshot, Panel, PanelVersion, ViewLayout } from '@shared/types'
import { encodeSolidPng } from '../models/providers/png'
import { writeJsonAtomic } from '../storage/atomic'
import type { ProjectContext } from '../storage/project-store'
import { readZip } from '../test/read-zip'
import { testServices, type TestServices } from '../test/test-services'
import { ExportService } from './export-service'
import type { Slice } from './slice-plan'
import type { ImageCodec, StripCapturer } from './types'

const PNG = encodeSolidPng(2, 2, [1, 2, 3])
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const TERMINAL = new Set<ExportProgress['stage']>(['done', 'failed', 'cancelled'])
const NOTHING = 'Nothing to export: no episode has a finished panel'

/** A fake encoded image: the format's magic bytes, then its size as text, which the fake codec reads back. */
function fakeImage(format: 'jpeg' | 'png', width: number, height: number): Buffer {
  return Buffer.concat([format === 'jpeg' ? JPEG_MAGIC : PNG_MAGIC, Buffer.from(` ${width}x${height}`)])
}

function sizeOf(img: Buffer): { width: number; height: number } {
  const m = /(\d+)x(\d+)/.exec(img.toString('latin1'))
  if (!m) throw new Error('not a fake image')
  return { width: Number(m[1]), height: Number(m[2]) }
}

/** Works on 1×N bitmaps: a decoded image keeps only its height, so a stitch shows up as the sum of its slices. */
const fakeCodec: ImageCodec = {
  toBitmap: (png) => {
    const { height } = sizeOf(png)
    return { width: 1, height, data: Buffer.alloc(4 * height, 0x7f) }
  },
  encode: (b, format) => fakeImage(format, b.width, b.height),
  size: sizeOf
}

function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void
  const promise = new Promise<void>((resolve) => (release = resolve))
  return { promise, release }
}

/** Lays a strip out as `rowHeight` CSS px per finished row, and returns fake images of the slices it is asked for. */
class FakeCapturer implements StripCapturer {
  rowHeight = 600
  opened = 0
  closed = 0
  renders: { snapshot: ExportSnapshot; timeoutMs: number }[] = []
  captures: { slice: Slice; scale: 1 | 2; format: 'jpeg' | 'png' }[] = []
  /** While set, every capture waits for it. */
  gate: Promise<void> | null = null
  /** The 1-based capture that throws. */
  failAt: number | null = null

  async open(): Promise<void> {
    this.opened++
  }

  async render(snapshot: ExportSnapshot, timeoutMs: number): Promise<ViewLayout> {
    // A copy, as the real capturer serializes it: a later change to the job's objects must not show up here.
    this.renders.push({ snapshot: structuredClone(snapshot), timeoutMs })
    const rows = exportRows(snapshot.panels).map((_, i) => ({ top: i * this.rowHeight, bottom: (i + 1) * this.rowHeight }))
    return { totalHeight: rows.length * this.rowHeight, rows }
  }

  async capture(slice: Slice, scale: 1 | 2, format: 'jpeg' | 'png'): Promise<Buffer> {
    this.captures.push({ slice, scale, format })
    if (this.gate) await this.gate
    if (this.failAt === this.captures.length) throw new Error('Episode 1, panel 2: the image could not be loaded')
    return fakeImage(format, 800 * scale, slice.height * scale)
  }

  async close(): Promise<void> {
    this.closed++
  }
}

type Kind = 'ready' | 'none' | 'failed' | 'pending'

interface Rig {
  s: TestServices
  ctx: ProjectContext
  svc: ExportService
  capturer: FakeCapturer
  progress: ExportProgress[]
  /** The `projectId` of every `export.progress` event, in order. */
  projectIds: string[]
  trashed: string[]
  /** An empty folder to export into; its path contains a space. */
  target: string
  addEpisode(title: string, kinds: Kind[], synopsis?: string): Promise<{ episode: Episode; panels: Panel[] }>
  req(o: Record<string, unknown>): ExportRequest
  finished(jobId: string): Promise<ExportProgress>
}

let rig: Rig | undefined
afterEach(async () => {
  if (rig) {
    await rig.svc.shutdown()
    await rig.s.cleanup()
  }
  rig = undefined
})

function version(status: 'failed' | 'pending'): PanelVersion {
  return {
    id: 'ver_00000000aa',
    source: 'generate',
    status,
    error: status === 'failed' ? 'model refused' : null,
    imagePath: null,
    prompt: 'p',
    referenceImagePaths: [],
    instruction: null,
    parentVersionId: null,
    drawnFrom: null,
    check: null,
    createdAt: '2026-01-01T00:00:00.000Z'
  }
}

async function setup(): Promise<Rig> {
  const s = await testServices()
  const ctx = await s.projects.create({ title: 'Moon Tower' })
  // The first open fails pending versions (recoverInterrupted); do it now so the hand-written ones below survive.
  await s.projects.open(ctx.id)
  const [first] = await s.episodes.list(ctx)
  let firstUsed = false
  const target = path.join(path.dirname(s.projectsRoot), 'export target')
  await fs.promises.mkdir(target)
  const trashed: string[] = []
  // Moves the path out of the way like the OS trash does, so a replaced folder is really gone.
  const trash = async (p: string): Promise<void> => {
    trashed.push(p)
    await fs.promises.rm(p, { recursive: true, force: true })
  }
  const capturer = new FakeCapturer()
  const svc = new ExportService({
    projects: s.projects,
    episodes: s.episodes,
    panels: s.panels,
    characters: s.characters,
    bus: s.bus,
    trash,
    createCapturer: () => capturer,
    codec: fakeCodec,
    exportsDir: path.join(path.dirname(s.projectsRoot), 'Exports')
  })
  const progress: ExportProgress[] = []
  const projectIds: string[] = []
  s.bus.subscribe((e) => {
    if (e.type === 'export.progress') {
      projectIds.push(e.projectId)
      progress.push(e.progress)
    }
  })

  async function addEpisode(title: string, kinds: Kind[], synopsis = ''): Promise<{ episode: Episode; panels: Panel[] }> {
    let episode: Episode
    if (!firstUsed) {
      firstUsed = true
      episode = await s.episodes.update(ctx, first.id, { title, synopsis })
    } else episode = await s.episodes.create(ctx, { title, synopsis })
    for (const [i, kind] of kinds.entries()) {
      const draft = { episodeId: episode.id, description: `${title} panel ${i + 1}`, setting: 'Roof', shot: 'medium' as const, characters: [], dialogue: [] }
      const { panel } = await s.panels.create(ctx, draft, { createdBy: 'user', strictMentions: false })
      if (kind === 'ready') await s.panels.uploadImage(ctx, panel.id, PNG, 'png')
      if (kind === 'failed' || kind === 'pending') {
        await writeJsonAtomic(ctx.paths.panelFile(panel.id), { ...panel, versions: [version(kind)], currentVersionId: null })
      }
    }
    return { episode: await s.episodes.get(ctx, episode.id), panels: await s.panels.list(ctx, episode.id) }
  }

  function finished(jobId: string): Promise<ExportProgress> {
    return new Promise((resolve) => {
      let off = (): void => undefined
      const check = (): void => {
        const end = progress.find((p) => p.jobId === jobId && TERMINAL.has(p.stage))
        if (end) {
          off()
          resolve(end)
        }
      }
      off = s.bus.subscribe(check)
      check()
    })
  }

  rig = {
    s,
    ctx,
    svc,
    capturer,
    progress,
    projectIds,
    trashed,
    target,
    addEpisode,
    req: (o) => ExportRequestSchema.parse({ projectId: ctx.id, ...o }),
    finished
  }
  return rig
}

const readdir = (dir: string): Promise<string[]> => fs.promises.readdir(dir).then((names) => names.sort())
const pageCount = (buf: Buffer): number => buf.toString('latin1').match(/\/Type \/Page\b/g)?.length ?? 0
const pageHeights = (buf: Buffer): number[] => [...buf.toString('latin1').matchAll(/\/MediaBox \[0 0 [\d.]+ ([\d.]+)\]/g)].map((m) => Number(m[1]))

describe('ExportService', () => {
  it('inspect lists unfinished panels with 1-based positions and reasons', async () => {
    const { svc, ctx, addEpisode } = await setup()
    const one = await addEpisode('The Rooftop', ['ready', 'none', 'ready', 'failed', 'pending'])
    const two = await addEpisode('The Fall', ['ready'])
    const got = await svc.inspect(ctx.id, [two.episode.id, one.episode.id])
    expect(got).toEqual({
      episodes: [
        {
          episodeId: one.episode.id,
          number: 1,
          title: 'The Rooftop',
          panelCount: 5,
          finishedCount: 2,
          unfinished: [
            { panelId: one.panels[1].id, position: 2, reason: 'none' },
            { panelId: one.panels[3].id, position: 4, reason: 'failed' },
            { panelId: one.panels[4].id, position: 5, reason: 'generating' }
          ]
        },
        { episodeId: two.episode.id, number: 2, title: 'The Fall', panelCount: 1, finishedCount: 1, unfinished: [] }
      ]
    })
  })

  it('snapshots panels at start, so an edit during the job does not change the output', async () => {
    const { s, ctx, svc, capturer, addEpisode, req, finished, target } = await setup()
    const one = await addEpisode('The Rooftop', ['ready'])
    const two = await addEpisode('The Fall', ['ready', 'none'])
    const gate = deferred()
    capturer.gate = gate.promise
    const { jobId } = await svc.start(req({ episodeIds: [one.episode.id, two.episode.id], preset: 'webtoon' }), target)
    await vi.waitFor(() => expect(capturer.captures).toHaveLength(1))
    await s.panels.update(ctx, two.panels[0].id, { description: 'Edited mid-export' }, { strictMentions: false })
    gate.release()
    expect((await finished(jobId)).stage).toBe('done')
    expect(capturer.renders).toHaveLength(2)
    const second = capturer.renders[1]
    expect(second.snapshot.panels.map((p) => p.description)).toEqual(['The Fall panel 1', 'The Fall panel 2'])
    expect(second.snapshot).toMatchObject({ projectId: ctx.id, lettering: true, characters: [] })
    expect(second.snapshot.episode.id).toBe(two.episode.id)
    // 30 s plus 2 s per panel of the full list, unfinished ones included.
    expect(second.timeoutMs).toBe(30000 + 2000 * 2)
  })

  it('writes webtoon slices 001.jpg… into <target>/<Project> - 01 - <Title>/', async () => {
    const { svc, capturer, addEpisode, req, finished, target } = await setup()
    const { episode } = await addEpisode('The Rooftop', ['ready', 'ready', 'ready'])
    const { jobId } = await svc.start(req({ episodeIds: [episode.id], preset: 'webtoon' }), target)
    const end = await finished(jobId)
    const folder = path.join(target, 'Moon Tower - 01 - The Rooftop')
    expect(end).toMatchObject({ stage: 'done', outputs: [folder] })
    expect(await readdir(target)).toEqual(['Moon Tower - 01 - The Rooftop'])
    expect(await readdir(folder)).toEqual(['001.jpg', '002.jpg'])
    expect(sizeOf(await fs.promises.readFile(path.join(folder, '001.jpg')))).toEqual({ width: 800, height: 1280 })
    expect(sizeOf(await fs.promises.readFile(path.join(folder, '002.jpg')))).toEqual({ width: 800, height: 520 })
    expect(capturer.captures.map((c) => c.slice)).toEqual([
      { top: 0, height: 1280 },
      { top: 1280, height: 520 }
    ])
    expect(capturer.captures.every((c) => c.scale === 1 && c.format === 'jpeg')).toBe(true)
    expect(svc.outputsOf(jobId)).toEqual([folder])
  })

  it('writes one pdf per episode, or one combined pdf in episode-number order when combine is set', async () => {
    const { svc, addEpisode, req, finished, target } = await setup()
    const one = await addEpisode('The Rooftop', ['ready', 'ready'])
    const two = await addEpisode('The Fall', ['ready', 'ready', 'ready'])
    const ids = [two.episode.id, one.episode.id]

    const first = await svc.start(req({ episodeIds: ids, preset: 'pdf-reading' }), target)
    expect((await finished(first.jobId)).stage).toBe('done')
    expect(await readdir(target)).toEqual(['Moon Tower - 01 - The Rooftop.pdf', 'Moon Tower - 02 - The Fall.pdf'])
    expect(pageCount(await fs.promises.readFile(path.join(target, 'Moon Tower - 01 - The Rooftop.pdf')))).toBe(1)
    expect(pageCount(await fs.promises.readFile(path.join(target, 'Moon Tower - 02 - The Fall.pdf')))).toBe(2)

    const file = path.join(target, 'volume.pdf')
    const second = await svc.start(req({ episodeIds: ids, preset: 'pdf-reading', combine: true }), file)
    expect(await finished(second.jobId)).toMatchObject({ stage: 'done', outputs: [file] })
    const pdf = await fs.promises.readFile(file)
    expect(pageCount(pdf)).toBe(3)
    // 0.75 pt per CSS px: episode 1's 1200 px page, then episode 2's 1280 and 520 px pages.
    expect(pageHeights(pdf)).toEqual([900, 960, 390])
  })

  it('pdf-print captures at scale 2, breaks between rows and lays pages on the paper', async () => {
    const { svc, capturer, addEpisode, req, finished, target } = await setup()
    const { episode } = await addEpisode('The Rooftop', ['ready', 'ready', 'ready'])
    const file = path.join(target, 'print.pdf')
    const { jobId } = await svc.start(req({ episodeIds: [episode.id], preset: 'pdf-print', paper: 'letter' }), file)
    expect((await finished(jobId)).stage).toBe('done')
    expect(capturer.captures.map((c) => c.slice)).toEqual([
      { top: 0, height: 600 },
      { top: 600, height: 600 },
      { top: 1200, height: 600 }
    ])
    expect(capturer.captures.every((c) => c.scale === 2 && c.format === 'jpeg')).toBe(true)
    const pdf = await fs.promises.readFile(file)
    expect(pageCount(pdf)).toBe(3)
    expect(pageHeights(pdf)).toEqual([792, 792, 792])
  })

  it('writes a cbz with pages and ComicInfo.xml', async () => {
    const { svc, addEpisode, req, finished, target } = await setup()
    const { episode } = await addEpisode('The Rooftop', ['ready', 'ready', 'ready'], 'Mina & Jin <meet>')
    const request = req({ episodeIds: [episode.id], preset: 'cbz' })
    expect(svc.targetKind(request)).toBe('file')
    expect(await svc.suggestedName(request)).toBe('Moon Tower - 01 - The Rooftop.cbz')
    const file = path.join(target, 'Moon Tower - 01 - The Rooftop.cbz')
    const { jobId } = await svc.start(request, file)
    expect(await finished(jobId)).toMatchObject({ stage: 'done', outputs: [file] })
    const entries = readZip(await fs.promises.readFile(file))
    // Breaks between rows: 1280 px fits two 600 px rows, so the pages are 1200 and 600 px.
    expect(entries.map((e) => e.name)).toEqual(['001.jpg', '002.jpg', 'ComicInfo.xml'])
    expect(sizeOf(entries[0].data)).toEqual({ width: 800, height: 1200 })
    expect(sizeOf(entries[1].data)).toEqual({ width: 800, height: 600 })
    const info = entries[2].data.toString('utf8')
    expect(info).toContain('<Series>Moon Tower</Series>')
    expect(info).toContain('<Title>The Rooftop</Title>')
    expect(info).toContain('<Number>1</Number>')
    expect(info).toContain('<Summary>Mina &amp; Jin &lt;meet&gt;</Summary>')
    expect(info).toContain('<PageCount>2</PageCount>')
  })

  it('a combined cbz describes the volume', async () => {
    const { svc, addEpisode, req, finished, target } = await setup()
    const one = await addEpisode('The Rooftop', ['ready'])
    const two = await addEpisode('The Fall', ['ready', 'ready', 'ready'])
    const three = await addEpisode('The Landing', ['ready'])
    const request = req({ episodeIds: [three.episode.id, one.episode.id, two.episode.id], preset: 'cbz', combine: true })
    expect(svc.targetKind(request)).toBe('file')
    expect(await svc.suggestedName(request)).toBe('Moon Tower - Episodes 1-3.cbz')
    const file = path.join(target, 'Moon Tower - Episodes 1-3.cbz')
    const { jobId } = await svc.start(request, file)
    expect((await finished(jobId)).stage).toBe('done')
    const entries = readZip(await fs.promises.readFile(file))
    // Each episode starts on a new page: 1 + 2 + 1, numbered on across episodes in episode order.
    expect(entries.map((e) => e.name)).toEqual(['001.jpg', '002.jpg', '003.jpg', '004.jpg', 'ComicInfo.xml'])
    expect(entries.slice(0, 4).map((e) => sizeOf(e.data).height)).toEqual([600, 1200, 600, 600])
    const info = entries[4].data.toString('utf8')
    expect(info).toContain('<Series>Moon Tower</Series>')
    expect(info).toContain('<Title>Episodes 1–3</Title>')
    expect(info).not.toContain('<Number>')
    expect(info).toContain('<PageCount>4</PageCount>')
  })

  it('combine with a single episode is treated as not combined', async () => {
    const { svc, addEpisode, req, finished, target } = await setup()
    const { episode } = await addEpisode('The Rooftop', ['ready'])
    const request = req({ episodeIds: [episode.id], preset: 'cbz', combine: true })
    expect(await svc.suggestedName(request)).toBe('Moon Tower - 01 - The Rooftop.cbz')
    const file = path.join(target, 'one.cbz')
    const { jobId } = await svc.start(request, file)
    expect((await finished(jobId)).stage).toBe('done')
    const info = readZip(await fs.promises.readFile(file)).at(-1)!.data.toString('utf8')
    expect(info).toContain('<Title>The Rooftop</Title>')
    expect(info).toContain('<Number>1</Number>')
  })

  it('targetKind picks a folder for webtoon, long-image and several separate episodes', async () => {
    const { svc, req } = await setup()
    const one = { episodeIds: ['epi_0000000001'] }
    const two = { episodeIds: ['epi_0000000001', 'epi_0000000002'] }
    expect(svc.targetKind(req({ ...one, preset: 'webtoon' }))).toBe('folder')
    expect(svc.targetKind(req({ ...one, preset: 'long-image' }))).toBe('folder')
    expect(svc.targetKind(req({ ...one, preset: 'pdf-reading' }))).toBe('file')
    expect(svc.targetKind(req({ ...two, preset: 'pdf-print' }))).toBe('folder')
    expect(svc.targetKind(req({ ...two, preset: 'pdf-print', combine: true }))).toBe('file')
    expect(svc.targetKind(req({ ...two, preset: 'cbz' }))).toBe('folder')
    expect(svc.targetKind(req({ ...two, preset: 'webtoon', combine: true }))).toBe('folder')
  })

  it('writes a long image from stitched PNG slices, naming parts -1, -2 only when there is more than one', async () => {
    const { svc, capturer, addEpisode, req, finished, target } = await setup()
    const { episode } = await addEpisode('The Rooftop', ['ready', 'ready'])
    const request = req({ episodeIds: [episode.id], preset: 'long-image', imageType: 'png' })
    expect(svc.targetKind(request)).toBe('folder')

    const first = await svc.start(request, target)
    const single = path.join(target, 'Moon Tower - 01 - The Rooftop.png')
    expect(await finished(first.jobId)).toMatchObject({ stage: 'done', outputs: [single] })
    expect(capturer.captures.every((c) => c.format === 'png' && c.slice.height <= 1280)).toBe(true)
    // The 1×N fake bitmaps stack, so the stitched part is as tall as the strip.
    expect(sizeOf(await fs.promises.readFile(single))).toEqual({ width: 1, height: 1200 })
    await fs.promises.rm(single)

    // Two 40000 px rows are taller than one 65000 px part at Standard.
    capturer.rowHeight = 40000
    capturer.captures = []
    const second = await svc.start(request, target)
    const parts = [path.join(target, 'Moon Tower - 01 - The Rooftop-1.png'), path.join(target, 'Moon Tower - 01 - The Rooftop-2.png')]
    expect(await finished(second.jobId)).toMatchObject({ stage: 'done', outputs: parts })
    expect(await readdir(target)).toEqual(parts.map((p) => path.basename(p)))
    expect(sizeOf(await fs.promises.readFile(parts[0]))).toEqual({ width: 1, height: 65000 })
    expect(sizeOf(await fs.promises.readFile(parts[1]))).toEqual({ width: 1, height: 15000 })
    // No capture crosses a part boundary.
    expect(capturer.captures.some((c) => c.slice.top < 65000 && c.slice.top + c.slice.height > 65000)).toBe(false)
  })

  it('skips an episode with no finished panel, and fails with "Nothing to export: no episode has a finished panel" when none has one', async () => {
    const { svc, capturer, addEpisode, req, finished, progress, target } = await setup()
    const one = await addEpisode('The Rooftop', ['ready'])
    const two = await addEpisode('The Fall', ['none', 'failed', 'pending'])

    await expect(svc.start(req({ episodeIds: [two.episode.id], preset: 'pdf-reading' }), path.join(target, 'x.pdf'))).rejects.toThrow(NOTHING)
    expect(capturer.opened).toBe(0)

    const { jobId } = await svc.start(req({ episodeIds: [one.episode.id, two.episode.id], preset: 'pdf-reading' }), target)
    expect(await finished(jobId)).toMatchObject({ stage: 'done', outputs: [path.join(target, 'Moon Tower - 01 - The Rooftop.pdf')] })
    expect(await readdir(target)).toEqual(['Moon Tower - 01 - The Rooftop.pdf'])
    expect(capturer.renders.map((r) => r.snapshot.episode.id)).toEqual([one.episode.id])
    expect(progress.every((p) => p.episodeCount === 1)).toBe(true)
  })

  it('emits rendering, capturing, writing and done progress in order, with outputs on done', async () => {
    const { ctx, svc, addEpisode, req, finished, progress, projectIds, target } = await setup()
    const { episode } = await addEpisode('The Rooftop', ['ready', 'ready', 'ready'])
    const { jobId } = await svc.start(req({ episodeIds: [episode.id], preset: 'webtoon' }), target)
    await finished(jobId)
    expect(projectIds).toEqual(Array(5).fill(ctx.id))
    const folder = path.join(target, 'Moon Tower - 01 - The Rooftop')
    const base = { jobId, episodeIndex: 0, episodeCount: 1, message: null }
    expect(progress).toEqual([
      { ...base, stage: 'rendering', slice: 0, sliceCount: 0, outputs: [] },
      { ...base, stage: 'capturing', slice: 1, sliceCount: 2, outputs: [] },
      { ...base, stage: 'capturing', slice: 2, sliceCount: 2, outputs: [] },
      { ...base, stage: 'writing', slice: 2, sliceCount: 2, outputs: [] },
      { ...base, stage: 'done', slice: 2, sliceCount: 2, outputs: [folder] }
    ])
  })

  it('cancel during capturing stops, emits cancelled and leaves no .part', async () => {
    const { s, svc, capturer, addEpisode, req, finished, target } = await setup()
    const { episode } = await addEpisode('The Rooftop', ['ready', 'ready', 'ready'])
    s.bus.subscribe((e) => {
      if (e.type === 'export.progress' && e.progress.stage === 'capturing') svc.cancel(e.progress.jobId)
    })
    const { jobId } = await svc.start(req({ episodeIds: [episode.id], preset: 'webtoon' }), target)
    expect(await finished(jobId)).toMatchObject({ stage: 'cancelled', message: null, outputs: [] })
    expect(capturer.captures).toHaveLength(1)
    expect(capturer.closed).toBe(1)
    expect(await readdir(target)).toEqual([])
    expect(svc.outputsOf(jobId)).toEqual([])
  })

  it('cancel during writing removes parts', async () => {
    const { s, svc, capturer, addEpisode, req, finished, target } = await setup()
    const one = await addEpisode('The Rooftop', ['ready', 'ready'])
    const two = await addEpisode('The Fall', ['ready'])
    let cancelled = false
    s.bus.subscribe((e) => {
      if (e.type === 'export.progress' && e.progress.stage === 'writing' && !cancelled) {
        cancelled = true
        svc.cancel(e.progress.jobId)
      }
    })
    const { jobId } = await svc.start(req({ episodeIds: [one.episode.id, two.episode.id], preset: 'pdf-reading' }), target)
    expect((await finished(jobId)).stage).toBe('cancelled')
    expect(capturer.renders).toHaveLength(1)
    expect(capturer.closed).toBe(1)
    expect(await readdir(target)).toEqual([])
  })

  it('cancel after the last episode is written still leaves nothing', async () => {
    const { s, svc, addEpisode, req, finished, target, trashed } = await setup()
    const { episode } = await addEpisode('The Rooftop', ['ready'])
    const file = path.join(target, 'one.pdf')
    await fs.promises.writeFile(file, 'old')
    s.bus.subscribe((e) => {
      if (e.type === 'export.progress' && e.progress.stage === 'writing') svc.cancel(e.progress.jobId)
    })
    const { jobId } = await svc.start(req({ episodeIds: [episode.id], preset: 'pdf-reading' }), file)
    expect((await finished(jobId)).stage).toBe('cancelled')
    expect(await readdir(target)).toEqual(['one.pdf'])
    expect(await fs.promises.readFile(file, 'utf8')).toBe('old')
    expect(trashed).toEqual([])
  })

  it('a capturer failure emits failed with its message, removes parts and closes the capturer', async () => {
    const { svc, capturer, addEpisode, req, finished, target } = await setup()
    const one = await addEpisode('The Rooftop', ['ready'])
    const two = await addEpisode('The Fall', ['ready'])
    // Episode 1's PDF is complete when episode 2's capture fails, so a closed part must go too.
    capturer.failAt = 2
    const { jobId } = await svc.start(req({ episodeIds: [one.episode.id, two.episode.id], preset: 'pdf-reading' }), target)
    expect(await finished(jobId)).toMatchObject({ stage: 'failed', message: 'Episode 1, panel 2: the image could not be loaded', outputs: [] })
    expect(capturer.opened).toBe(1)
    expect(capturer.closed).toBe(1)
    expect(await readdir(target)).toEqual([])
  })

  it('a failure while capturing webtoon slices removes the .part folder', async () => {
    const { svc, capturer, addEpisode, req, finished, target } = await setup()
    const { episode } = await addEpisode('The Rooftop', ['ready', 'ready', 'ready'])
    capturer.failAt = 2
    const { jobId } = await svc.start(req({ episodeIds: [episode.id], preset: 'webtoon' }), target)
    expect((await finished(jobId)).stage).toBe('failed')
    expect(capturer.closed).toBe(1)
    expect(await readdir(target)).toEqual([])
  })

  it('refuses a second job while one runs', async () => {
    const { svc, capturer, addEpisode, req, finished, target } = await setup()
    const { episode } = await addEpisode('The Rooftop', ['ready'])
    const request = req({ episodeIds: [episode.id], preset: 'webtoon' })
    const gate = deferred()
    capturer.gate = gate.promise
    const first = await svc.start(request, target)
    await expect(svc.start(request, target)).rejects.toThrow('An export is already running')
    gate.release()
    expect((await finished(first.jobId)).stage).toBe('done')
    capturer.gate = null
    // Once the first has ended, the next one may start.
    const next = await svc.start(request, path.join(target, 'again'))
    expect((await finished(next.jobId)).stage).toBe('done')
  })

  it('refuses two starts made at the same time', async () => {
    const { svc, addEpisode, req, finished, target } = await setup()
    const { episode } = await addEpisode('The Rooftop', ['ready'])
    const request = req({ episodeIds: [episode.id], preset: 'webtoon' })
    const [a, b] = await Promise.allSettled([svc.start(request, target), svc.start(request, target)])
    expect(a.status).toBe('fulfilled')
    expect(b).toMatchObject({ status: 'rejected', reason: new Error('An export is already running') })
    if (a.status === 'fulfilled') await finished(a.value.jobId)
  })

  it('trashes an existing output only after a successful run', async () => {
    const { svc, capturer, addEpisode, req, finished, target, trashed } = await setup()
    const { episode } = await addEpisode('The Rooftop', ['ready'])
    const file = path.join(target, 'one.pdf')
    await fs.promises.writeFile(file, 'old')
    const folder = path.join(target, 'Moon Tower - 01 - The Rooftop')
    await fs.promises.mkdir(folder)
    await fs.promises.writeFile(path.join(folder, '009.jpg'), 'old')

    capturer.failAt = 1
    const failed = await svc.start(req({ episodeIds: [episode.id], preset: 'pdf-reading' }), file)
    expect((await finished(failed.jobId)).stage).toBe('failed')
    expect(trashed).toEqual([])
    expect(await fs.promises.readFile(file, 'utf8')).toBe('old')

    capturer.failAt = null
    const pdf = await svc.start(req({ episodeIds: [episode.id], preset: 'pdf-reading' }), file)
    expect((await finished(pdf.jobId)).stage).toBe('done')
    expect(trashed).toEqual([file])
    expect((await fs.promises.readFile(file)).subarray(0, 5).toString('latin1')).toBe('%PDF-')

    const slices = await svc.start(req({ episodeIds: [episode.id], preset: 'webtoon' }), target)
    expect((await finished(slices.jobId)).stage).toBe('done')
    expect(trashed).toEqual([file, folder])
    expect(await readdir(folder)).toEqual(['001.jpg'])
    expect(await readdir(target)).toEqual(['Moon Tower - 01 - The Rooftop', 'one.pdf'])
  })

  it('shutdown cancels a running job and waits for its clean-up', async () => {
    const { svc, capturer, addEpisode, req, finished, target } = await setup()
    const { episode } = await addEpisode('The Rooftop', ['ready', 'ready', 'ready'])
    const gate = deferred()
    capturer.gate = gate.promise
    const { jobId } = await svc.start(req({ episodeIds: [episode.id], preset: 'webtoon' }), target)
    await vi.waitFor(() => expect(capturer.captures).toHaveLength(1))
    const stopping = svc.shutdown()
    gate.release()
    await stopping
    expect((await finished(jobId)).stage).toBe('cancelled')
    expect(capturer.closed).toBe(1)
    expect(await readdir(target)).toEqual([])
  })
})
