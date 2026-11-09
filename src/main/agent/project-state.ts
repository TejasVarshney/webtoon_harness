import type { Services } from '../services'
import type { ProjectContext } from '../storage/project-store'
import { buildStateSnapshot, type StateSnapshotInput } from './system-prompt'

/** How many of the current episode's final panels the state snapshot summarizes. */
const RECENT_PANELS = 3

/**
 * What the state snapshot is built from. The current episode is the one the app has open (`activeEpisodeId`),
 * or the first episode when that id is absent or no longer exists: a stale id from the renderer must not fail a run.
 */
async function gatherProjectState(services: Services, ctx: ProjectContext, activeEpisodeId: string | null): Promise<StateSnapshotInput> {
  // Archived characters are included on purpose: the snapshot drops them from the roster but still uses them to name panel speakers.
  const characters = await services.characters.list(ctx, { includeArchived: true })
  // Archived items too, for the same reason: they still name the items of existing panels.
  const items = await services.items.list(ctx, { includeArchived: true })
  const locations = await services.locations.list(ctx, { includeArchived: true })
  const episodes = await services.episodes.list(ctx)
  const episode = episodes.find((e) => e.id === activeEpisodeId) ?? episodes[0] ?? null
  const recentPanels = episode ? (await services.panels.list(ctx, episode.id)).slice(-RECENT_PANELS) : []
  return { meta: await services.projects.getMeta(ctx), characters, items, locations, episode, recentPanels }
}

/** The `<project_state>` text the agent starts each turn from. */
export async function projectStateText(services: Services, ctx: ProjectContext, activeEpisodeId: string | null): Promise<string> {
  return buildStateSnapshot(await gatherProjectState(services, ctx, activeEpisodeId))
}
