import { z } from 'zod'
import { BeatPatchSchema } from '@shared/schemas'
import { CorruptFileError, EntityNotFoundError, PathEscapeError } from '../../domain/errors'
import { checkedHeading, listSections } from '../../domain/markdown-sections'
import { ToolError, defineTool, type ToolContext, type ToolDefinition } from './registry'

const episodeId = z.string().describe('Episode id, e.g. epi_0123456789')

/** A model that passes a title or a mangled id gets the same answer as for an id that does not exist. */
async function requireEpisode(ctx: ToolContext, id: string): Promise<void> {
  try {
    await ctx.services.episodes.get(ctx.project, id)
  } catch (error) {
    if (error instanceof EntityNotFoundError || error instanceof PathEscapeError) throw new ToolError(`Unknown episode: ${id}`)
    throw error
  }
}

/** What the service rejected becomes a message for the model; the corrupt outline is named by its project-relative path. */
function asToolError(ctx: ToolContext, error: unknown): unknown {
  if (error instanceof EntityNotFoundError) return new ToolError(error.message)
  if (error instanceof CorruptFileError) {
    const rel = ctx.project.paths.toRelative(error.path)
    return new ToolError(`${rel} is unreadable and was left untouched, so nothing was saved. Tell the user it needs repairing; do not retry.`)
  }
  return error
}

const getStory = defineTool({
  name: 'get_story',
  description:
    'Read the story: the story mode (user = the user leads, ai = you lead), the story bible as markdown (## sections), and the beat outline. ' +
    'Pass episodeId to see only the beats of that episode; leave it out for all beats. Read it before planning anything.',
  input: z.object({ episodeId: episodeId.optional() }),
  handler: async ({ episodeId }, ctx) => {
    if (episodeId !== undefined) await requireEpisode(ctx, episodeId)
    return { content: await ctx.services.story.get(ctx.project, episodeId) }
  }
})

const updateStoryBible = defineTool({
  name: 'update_story_bible',
  description:
    'Replace the text of one section of the story bible, or add the section when it does not exist. ' +
    'The default sections are Premise, World, Tone, Characters & Relationships, Arcs and Open Threads. ' +
    'The content replaces the whole section body, so include what should stay: read it with get_story first. ' +
    'Do not put "## " headings in the content; use "### " for sub-headings.',
  input: z.object({
    section: z.string().min(1).describe('Section name, e.g. "Arcs"; matched case-insensitively'),
    content: z.string().describe('The new markdown body of the section')
  }),
  handler: async ({ section, content }, ctx) => {
    // A section name or content the service refuses comes back to the model as its plain message.
    const bible = await ctx.services.story.updateBibleSection(ctx.project, section, content)
    return { content: { section: checkedHeading(section), sections: listSections(bible) } }
  }
})

const addBeats = defineTool({
  name: 'add_beats',
  description:
    'Plan story beats for an episode: one short sentence each, in story order. They start as "planned". ' +
    'Mark a beat "drawn" with update_beat once its panels exist. The result carries the new beat ids.',
  input: z.object({ episodeId, beats: z.array(z.string().min(1)).min(1).describe('One sentence per beat') }),
  handler: async ({ episodeId, beats }, ctx) => {
    await requireEpisode(ctx, episodeId)
    try {
      return { content: { beats: await ctx.services.story.addBeats(ctx.project, episodeId, beats) } }
    } catch (error) {
      throw asToolError(ctx, error)
    }
  }
})

const updateBeat = defineTool({
  name: 'update_beat',
  description: 'Change a beat: set its status (planned, drawn or dropped) and/or reword its summary. Beat ids come from get_story and add_beats.',
  input: BeatPatchSchema.extend({ beatId: z.string().describe('Beat id, e.g. bt_0123456789') }),
  handler: async ({ beatId, status, summary }, ctx) => {
    if (status === undefined && summary === undefined) throw new ToolError('Nothing to change: pass status or summary')
    try {
      return { content: { beat: await ctx.services.story.updateBeat(ctx.project, beatId, { status, summary }) } }
    } catch (error) {
      throw asToolError(ctx, error)
    }
  }
})

export const storyTools: ToolDefinition[] = [getStory, updateStoryBible, addBeats, updateBeat]
