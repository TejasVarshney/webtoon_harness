import { z } from 'zod'
import { BeatPatchSchema, StoryModeSchema } from '@shared/schemas'
import type { Services } from '../../services'
import type { HandlerMap } from './projects'

/** The story bible, the beats and the story mode. The renderer's input is parsed here; the service trusts its callers. */
export function storyHandlers(s: Services): HandlerMap {
  const { story } = s
  return {
    'story:get': async ({ projectId, episodeId }) => story.get(await s.projects.open(projectId), episodeId),
    'story:setMode': async ({ projectId, mode }) => story.setMode(await s.projects.open(projectId), StoryModeSchema.parse(mode)),
    'story:updateBible': async ({ projectId, markdown }) => story.replaceBible(await s.projects.open(projectId), z.string().parse(markdown)),
    'story:updateBeat': async ({ projectId, beatId, patch }) => story.updateBeat(await s.projects.open(projectId), beatId, BeatPatchSchema.parse(patch))
  }
}
