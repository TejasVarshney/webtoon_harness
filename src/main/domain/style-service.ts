import type { StyleUsage } from '@shared/ipc'
import type { ProjectMeta } from '@shared/types'
import type { ProjectContext, ProjectStore } from '../storage/project-store'
import type { CharacterService } from './character-service'
import type { EpisodeService } from './episode-service'
import type { ItemService } from './item-service'
import type { LocationService } from './location-service'
import type { PanelService } from './panel-service'
import { normalizeStyleText } from './style-text'

const DRAWN = new Set(['ready', 'pending'])
const isDrawn = (image: { status: string }): boolean => DRAWN.has(image.status)

/** A project's art style: what it has drawn in the current one, and changing it. */
export class StyleService {
  constructor(
    private readonly deps: {
      projects: Pick<ProjectStore, 'updateMeta'>
      characters: Pick<CharacterService, 'list'>
      items: Pick<ItemService, 'list'>
      locations: Pick<LocationService, 'list'>
      episodes: Pick<EpisodeService, 'list'>
      panels: Pick<PanelService, 'list'>
    }
  ) {}

  /** The art made or being made in the project's style, archived entities included (their sheets still draw existing panels). A failed image drew nothing. */
  async usage(ctx: ProjectContext): Promise<StyleUsage> {
    const { characters, items, locations, episodes, panels } = this.deps
    const all = { includeArchived: true }
    const [cast, props, places, eps] = await Promise.all([characters.list(ctx, all), items.list(ctx, all), locations.list(ctx, all), episodes.list(ctx)])
    const sheets = [...cast.flatMap((c) => c.variations), ...props.flatMap((i) => i.usages), ...places.flatMap((l) => l.states)]
    const perEpisode = await Promise.all(eps.map((e) => panels.list(ctx, e.id)))
    return { sheets: sheets.filter(isDrawn).length, panels: perEpisode.flat().filter((p) => p.versions.some(isDrawn)).length }
  }

  /** Saves `text` as the project's style. Whether it may change now is the caller's to decide. */
  async apply(ctx: ProjectContext, text: string): Promise<ProjectMeta> {
    return this.deps.projects.updateMeta(ctx, { stylePreset: normalizeStyleText(text) })
  }
}
