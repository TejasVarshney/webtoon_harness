import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { isFinished, unfinishedReason } from '@shared/export-status'
import { ExportRequestSchema } from '@shared/schemas'
import type { ExportInspection, ExportProgress, ExportRequest, ExportSnapshot } from '@shared/types'
import type { CharacterService } from '../domain/character-service'
import type { EpisodeService } from '../domain/episode-service'
import type { PanelService } from '../domain/panel-service'
import type { EventBus } from '../events/bus'
import { RETRYABLE_RENAME_CODES, renameWithRetry } from '../storage/atomic'
import { isNotFound } from '../storage/fs-errors'
import type { ProjectStore } from '../storage/project-store'
import { outputNames, safeFileName } from './file-names'
import { createPresetWriter, osReason, PartFiles, writing, WriteError, type PresetWriter, type WriterOptions } from './preset-writers'
import type { ImageCodec, StripCapturer } from './types'

export interface ExportServiceOptions {
  projects: ProjectStore
  episodes: EpisodeService
  panels: PanelService
  characters: CharacterService
  bus: EventBus
  /** Moves a path to the OS trash. Used only to replace an existing output, and only after a successful run. */
  trash: (absPath: string) => Promise<void>
  /** A fresh capturer for each job. */
  createCapturer: () => StripCapturer
  codec: ImageCodec
  /** Where the save dialog starts. */
  exportsDir: string
}

const NOTHING_TO_EXPORT = 'Nothing to export: no episode has a finished panel'
/** How long `shutdown` waits for a cancelled job to clean up, like the plugins. */
const SHUTDOWN_WAIT_MS = 5000
/** A scanner or indexer may briefly hold a fresh output; renaming a whole `.part` folder can also give EACCES. */
const COMMIT_RETRYABLE = new Set([...RETRYABLE_RENAME_CODES, 'EACCES'])

/** Thrown inside a run when its cancel flag is seen; it ends the run as `cancelled`, not `failed`. */
class Cancelled extends Error {}

interface Job {
  id: string
  projectId: string
  cancelled: boolean
  /** The job's capturer, once created. */
  capturer: StripCapturer | null
  /** Its one `close()`, shared by a cancel and the run's own clean-up, so it is closed once. */
  closing: Promise<void> | null
  /** Resolves once the job has fully ended (files cleaned up, capturer closed, terminal event sent). Never rejects. */
  settled: Promise<void>
}

/** Everything a run needs, read before `start` resolves so later edits to the project cannot reach the output. */
interface JobPlan {
  snapshots: ExportSnapshot[]
  writer: Omit<WriterOptions, 'codec' | 'parts'>
  /** The folder the outputs go in, created if missing. */
  outputDir: string
}

/**
 * Episode export jobs (spec §6.1): one at a time, each from a snapshot of the project taken at start. A run renders
 * every episode in one `StripCapturer`, captures its slices and feeds them to the preset's writer, which writes to
 * `.part` paths. Only when every output is complete are existing targets trashed and the parts renamed; a failure
 * or cancel removes every part. Progress goes out on the bus as `export.progress`.
 */
export class ExportService {
  readonly exportsDir: string
  private job: Job | null = null
  /** The outputs of every job that ended, by job id (empty unless it succeeded). */
  private readonly ended = new Map<string, string[]>()

  constructor(private readonly opts: ExportServiceOptions) {
    this.exportsDir = opts.exportsDir
  }

  /** For each episode, in number order: its panel counts and the unfinished panels with their 1-based positions. */
  async inspect(projectId: string, episodeIds: string[]): Promise<ExportInspection> {
    const ctx = await this.opts.projects.open(projectId)
    const episodes: ExportInspection['episodes'] = []
    for (const id of unique(episodeIds)) {
      const episode = await this.opts.episodes.get(ctx, id)
      const panels = await this.opts.panels.list(ctx, id)
      const unfinished: ExportInspection['episodes'][number]['unfinished'] = []
      panels.forEach((panel, i) => {
        const reason = unfinishedReason(panel)
        if (reason) unfinished.push({ panelId: panel.id, position: i + 1, reason })
      })
      episodes.push({ episodeId: id, number: episode.number, title: episode.title, panelCount: panels.length, finishedCount: panels.length - unfinished.length, unfinished })
    }
    episodes.sort((a, b) => a.number - b.number)
    return { episodes }
  }

  /** Whether the save dialog picks a folder (several outputs, or a webtoon folder) or one file. */
  targetKind(req: ExportRequest): 'file' | 'folder' {
    if (req.preset === 'webtoon' || req.preset === 'long-image') return 'folder'
    return unique(req.episodeIds).length >= 2 && !req.combine ? 'folder' : 'file'
  }

  /**
   * A name for the save dialog. For a file it is the output's name with its extension (`<Project> - 03 - Title.pdf`,
   * or `<Project> - Episodes 1-3.cbz` when combined). For a folder, whose outputs are named inside it, it is the
   * project title alone.
   */
  async suggestedName(req: ExportRequest): Promise<string> {
    const ctx = await this.opts.projects.open(req.projectId)
    const title = (await this.opts.projects.getMeta(ctx)).title
    if (this.targetKind(req) === 'folder') return safeFileName(title)
    const episodes = []
    for (const id of unique(req.episodeIds)) episodes.push(await this.opts.episodes.get(ctx, id))
    episodes.sort((a, b) => a.number - b.number)
    return `${outputNames(title, episodes, episodes.length >= 2)[0]}${extension(req)}`
  }

  /**
   * Validate the request, snapshot the episodes and start the job without waiting for it. `target` is the chosen
   * file, or the folder the outputs go in (`targetKind`). Rejects while another job runs, for an unknown project or
   * episode, and with "Nothing to export..." when no requested episode has a finished panel; episodes without one
   * are skipped.
   */
  async start(req: ExportRequest, target: string): Promise<{ jobId: string }> {
    // Claimed before the first await, so two starts at once cannot both pass.
    if (this.job) throw new Error('An export is already running')
    let settle!: () => void
    const job: Job = { id: `exp_${randomUUID().replaceAll('-', '').slice(0, 10)}`, projectId: req.projectId, cancelled: false, capturer: null, closing: null, settled: new Promise((r) => (settle = r)) }
    this.job = job
    let plan: JobPlan
    try {
      const request = ExportRequestSchema.parse(req)
      if (!path.isAbsolute(target)) throw new Error(`The export target must be an absolute path: ${target}`)
      plan = await this.plan(request, target)
    } catch (error) {
      this.job = null
      settle()
      throw error
    }
    void this.run(job, plan).finally(settle)
    return { jobId: job.id }
  }

  /**
   * Ask the job to stop. Its capturer is closed at once, which ends a render or capture in progress; otherwise it
   * stops before its next slice. It removes its files and reports `cancelled`.
   */
  cancel(jobId: string): void {
    if (this.job?.id === jobId) this.stop(this.job)
  }

  /**
   * The files and folders an ended job put in place: all of them after `done`, those placed before the failure after
   * `failed`, none after `cancelled`. Empty while it runs.
   */
  outputsOf(jobId: string): string[] {
    return [...(this.ended.get(jobId) ?? [])]
  }

  /** For the quit gate: cancel the running job and wait for its clean-up, at most 5 s. */
  async shutdown(): Promise<void> {
    const job = this.job
    if (!job) return
    this.stop(job)
    let timer: NodeJS.Timeout | undefined
    await Promise.race([job.settled, new Promise<void>((r) => (timer = setTimeout(r, SHUTDOWN_WAIT_MS)))])
    clearTimeout(timer)
  }

  private stop(job: Job): void {
    job.cancelled = true
    void this.closeCapturer(job)
  }

  /** Close the job's capturer once, however many ask. Never rejects. */
  private closeCapturer(job: Job): Promise<void> {
    if (!job.capturer) return Promise.resolve()
    job.closing ??= job.capturer.close().catch((error: unknown) => console.warn('Export: closing the capturer failed', error))
    return job.closing
  }

  private async plan(req: ExportRequest, target: string): Promise<JobPlan> {
    const { projects, episodes, panels, characters } = this.opts
    const ctx = await projects.open(req.projectId)
    const meta = await projects.getMeta(ctx)
    // Archived characters too: a panel may still name one as a speaker.
    const cast = await characters.list(ctx, { includeArchived: true })
    const all: ExportSnapshot[] = []
    for (const id of unique(req.episodeIds)) {
      const episode = await episodes.get(ctx, id)
      all.push({ projectId: ctx.id, episode, panels: await panels.list(ctx, id), characters: cast, lettering: req.lettering })
    }
    const snapshots = all.filter((s) => s.panels.some(isFinished)).sort((a, b) => a.episode.number - b.episode.number)
    if (snapshots.length === 0) throw new Error(NOTHING_TO_EXPORT)

    const kind = this.targetKind(req)
    const ext = extension(req)
    const finals = kind === 'file' ? [target] : outputNames(meta.title, snapshots.map((s) => s.episode), false).map((name) => path.join(target, name + ext))
    return {
      snapshots,
      outputDir: kind === 'file' ? path.dirname(target) : target,
      writer: {
        preset: req.preset,
        imageType: req.imageType,
        paper: req.paper,
        scale: req.resolution === 'high' ? 2 : 1,
        series: meta.title,
        episodes: snapshots.map((s) => ({ number: s.episode.number, title: s.episode.title, synopsis: s.episode.synopsis })),
        finals
      }
    }
  }

  /** The job itself. Never throws: every way it ends is reported as a terminal progress event. */
  private async run(job: Job, plan: JobPlan): Promise<void> {
    const progress: ExportProgress = {
      jobId: job.id,
      stage: 'rendering',
      episodeIndex: 0,
      episodeCount: plan.snapshots.length,
      slice: 0,
      sliceCount: 0,
      message: null,
      outputs: []
    }
    const emit = (patch: Partial<ExportProgress>): void => {
      Object.assign(progress, patch)
      this.opts.bus.emit({ type: 'export.progress', projectId: job.projectId, progress: { ...progress, outputs: [...progress.outputs] } })
    }
    const stopIfCancelled = (): void => {
      if (job.cancelled) throw new Cancelled()
    }

    const parts = new PartFiles()
    const writer = createPresetWriter({ ...plan.writer, codec: this.opts.codec, parts })
    /** The final paths already put in place: these stay even if a later output fails. */
    const committed: string[] = []
    /** Past the last cancel check: a cancel can no longer stop the run, so it must not relabel how it ends. */
    let committing = false
    let outcome: Partial<ExportProgress>
    try {
      try {
        const capturer = (job.capturer = this.opts.createCapturer())
        await writing(plan.outputDir, () => fs.promises.mkdir(plan.outputDir, { recursive: true }))
        // A cancel during the mkdir has already closed the capturer: do not open it after that.
        stopIfCancelled()
        await capturer.open()
        for (const [i, snapshot] of plan.snapshots.entries()) {
          stopIfCancelled()
          emit({ stage: 'rendering', episodeIndex: i, slice: 0, sliceCount: 0 })
          const layout = await capturer.render(snapshot, 30000 + 2000 * snapshot.panels.length)
          const slices = await writer.beginEpisode(i, layout)
          if (slices.length === 0) throw new Error(`Episode ${snapshot.episode.number} drew nothing to export`)
          for (const [k, slice] of slices.entries()) {
            stopIfCancelled()
            emit({ stage: 'capturing', slice: k + 1, sliceCount: slices.length })
            await writer.addSlice(slice, await capturer.capture(slice, writer.capture.scale, writer.capture.format))
          }
          emit({ stage: 'writing' })
          await writer.endEpisode()
        }
        await writer.finish()
        // The last chance to stop: past here the outputs replace what was there.
        stopIfCancelled()
        committing = true
        await this.commit(writer, parts, committed)
        outcome = { stage: 'done', outputs: committed }
      } finally {
        await this.closeCapturer(job)
      }
    } catch (error) {
      await writer.abort()
      await parts.removeAll()
      // A cancel closes the capturer, so the render or capture it interrupted rejects: that is still a cancel.
      outcome =
        error instanceof Cancelled || (job.cancelled && !committing)
          ? { stage: 'cancelled' }
          : { stage: 'failed', message: error instanceof Error ? error.message : String(error), outputs: committed }
    }
    this.ended.set(job.id, outcome.outputs ?? [])
    this.job = null
    emit(outcome)
  }

  /**
   * Put each output in place, one at a time: trash what it replaces, then rename its part. An output is never left
   * with its old file trashed and its new one deleted because a later output failed; each one placed is added to
   * `committed`. A rename a scanner briefly blocks is retried. If it still fails after the old output was trashed,
   * the part is kept (not removed with the others) and the error names it, so the new export can be recovered.
   */
  private async commit(writer: PresetWriter, parts: PartFiles, committed: string[]): Promise<void> {
    for (const { part, final } of writer.outputs) {
      await writing(final, async () => {
        const replacing = await exists(final)
        if (replacing) await this.opts.trash(final)
        try {
          await renameWithRetry(fs.promises, part, final, COMMIT_RETRYABLE)
        } catch (error) {
          if (!replacing) throw error
          parts.release(part)
          throw new WriteError(`Could not write ${final}: ${osReason(error)}. The old one is in the trash, and the new one is kept at ${part}`, { cause: error })
        }
      })
      parts.release(part)
      committed.push(final)
    }
  }
}

/** The extension of each output file; none for a webtoon folder. */
function extension(req: ExportRequest): string {
  switch (req.preset) {
    case 'webtoon':
      return ''
    case 'long-image':
      return req.imageType === 'png' ? '.png' : '.jpg'
    case 'pdf-reading':
    case 'pdf-print':
      return '.pdf'
    case 'cbz':
      return '.cbz'
  }
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)]
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.promises.lstat(p)
    return true
  } catch (error) {
    if (isNotFound(error)) return false
    throw error
  }
}
