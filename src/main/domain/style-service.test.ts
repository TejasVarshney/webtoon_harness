import { describe, expect, it, vi } from 'vitest'
import type { Character, Episode, Item, Location, Panel, PanelVersion } from '@shared/types'
import { PanelVersionSchema } from '@shared/schemas'
import type { ProjectContext } from '../storage/project-store'
import { makeCharacter, makeEpisode, makeItem, makeItemUsage, makeLocation, makeLocationState, makePanel, makeVariation } from '../test/factories'
import { StyleService } from './style-service'

const ctx = {} as ProjectContext
type Status = PanelVersion['status']

const version = (status: Status, n = 1): PanelVersion =>
  PanelVersionSchema.parse({ id: `ver_000000000${n}`, source: 'generate', status, error: null, imagePath: null, prompt: '', check: null, createdAt: '2026-01-01T00:00:00.000Z' })

function setup(data: { characters?: Character[]; items?: Item[]; locations?: Location[]; episodes?: Episode[]; panels?: Record<string, Panel[]> }) {
  const characters = { list: vi.fn(async () => data.characters ?? []) }
  const items = { list: vi.fn(async () => data.items ?? []) }
  const locations = { list: vi.fn(async () => data.locations ?? []) }
  const updateMeta = vi.fn(async (_ctx: ProjectContext, patch: { stylePreset?: string }) => patch as never)
  const service = new StyleService({
    projects: { updateMeta },
    characters,
    items,
    locations,
    episodes: { list: async () => data.episodes ?? [] },
    panels: { list: async (_ctx: ProjectContext, episodeId: string) => data.panels?.[episodeId] ?? [] }
  })
  return { service, characters, items, locations, updateMeta }
}

const failedCharacter = makeCharacter({ variations: [makeVariation({ status: 'failed' })] })
const failedItem = makeItem({ usages: [makeItemUsage({ status: 'failed' })] })
const failedLocation = makeLocation({ states: [makeLocationState({ status: 'failed' })] })

describe('StyleService.usage', () => {
  it('is zero for an empty project', async () => {
    expect(await setup({}).service.usage(ctx)).toEqual({ sheets: 0, panels: 0 })
  })

  it('counts ready and pending sheets of each kind', async () => {
    const { service } = setup({
      characters: [makeCharacter({ variations: [makeVariation({ status: 'ready' })] })],
      items: [makeItem({ usages: [makeItemUsage({ status: 'pending' })] })],
      locations: [makeLocation({ states: [makeLocationState({ status: 'ready' })] })]
    })
    expect(await service.usage(ctx)).toEqual({ sheets: 3, panels: 0 })
  })

  it('ignores failed sheets and failed panel versions', async () => {
    const { service } = setup({
      characters: [failedCharacter],
      items: [failedItem],
      locations: [failedLocation],
      episodes: [makeEpisode()],
      panels: { epi_0000000001: [makePanel({ versions: [version('failed')] })] }
    })
    expect(await service.usage(ctx)).toEqual({ sheets: 0, panels: 0 })
  })

  it('counts a panel once however many versions it has', async () => {
    const { service } = setup({ episodes: [makeEpisode()], panels: { epi_0000000001: [makePanel({ versions: [version('ready', 1), version('ready', 2)] })] } })
    expect(await service.usage(ctx)).toEqual({ sheets: 0, panels: 1 })
  })

  it('counts a panel with a pending version', async () => {
    const { service } = setup({ episodes: [makeEpisode()], panels: { epi_0000000001: [makePanel({ versions: [version('failed', 1), version('pending', 2)] })] } })
    expect(await service.usage(ctx)).toEqual({ sheets: 0, panels: 1 })
  })

  it('counts archived characters, items and locations', async () => {
    const { service, characters, items, locations } = setup({})
    await service.usage(ctx)
    for (const list of [characters.list, items.list, locations.list]) expect(list).toHaveBeenCalledWith(ctx, { includeArchived: true })
  })

  it('counts panels across all episodes', async () => {
    const { service } = setup({
      episodes: [makeEpisode({ id: 'epi_0000000001' }), makeEpisode({ id: 'epi_0000000002', number: 2 })],
      panels: { epi_0000000001: [makePanel({ versions: [version('ready')] })], epi_0000000002: [makePanel({ id: 'pnl_0000000002', versions: [version('ready')] })] }
    })
    expect(await service.usage(ctx)).toEqual({ sheets: 0, panels: 2 })
  })
})

describe('StyleService.apply', () => {
  it('saves the normalized text', async () => {
    const { service, updateMeta } = setup({})
    await service.apply(ctx, 'Ink wash.\n')
    expect(updateMeta).toHaveBeenCalledWith(ctx, { stylePreset: 'Ink wash' })
  })

  it('saves nothing for text the rules refuse', async () => {
    const { service, updateMeta } = setup({})
    await expect(service.apply(ctx, 'with speech bubbles')).rejects.toThrow('A style describes how the art looks.')
    expect(updateMeta).not.toHaveBeenCalled()
  })
})
