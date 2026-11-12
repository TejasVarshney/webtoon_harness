import { PanelSchema } from '@shared/schemas'
import type { Panel, PanelPlacement, StripLayout } from '@shared/types'
import { writeJsonAtomic } from '../storage/atomic'
import type { ProjectContext } from '../storage/project-store'
import type { EpisodeService } from './episode-service'
import { EntityNotFoundError } from './errors'
import { getPanel, tryReadPanel } from './panel-files'
import { planPlacement } from './panel-placement'
import type { EmitPanelChanged } from './panel-recording'
import { now } from './records'

type Move = { panelId: string; placement: PanelPlacement }

function samePlacement(a: PanelPlacement | null, b: PanelPlacement | null): boolean {
  return a === null || b === null ? a === b : a.x === b.x && a.y === b.y && a.width === b.width
}

/**
 * Where panels sit on the strip: a move (`place`) and putting back a layout read before (`restoreLayout`, what undo uses).
 * Calls for one episode run one after another, each from what the one before wrote, so a second drag never plans from a
 * half-frozen list and an undo never lands in the middle of a move. The queue is in memory, and each call writes one
 * panel at a time under its own lock, then the episode's order under the episode's: no panel lock is ever held together
 * with an episode's. The change is announced once, at the end.
 */
export class PanelPlacer {
  /** The calls of each episode, as the promise of the last one queued. */
  private readonly placing = new Map<string, Promise<void>>()

  constructor(private readonly opts: { episodes: Pick<EpisodeService, 'get' | 'setPanelOrder'>; emit: EmitPanelChanged }) {}

  /**
   * Saves `moves` (see `planPlacement`) and answers the layout it read and the one it wrote. The panels that were not
   * moved are written first and the moved ones last, so a reader sees the old picture of the strip until they land.
   */
  place(ctx: ProjectContext, episodeId: string, moves: Move[]): Promise<{ before: StripLayout; after: StripLayout }> {
    return this.inTurn(ctx, episodeId, () => this.placeNow(ctx, episodeId, moves))
  }

  /**
   * Writes each panel's placement as `layout` gives it, `null` included (the panel flows again), then the episode's order.
   * Refuses a layout whose `order` is not exactly the episode's panels, in any order, and a placement for a panel that is
   * not one of them. Nothing is written when it refuses.
   */
  restoreLayout(ctx: ProjectContext, episodeId: string, layout: StripLayout): Promise<void> {
    return this.inTurn(ctx, episodeId, () => this.restoreNow(ctx, episodeId, layout))
  }

  private inTurn<T>(ctx: ProjectContext, episodeId: string, work: () => Promise<T>): Promise<T> {
    const key = `${ctx.id}:${episodeId}`
    const run = (this.placing.get(key) ?? Promise.resolve()).catch(() => undefined).then(work)
    const tail = run.then(
      () => undefined,
      () => undefined
    )
    this.placing.set(key, tail)
    void tail.then(() => {
      if (this.placing.get(key) === tail) this.placing.delete(key)
    })
    return run
  }

  /** The episode's readable panels, and its layout: every panel id it holds, and the placement of each readable one. */
  private async read(ctx: ProjectContext, episodeId: string): Promise<{ panels: Panel[]; layout: StripLayout }> {
    const episode = await this.opts.episodes.get(ctx, episodeId)
    const panels: Panel[] = []
    for (const id of episode.panelIds) {
      const panel = await tryReadPanel(ctx, id)
      if (panel) panels.push(panel)
    }
    return { panels, layout: { order: [...episode.panelIds], placements: Object.fromEntries(panels.map((p) => [p.id, p.placement])) } }
  }

  private async placeNow(ctx: ProjectContext, episodeId: string, moves: Move[]): Promise<{ before: StripLayout; after: StripLayout }> {
    const { panels, layout: before } = await this.read(ctx, episodeId)
    const plan = planPlacement(panels, moves)
    const moved = new Set(moves.map((m) => m.panelId))
    const writes = [...plan.writes.filter((w) => !moved.has(w.panelId)), ...plan.writes.filter((w) => moved.has(w.panelId))]
    for (const write of writes) await this.write(ctx, write.panelId, write.placement)
    const episode = await this.opts.episodes.setPanelOrder(ctx, episodeId, plan.order)
    // The strip reloads the whole episode on any panel change, so one event covers every panel written.
    if (writes.length > 0) this.opts.emit(ctx, writes[writes.length - 1].panelId)
    const placements = { ...before.placements }
    for (const write of writes) placements[write.panelId] = write.placement
    return { before, after: { order: [...episode.panelIds], placements } }
  }

  private async restoreNow(ctx: ProjectContext, episodeId: string, layout: StripLayout): Promise<void> {
    const { panels, layout: current } = await this.read(ctx, episodeId)
    const order = new Set(layout.order)
    if (order.size !== layout.order.length || order.size !== current.order.length || current.order.some((id) => !order.has(id))) {
      throw new Error('That layout is not the panels this episode holds now: a panel was added or removed since')
    }
    for (const id of Object.keys(layout.placements)) {
      // A panel of another episode, or one this episode lists but cannot read, is not one this call may write.
      const panel = panels.find((p) => p.id === id)
      if (!order.has(id) || panel === undefined || panel.episodeId !== episodeId) throw new EntityNotFoundError('panel', id)
    }
    let last: string | null = null
    for (const [id, placement] of Object.entries(layout.placements)) {
      if (await this.write(ctx, id, placement)) last = id
    }
    await this.opts.episodes.setPanelOrder(ctx, episodeId, layout.order)
    const announced = last ?? layout.order[0]
    if (announced !== undefined) this.opts.emit(ctx, announced)
  }

  /** Stores one panel's placement under its lock; resolves to whether anything was written (an equal one is left alone). */
  private write(ctx: ProjectContext, panelId: string, placement: PanelPlacement | null): Promise<boolean> {
    const file = ctx.paths.panelFile(panelId)
    return ctx.mutex.run(file, async () => {
      const current = await getPanel(ctx, panelId)
      if (samePlacement(current.placement, placement)) return false
      await writeJsonAtomic(file, PanelSchema.parse({ ...current, placement, updatedAt: now() }))
      return true
    })
  }
}
