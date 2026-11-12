import { afterEach, describe, expect, it } from 'vitest'
import type { AppEvent, Panel, PanelDraft, StripLayout } from '@shared/types'
import type { ProjectContext } from '../storage/project-store'
import { testServices, type TestServices } from '../test/test-services'
import { EntityNotFoundError } from './errors'

// Moving panels answers the layouts read and written, and undo puts one back with `restoreLayout`.

let services: TestServices | undefined
afterEach(async () => {
  await services?.cleanup()
  services = undefined
})

const USER = { createdBy: 'user' as const, strictMentions: false, strictSheets: false }

async function setup(count = 3) {
  const s = await testServices()
  services = s
  const ctx: ProjectContext = await s.projects.create({ title: 'Moon Diary' })
  const [episode] = await s.episodes.list(ctx)
  const draft: PanelDraft = { episodeId: episode.id, description: 'A door opens.', setting: 'Hallway', shot: 'medium', characters: [], dialogue: [] }
  const made: Panel[] = []
  for (let i = 0; i < count; i++) made.push((await s.panels.create(ctx, draft, USER)).panel)
  const events: AppEvent[] = []
  s.bus.subscribe((e) => events.push(e))
  /** What is on disk now, in the shape `place` answers. */
  const onDisk = async (): Promise<StripLayout> => {
    const order = (await s.episodes.get(ctx, episode.id)).panelIds
    const panels = await s.panels.list(ctx, episode.id)
    return { order, placements: Object.fromEntries(panels.map((p) => [p.id, p.placement])) }
  }
  return { s, ctx, episodeId: episode.id, ids: made.map((p) => p.id), events, onDisk }
}

describe('PanelService.place and restoreLayout', () => {
  it('place answers the layout it read and the one it wrote', async () => {
    const { s, ctx, episodeId, ids, onDisk } = await setup()
    const before = await onDisk()
    const answer = await s.panels.place(ctx, episodeId, [{ panelId: ids[0], placement: { x: 0, y: 5000, width: 100 } }])
    expect(answer.before).toEqual(before)
    expect(answer.before.placements).toEqual({ [ids[0]]: null, [ids[1]]: null, [ids[2]]: null })
    expect(answer.after).toEqual(await onDisk())
    expect(answer.after.order).toEqual([ids[1], ids[2], ids[0]])
    expect(answer.after.placements[ids[0]]).toEqual({ x: 0, y: 5000, width: 100 })
  })

  it('restoreLayout puts back the null placements and the old order, and announces it once', async () => {
    const { s, ctx, episodeId, ids, events, onDisk } = await setup()
    const { before } = await s.panels.place(ctx, episodeId, [{ panelId: ids[0], placement: { x: 0, y: 5000, width: 100 } }])
    events.length = 0
    await s.panels.restoreLayout(ctx, episodeId, before)
    expect(await onDisk()).toEqual(before)
    expect(events.filter((e) => e.type === 'panel.changed')).toHaveLength(1)
    // And back again: the layout written is restored as exactly.
    const { after } = await s.panels.place(ctx, episodeId, [{ panelId: ids[0], placement: { x: 0, y: 5000, width: 100 } }])
    await s.panels.restoreLayout(ctx, episodeId, before)
    await s.panels.restoreLayout(ctx, episodeId, after)
    expect(await onDisk()).toEqual(after)
  })

  it('refuses a layout whose order is not exactly the episode panels, and writes nothing', async () => {
    const { s, ctx, episodeId, ids, onDisk } = await setup()
    const { before } = await s.panels.place(ctx, episodeId, [{ panelId: ids[0], placement: { x: 0, y: 5000, width: 100 } }])
    const now = await onDisk()
    const wrong: StripLayout[] = [
      { ...before, order: before.order.slice(1) },
      { ...before, order: [...before.order, 'pnl_ffffffffff'] },
      { ...before, order: [ids[0], ids[0], ids[1]] }
    ]
    for (const layout of wrong) await expect(s.panels.restoreLayout(ctx, episodeId, layout)).rejects.toThrow(/added or removed/)
    expect(await onDisk()).toEqual(now)
  })

  it('refuses a placement for a panel of another episode, and writes nothing', async () => {
    const { s, ctx, episodeId, ids, onDisk } = await setup()
    const other = await s.episodes.create(ctx, { title: 'Two' })
    const elsewhere = (await s.panels.create(ctx, { episodeId: other.id, description: 'Far', setting: 'Away', shot: 'wide', characters: [], dialogue: [] }, USER)).panel
    const now = await onDisk()
    const layout: StripLayout = { order: now.order, placements: { [ids[0]]: { x: 0, y: 0, width: 100 }, [elsewhere.id]: null } }
    await expect(s.panels.restoreLayout(ctx, episodeId, layout)).rejects.toBeInstanceOf(EntityNotFoundError)
    expect(await onDisk()).toEqual(now)
    expect((await s.panels.get(ctx, elsewhere.id)).placement).toBeNull()
  })

  it('runs in turn with place: a restore queued after a move lands after it, and a move queued after a restore plans from it', async () => {
    const { s, ctx, episodeId, ids, onDisk } = await setup()
    const first = await s.panels.place(ctx, episodeId, [{ panelId: ids[0], placement: { x: 0, y: 5000, width: 100 } }])
    // A move and the undo of the move before it, sent together: the undo must not interleave with the move's writes.
    const moving = s.panels.place(ctx, episodeId, [{ panelId: ids[1], placement: { x: 200, y: 6000, width: 100 } }])
    const restoring = s.panels.restoreLayout(ctx, episodeId, first.before)
    await Promise.all([moving, restoring])
    expect(await onDisk()).toEqual(first.before)
    // The other way round: the move plans from the restored, flowing strip and freezes it afresh.
    const restored = s.panels.restoreLayout(ctx, episodeId, first.after)
    const moved = s.panels.place(ctx, episodeId, [{ panelId: ids[2], placement: { x: 0, y: 9000, width: 100 } }])
    const [, answer] = await Promise.all([restored, moved])
    expect(answer.before).toEqual(first.after)
    expect(await onDisk()).toEqual(answer.after)
  })
})
