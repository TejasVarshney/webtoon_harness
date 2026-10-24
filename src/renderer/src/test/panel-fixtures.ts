import type { Episode, Panel, PanelVersion } from '@shared/types'

export const EPISODE_ID = 'epi_0000000001'
const T = '2026-10-21T10:00:00.000Z'

/** A ready version whose image lives at `panels/<panelId>/<id>.png`. */
export function panelVersion(o: Partial<PanelVersion> = {}): PanelVersion {
  const id = o.id ?? 'ver_0000000001'
  return {
    id,
    source: 'generate',
    status: 'ready',
    error: null,
    imagePath: `panels/pnl_0000000001/${id}.png`,
    prompt: 'prompt',
    referenceImagePaths: [],
    instruction: null,
    parentVersionId: null,
    check: null,
    createdAt: T,
    ...o
  }
}

/** A panel with one ready, current version. Pass `versions: []` (and `currentVersionId: null`) for a panel without an image. */
export function panel(o: Partial<Panel> = {}): Panel {
  const version = panelVersion()
  return {
    id: 'pnl_0000000001',
    episodeId: EPISODE_ID,
    description: 'Mina stands on the rooftop.',
    setting: 'Rooftop at dusk',
    shot: 'medium',
    aspect: '2:3',
    characters: [],
    dialogue: [],
    continuityNotes: '',
    offPanelMentions: [],
    versions: [version],
    currentVersionId: version.id,
    createdBy: 'user',
    createdAt: T,
    updatedAt: T,
    ...o
  }
}

export function episode(o: Partial<Episode> = {}): Episode {
  return { id: EPISODE_ID, number: 1, title: 'Episode 1', synopsis: '', panelIds: [], createdAt: T, updatedAt: T, ...o }
}
