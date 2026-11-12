import { z } from 'zod'
import { BeatPatchSchema } from '@shared/schemas'
import type { Services } from '../../services'
import type { HandlerMap } from './projects'

/** The story bible, and the beats. The renderer's input is parsed here; the service trusts its callers. */
export function storyHandlers(s: Services): HandlerMap {
  const { story } = s
  return {
    'story:get': async ({ projectId, episodeId }) => story.get(await s.projects.open(projectId), episodeId),
    'story:updateBible': async ({ projectId, markdown }) => story.replaceBible(await s.projects.open(projectId), z.string().parse(markdown)),
    'story:updateBeat': async ({ projectId, beatId, patch }) => story.updateBeat(await s.projects.open(projectId), beatId, BeatPatchSchema.parse(patch))
  }
}
