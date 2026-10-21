import fs from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { tempProject, type TempProject } from '../test/temp-project'
import { writeJsonAtomic } from '../storage/atomic'
import { makeEpisode } from '../test/factories'
import { EntityNotFoundError } from './errors'
import { EpisodeService } from './episode-service'

let tp: TempProject | undefined
afterEach(async () => {
  await tp?.cleanup()
  tp = undefined
})

async function setup() {
  const t = await tempProject()
  tp = t
  const svc = new EpisodeService({ bus: t.bus })
  t.events.length = 0
  return { svc, ctx: t.ctx, events: t.events }
}

describe('EpisodeService', () => {
  it('creates Episode 1 on first list and announces it', async () => {
    const { svc, ctx, events } = await setup()
    const list = await svc.list(ctx)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ number: 1, title: 'Episode 1', synopsis: '', panelIds: [] })
    expect(list[0].id).toMatch(/^epi_[0-9a-f]{10}$/)
    expect(events).toContainEqual({ type: 'episode.changed', projectId: ctx.id, episodeId: list[0].id })
    expect((await svc.list(ctx)).map((e) => e.id)).toEqual([list[0].id])
  })

  it('never creates two Episode 1s when lists race', async () => {
    const { svc, ctx } = await setup()
    await Promise.all([svc.list(ctx), svc.list(ctx), svc.list(ctx)])
    expect(await svc.list(ctx)).toHaveLength(1)
  })

  it('never creates two Episode 1s when a list races a create', async () => {
    const { svc, ctx } = await setup()
    const [, created] = await Promise.all([svc.list(ctx), svc.create(ctx, { title: 'Pilot' })])
    const all = await svc.list(ctx)
    const numbers = all.map((e) => e.number)
    expect(new Set(numbers).size).toBe(numbers.length)
    expect(all.map((e) => e.id)).toContain(created.id)
  })

  it('create takes the next number; concurrent creates get distinct numbers', async () => {
    const { svc, ctx } = await setup()
    await svc.list(ctx)
    const two = await svc.create(ctx, { title: 'The Fall', synopsis: 'Mina falls.' })
    expect(two).toMatchObject({ number: 2, title: 'The Fall', synopsis: 'Mina falls.', panelIds: [] })
    const [a, b] = await Promise.all([svc.create(ctx, { title: 'A' }), svc.create(ctx, { title: 'B' })])
    expect([a.number, b.number].sort()).toEqual([3, 4])
    expect((await svc.list(ctx)).map((e) => e.number)).toEqual([1, 2, 3, 4])
  })

  it('lists in number order whatever the file names', async () => {
    const { svc, ctx } = await setup()
    await writeJsonAtomic(ctx.paths.episodeFile('epi_aaaaaaaaaa'), makeEpisode({ id: 'epi_aaaaaaaaaa', number: 2, title: 'Two' }))
    await writeJsonAtomic(ctx.paths.episodeFile('epi_bbbbbbbbbb'), makeEpisode({ id: 'epi_bbbbbbbbbb', number: 1, title: 'One' }))
    expect((await svc.list(ctx)).map((e) => e.title)).toEqual(['One', 'Two'])
  })

  it('gets an episode or throws EntityNotFoundError', async () => {
    const { svc, ctx } = await setup()
    const [first] = await svc.list(ctx)
    expect(await svc.get(ctx, first.id)).toEqual(first)
    await expect(svc.get(ctx, 'epi_ffffffffff')).rejects.toBeInstanceOf(EntityNotFoundError)
    await expect(svc.get(ctx, 'epi_ffffffffff')).rejects.toThrow('Unknown episode: epi_ffffffffff')
  })

  it('update changes only the named fields and announces it', async () => {
    const { svc, ctx, events } = await setup()
    const [first] = await svc.list(ctx)
    events.length = 0
    const renamed = await svc.update(ctx, first.id, { title: 'Pilot' })
    expect(renamed).toMatchObject({ title: 'Pilot', synopsis: '' })
    const again = await svc.update(ctx, first.id, { synopsis: 'It begins.' })
    expect(again).toMatchObject({ title: 'Pilot', synopsis: 'It begins.', number: 1 })
    expect(await svc.get(ctx, first.id)).toEqual(again)
    expect(events.filter((e) => e.type === 'episode.changed')).toHaveLength(2)
    await expect(svc.update(ctx, 'epi_ffffffffff', { title: 'x' })).rejects.toBeInstanceOf(EntityNotFoundError)
  })

  it('inserts panels: undefined appends, null goes first, an id goes after that panel', async () => {
    const { svc, ctx, events } = await setup()
    const [ep] = await svc.list(ctx)
    await svc.insertPanel(ctx, ep.id, 'pnl_0000000001', undefined)
    await svc.insertPanel(ctx, ep.id, 'pnl_0000000002', undefined)
    await svc.insertPanel(ctx, ep.id, 'pnl_0000000003', 'pnl_0000000001')
    expect((await svc.get(ctx, ep.id)).panelIds).toEqual(['pnl_0000000001', 'pnl_0000000003', 'pnl_0000000002'])
    events.length = 0
    const out = await svc.insertPanel(ctx, ep.id, 'pnl_0000000004', null)
    expect(out.panelIds).toEqual(['pnl_0000000004', 'pnl_0000000001', 'pnl_0000000003', 'pnl_0000000002'])
    expect(events).toEqual([{ type: 'episode.changed', projectId: ctx.id, episodeId: ep.id }])
  })

  it('refuses an unknown anchor panel, a duplicate panel and an unknown episode without writing', async () => {
    const { svc, ctx } = await setup()
    const [ep] = await svc.list(ctx)
    await svc.insertPanel(ctx, ep.id, 'pnl_0000000001', undefined)
    await expect(svc.insertPanel(ctx, ep.id, 'pnl_0000000002', 'pnl_ffffffffff')).rejects.toThrow('Unknown panel: pnl_ffffffffff')
    await expect(svc.insertPanel(ctx, ep.id, 'pnl_0000000001', undefined)).rejects.toThrow(/already/i)
    await expect(svc.insertPanel(ctx, 'epi_ffffffffff', 'pnl_0000000002', undefined)).rejects.toBeInstanceOf(EntityNotFoundError)
    expect((await svc.get(ctx, ep.id)).panelIds).toEqual(['pnl_0000000001'])
  })

  it('concurrent inserts lose no panel', async () => {
    const { svc, ctx } = await setup()
    const [ep] = await svc.list(ctx)
    const ids = Array.from({ length: 8 }, (_, i) => `pnl_00000000${i}0`)
    await Promise.all(ids.map((id) => svc.insertPanel(ctx, ep.id, id, undefined)))
    expect((await svc.get(ctx, ep.id)).panelIds.sort()).toEqual([...ids].sort())
  })

  it('removes a panel; removing an absent panel changes and announces nothing', async () => {
    const { svc, ctx, events } = await setup()
    const [ep] = await svc.list(ctx)
    await svc.insertPanel(ctx, ep.id, 'pnl_0000000001', undefined)
    await svc.insertPanel(ctx, ep.id, 'pnl_0000000002', undefined)
    events.length = 0
    expect((await svc.removePanel(ctx, ep.id, 'pnl_0000000001')).panelIds).toEqual(['pnl_0000000002'])
    expect(events).toHaveLength(1)
    events.length = 0
    expect((await svc.removePanel(ctx, ep.id, 'pnl_0000000001')).panelIds).toEqual(['pnl_0000000002'])
    expect(events).toEqual([])
  })

  it('moves a panel to an index, clamping out-of-range targets', async () => {
    const { svc, ctx } = await setup()
    const [ep] = await svc.list(ctx)
    for (const n of [1, 2, 3, 4]) await svc.insertPanel(ctx, ep.id, `pnl_000000000${n}`, undefined)
    const order = async () => (await svc.get(ctx, ep.id)).panelIds.map((id) => id.slice(-1))
    await svc.movePanel(ctx, ep.id, 'pnl_0000000004', 0)
    expect(await order()).toEqual(['4', '1', '2', '3'])
    await svc.movePanel(ctx, ep.id, 'pnl_0000000004', 2)
    expect(await order()).toEqual(['1', '2', '4', '3'])
    await svc.movePanel(ctx, ep.id, 'pnl_0000000001', 99)
    expect(await order()).toEqual(['2', '4', '3', '1'])
    await svc.movePanel(ctx, ep.id, 'pnl_0000000001', -5)
    expect(await order()).toEqual(['1', '2', '4', '3'])
    await expect(svc.movePanel(ctx, ep.id, 'pnl_ffffffffff', 0)).rejects.toThrow('Unknown panel: pnl_ffffffffff')
  })

  it('skips and reports a corrupt episode file (Review Focus 5)', async () => {
    const { svc, ctx } = await setup()
    const [ep] = await svc.list(ctx)
    await fs.promises.writeFile(ctx.paths.episodeFile('epi_ffffffffff'), '{oops')
    expect((await svc.list(ctx)).map((e) => e.id)).toEqual([ep.id])
    expect(ctx.problems.map((p) => p.path)).toEqual(['episodes/epi_ffffffffff.json'])
    await svc.list(ctx)
    expect(ctx.problems).toHaveLength(1)
  })

  it('does not invent an Episode 1 beside an unreadable episode file', async () => {
    const { svc, ctx } = await setup()
    await fs.promises.writeFile(ctx.paths.episodeFile('epi_ffffffffff'), '{oops')
    expect(await svc.list(ctx)).toEqual([])
    expect(ctx.problems.map((p) => p.path)).toEqual(['episodes/epi_ffffffffff.json'])
    expect(fs.readdirSync(ctx.paths.episodesDir())).toEqual(['epi_ffffffffff.json'])
  })
})
