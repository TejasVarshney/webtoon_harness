// The writer for each export preset. A writer plans an episode's slices, takes the captured images one at a time,
// and writes them to `.part` paths; ExportService renames the parts once every output is complete.

import fs from 'node:fs'
import path from 'node:path'
import type { ExportPreset, ViewLayout } from '@shared/types'
import { comicInfoXml } from './comic-info'
import { stitchBitmaps, type Bitmap } from './long-image'
import { PdfWriter, printPage, readingPage } from './pdf-writer'
import { longImagePartHeight, PAGE_HEIGHT, planSlices, PRINT_PAGE_HEIGHT, type Slice } from './slice-plan'
import type { ImageCodec } from './types'
import { ZipWriter } from './zip-writer'

/** What a finished output is written under until the job succeeds. */
export const PART = '.part'

/** A failed write, already worded for the user: it names the output, never the `.part` path. */
export class WriteError extends Error {}

/**
 * Run a file operation for the output `final`, rethrowing any failure as `Could not write <final>: <reason>`.
 * The reason is the OS's (`EACCES: permission denied`) with the syscall and `.part` path Node appends left out.
 * A `WriteError` passes through as it is.
 */
export async function writing<T>(final: string, op: () => Promise<T>): Promise<T> {
  try {
    return await op()
  } catch (error) {
    if (error instanceof WriteError) throw error
    throw new WriteError(`Could not write ${final}: ${osReason(error)}`, { cause: error })
  }
}

function osReason(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const { syscall } = error as NodeJS.ErrnoException
  const tail = syscall ? error.message.indexOf(`, ${syscall}`) : -1
  return tail > 0 ? error.message.slice(0, tail) : error.message
}

/**
 * The `.part` files and folders one job created. Only these are ever removed: a path that already exists is
 * refused, so a clean-up can never delete something the job did not make.
 */
export class PartFiles {
  private readonly paths = new Set<string>()

  /** Create an empty file at `p` and record it, failing if anything is already there. */
  async claimFile(p: string): Promise<void> {
    const handle = await fs.promises.open(p, 'wx').catch(inTheWay(p))
    this.paths.add(p)
    await handle.close()
  }

  /** Create a folder at `p` and record it, failing if anything is already there. */
  async claimDir(p: string): Promise<void> {
    await fs.promises.mkdir(p).catch(inTheWay(p))
    this.paths.add(p)
  }

  /** `p` was renamed to its final name, so it is no longer the job's to remove. */
  release(p: string): void {
    this.paths.delete(p)
  }

  /** Remove every recorded part. Never throws: a clean-up must not hide the error that caused it. */
  async removeAll(): Promise<void> {
    for (const p of this.paths) {
      await fs.promises.rm(p, { recursive: true, force: true, maxRetries: 3 }).catch((error: unknown) => {
        console.warn(`Export: could not remove ${p}`, error)
      })
    }
    this.paths.clear()
  }
}

function inTheWay(p: string): (error: unknown) => never {
  return (error) => {
    // The one message that names a `.part` path: it is the thing the user has to remove.
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new WriteError(`${p} is in the way: move or delete it and export again`)
    throw error
  }
}

export interface WriterOptions {
  preset: ExportPreset
  imageType: 'jpeg' | 'png'
  paper: 'a4' | 'letter'
  /** Device px per CSS px for the presets that offer a resolution. `pdf-print` is always 2. */
  scale: 1 | 2
  /** The project title, for ComicInfo. */
  series: string
  /** The episodes being exported, in export order. */
  episodes: { number: number; title: string; synopsis: string }[]
  /**
   * The final path of each output, with its extension: one per episode, or a single one that every episode goes
   * into (a combined PDF or CBZ). For `webtoon` it is a folder; for `long-image` the parts insert `-1`, `-2`...
   */
  finals: string[]
  codec: ImageCodec
  parts: PartFiles
}

/** Writes one preset's outputs. Calls go `beginEpisode`, `addSlice` per slice, `endEpisode`, per episode, then `finish`. */
export interface PresetWriter {
  /** How every slice is captured. */
  readonly capture: { scale: 1 | 2; format: 'jpeg' | 'png' }
  /** Each completed output's `.part` path and final path, added as it is completed. */
  readonly outputs: { part: string; final: string }[]
  /** Start episode `index` (of `episodes`) and return the slices to capture for it, in order. */
  beginEpisode(index: number, layout: ViewLayout): Promise<Slice[]>
  /** The captured image of the next slice. */
  addSlice(slice: Slice, image: Buffer): Promise<void>
  /** Complete the episode's own output. A shared output is completed by `finish`. */
  endEpisode(): Promise<void>
  finish(): Promise<void>
  /** Close any file left open, so the parts can be removed. Never throws. */
  abort(): Promise<void>
}

export function createPresetWriter(o: WriterOptions): PresetWriter {
  switch (o.preset) {
    case 'webtoon':
      return new WebtoonSlices(o)
    case 'long-image':
      return new LongImage(o)
    case 'pdf-reading':
    case 'pdf-print':
      return new PdfOutput(o)
    case 'cbz':
      return new CbzOutput(o)
  }
}

const pad3 = (n: number): string => String(n).padStart(3, '0')
const extOf = (format: 'jpeg' | 'png'): string => (format === 'jpeg' ? 'jpg' : 'png')

/** `webtoon`: a folder per episode of `001.jpg`, `002.jpg`... cut every 1280 CSS px. */
class WebtoonSlices implements PresetWriter {
  readonly capture: { scale: 1 | 2; format: 'jpeg' | 'png' }
  readonly outputs: { part: string; final: string }[] = []
  private current = { part: '', final: '' }
  private count = 0

  constructor(private readonly o: WriterOptions) {
    this.capture = { scale: o.scale, format: o.imageType }
  }

  async beginEpisode(index: number, layout: ViewLayout): Promise<Slice[]> {
    const final = this.o.finals[index]
    this.current = { part: final + PART, final }
    this.count = 0
    await writing(final, () => this.o.parts.claimDir(this.current.part))
    return planSlices({ ...layout, pageHeight: PAGE_HEIGHT.webtoon, breaks: 'anywhere' })
  }

  async addSlice(_slice: Slice, image: Buffer): Promise<void> {
    this.count += 1
    const file = path.join(this.current.part, `${pad3(this.count)}.${extOf(this.o.imageType)}`)
    await writing(this.current.final, () => fs.promises.writeFile(file, image))
  }

  async endEpisode(): Promise<void> {
    this.outputs.push(this.current)
  }

  async finish(): Promise<void> {}

  async abort(): Promise<void> {}
}

/**
 * `long-image`: one image per episode, in parts of at most 65,000 device px. Each part is captured as PNG slices of
 * at most 1280 CSS px, stitched, and encoded in the chosen type; only one part's bitmaps are held at a time.
 */
class LongImage implements PresetWriter {
  readonly capture: { scale: 1 | 2; format: 'jpeg' | 'png' }
  readonly outputs: { part: string; final: string }[] = []
  /** The final path of each part of the current episode, and how many slices make it up. */
  private pending: { final: string; slices: number }[] = []
  private bitmaps: Bitmap[] = []

  constructor(private readonly o: WriterOptions) {
    this.capture = { scale: o.scale, format: 'png' }
  }

  async beginEpisode(index: number, layout: ViewLayout): Promise<Slice[]> {
    const ext = `.${extOf(this.o.imageType)}`
    const base = this.o.finals[index].slice(0, -ext.length)
    const parts = planSlices({ ...layout, pageHeight: longImagePartHeight(this.o.scale), breaks: 'anywhere' })
    const slices: Slice[] = []
    this.pending = parts.map((part, k) => {
      const own = planSlices({ totalHeight: part.height, rows: [], pageHeight: PAGE_HEIGHT.webtoon, breaks: 'anywhere' })
      slices.push(...own.map((s) => ({ top: part.top + s.top, height: s.height })))
      return { final: parts.length > 1 ? `${base}-${k + 1}${ext}` : `${base}${ext}`, slices: own.length }
    })
    this.bitmaps = []
    return slices
  }

  async addSlice(_slice: Slice, image: Buffer): Promise<void> {
    this.bitmaps.push(this.o.codec.toBitmap(image))
    const next = this.pending[0]
    if (this.bitmaps.length < next.slices) return
    const data = this.o.codec.encode(stitchBitmaps(this.bitmaps), this.o.imageType)
    this.bitmaps = []
    this.pending.shift()
    const part = next.final + PART
    await writing(next.final, async () => {
      await this.o.parts.claimFile(part)
      await fs.promises.writeFile(part, data)
    })
    this.outputs.push({ part, final: next.final })
  }

  async endEpisode(): Promise<void> {}

  async finish(): Promise<void> {}

  async abort(): Promise<void> {
    this.bitmaps = []
  }
}

/** Shared by the PDF and CBZ writers: one output per episode, or one for all of them. */
abstract class PagedOutput<W extends { close(): Promise<void>; abort(): Promise<void> }> implements PresetWriter {
  readonly outputs: { part: string; final: string }[] = []
  abstract readonly capture: { scale: 1 | 2; format: 'jpeg' | 'png' }
  protected writer: W | null = null
  /** Pages in the open output. */
  protected pages = 0
  /** The episode being written. */
  protected episode = 0
  protected current = { part: '', final: '' }

  constructor(protected readonly o: WriterOptions) {}

  /** Whether every episode goes into the one output. */
  protected get shared(): boolean {
    return this.o.finals.length < this.o.episodes.length
  }

  protected abstract open(part: string): Promise<W>
  protected abstract plan(layout: ViewLayout): Slice[]
  abstract addSlice(slice: Slice, image: Buffer): Promise<void>
  /** Runs just before the output is closed. */
  protected async beforeClose(_writer: W): Promise<void> {}

  async beginEpisode(index: number, layout: ViewLayout): Promise<Slice[]> {
    this.episode = index
    if (!this.writer) {
      const final = this.o.finals[this.shared ? 0 : index]
      const part = final + PART
      this.current = { part, final }
      this.writer = await writing(final, async () => {
        await this.o.parts.claimFile(part)
        return this.open(part)
      })
      this.pages = 0
    }
    return this.plan(layout)
  }

  async endEpisode(): Promise<void> {
    if (!this.shared) await this.close()
  }

  async finish(): Promise<void> {
    if (this.writer) await this.close()
  }

  async abort(): Promise<void> {
    const writer = this.writer
    this.writer = null
    await writer?.abort().catch(() => undefined)
  }

  private async close(): Promise<void> {
    const writer = this.writer!
    await writing(this.current.final, async () => {
      await this.beforeClose(writer)
      await writer.close()
    })
    this.writer = null
    this.outputs.push(this.current)
  }
}

/** `pdf-reading` (pages the size of 1280 px slices) and `pdf-print` (A4 or Letter pages, cut between rows, at scale 2). */
class PdfOutput extends PagedOutput<PdfWriter> {
  readonly capture: { scale: 1 | 2; format: 'jpeg' | 'png' }

  constructor(o: WriterOptions) {
    super(o)
    this.capture = { scale: o.preset === 'pdf-print' ? 2 : o.scale, format: 'jpeg' }
  }

  protected open(part: string): Promise<PdfWriter> {
    return PdfWriter.open(part)
  }

  protected plan(layout: ViewLayout): Slice[] {
    return this.o.preset === 'pdf-print'
      ? planSlices({ ...layout, pageHeight: PRINT_PAGE_HEIGHT[this.o.paper], breaks: 'rows' })
      : planSlices({ ...layout, pageHeight: PAGE_HEIGHT['pdf-reading'], breaks: 'anywhere' })
  }

  async addSlice(slice: Slice, jpeg: Buffer): Promise<void> {
    const size = this.o.codec.size(jpeg)
    const px = { w: size.width, h: size.height }
    const page = this.o.preset === 'pdf-print' ? printPage(this.o.paper, { cssHeight: slice.height }, jpeg, px) : readingPage({ cssHeight: slice.height }, jpeg, px)
    const pdf = this.writer!
    await writing(this.current.final, () => pdf.addPage(page))
    this.pages += 1
  }
}

/** `cbz`: `001.jpg`... cut between rows, then `ComicInfo.xml` for the episode, or for the volume when combined. */
class CbzOutput extends PagedOutput<ZipWriter> {
  readonly capture: { scale: 1 | 2; format: 'jpeg' | 'png' }

  constructor(o: WriterOptions) {
    super(o)
    this.capture = { scale: o.scale, format: 'jpeg' }
  }

  protected open(part: string): Promise<ZipWriter> {
    return ZipWriter.open(part)
  }

  protected plan(layout: ViewLayout): Slice[] {
    return planSlices({ ...layout, pageHeight: PAGE_HEIGHT.cbz, breaks: 'rows' })
  }

  async addSlice(_slice: Slice, jpeg: Buffer): Promise<void> {
    this.pages += 1
    const zip = this.writer!
    await writing(this.current.final, () => zip.add(`${pad3(this.pages)}.jpg`, jpeg))
  }

  protected async beforeClose(zip: ZipWriter): Promise<void> {
    const { series, episodes } = this.o
    let xml: string
    if (this.shared) {
      const numbers = episodes.map((e) => e.number)
      xml = comicInfoXml({ series, title: `Episodes ${Math.min(...numbers)}–${Math.max(...numbers)}`, pageCount: this.pages })
    } else {
      const e = episodes[this.episode]
      xml = comicInfoXml({ series, title: e.title, number: e.number, summary: e.synopsis || undefined, pageCount: this.pages })
    }
    await zip.add('ComicInfo.xml', Buffer.from(xml, 'utf8'))
  }
}
