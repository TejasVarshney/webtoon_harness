import { z } from 'zod'
import { PanelCharacterSchema, PanelDraftSchema, PanelPatchSchema } from '@shared/schemas'
import type { Episode, Panel, PanelVersion } from '@shared/types'
import { EntityNotFoundError, PathEscapeError } from '../../domain/errors'
import { PanelValidationError } from '../../domain/panel-service'
import { ToolError, defineTool, type ToolContext, type ToolDefinition, type ToolOutput } from './registry'

const DEFAULT_LAST = 5

const panelId = z.string().describe('Panel id, e.g. pnl_0123456789')
const episodeId = z.string().describe('Episode id, e.g. epi_0123456789')

type Kind = 'episode' | 'panel'

/** A model that passes a title or a mangled id gets the same answer as for an id that does not exist. */
async function lookup<T>(kind: Kind, id: string, find: () => Promise<T>): Promise<T> {
  try {
    return await find()
  } catch (error) {
    if (error instanceof EntityNotFoundError || error instanceof PathEscapeError) throw new ToolError(`Unknown ${kind}: ${id}`)
    throw error
  }
}

const loadEpisode = (ctx: ToolContext, id: string): Promise<Episode> => lookup('episode', id, () => ctx.services.episodes.get(ctx.project, id))
const loadPanel = (ctx: ToolContext, id: string): Promise<Panel> => lookup('panel', id, () => ctx.services.panels.get(ctx.project, id))

/** What the service rejected becomes a message for the model: validation issues one per line, a missing anchor by its `Unknown <kind>` wording. */
function asToolError(error: unknown): unknown {
  if (error instanceof PanelValidationError) return new ToolError(error.issues.join('\n'))
  if (error instanceof EntityNotFoundError) return new ToolError(error.message)
  return error
}

/** The outcome of an image attempt. A `failed` status is a result for the model to read, not a thrown error. */
function versionOutcome(panelId: string, v: PanelVersion, warnings: string[] = []): ToolOutput {
  return {
    content: { panelId, versionId: v.id, status: v.status, error: v.error, imagePath: v.imagePath, warnings, check: v.check },
    images: v.status === 'ready' && v.imagePath !== null ? [v.imagePath] : []
  }
}

function currentVersion(panel: Panel): PanelVersion | undefined {
  return panel.versions.find((v) => v.id === panel.currentVersionId)
}

/** The current version as the model sees it in a listing, or null while the panel has no ready image. */
function versionBrief(panel: Panel): { id: string; status: PanelVersion['status']; imagePath: string | null } | null {
  const v = currentVersion(panel)
  return v ? { id: v.id, status: v.status, imagePath: v.imagePath } : null
}

const episodeSummary = (e: Episode) => ({ id: e.id, number: e.number, title: e.title, synopsis: e.synopsis, panelCount: e.panelIds.length })

const listEpisodes = defineTool({
  name: 'list_episodes',
  description: 'List the episodes in order with their ids, numbers, titles, synopses and panel counts. Use it to look up an episode id.',
  input: z.object({}),
  handler: async (_input, ctx) => ({ content: { episodes: (await ctx.services.episodes.list(ctx.project)).map(episodeSummary) } })
})

const createEpisode = defineTool({
  name: 'create_episode',
  description: 'Add a new episode after the last one. The result carries its id, which create_panel and list_panels take as episodeId.',
  input: z.object({
    title: z.string().min(1).describe('Episode title'),
    synopsis: z.string().optional().describe('One or two sentences on what happens. Default empty.')
  }),
  handler: async (input, ctx) => ({ content: { episode: episodeSummary(await ctx.services.episodes.create(ctx.project, input)) } })
})

const listPanels = defineTool({
  name: 'list_panels',
  description:
    'List the last panels of an episode in story order (default the last 5): id, index (position in the episode, from 0), shot, aspect, cast, description, dialogue and ' +
    'the current version (id, status, imagePath), which is null while the panel has no ready image. Read recent panels before drawing the next one.',
  input: z.object({
    episodeId,
    last: z.number().int().min(1).optional().describe(`How many of the final panels to return. Default ${DEFAULT_LAST}.`)
  }),
  handler: async ({ episodeId, last }, ctx) => {
    const episode = await loadEpisode(ctx, episodeId)
    const [panels, roster] = await Promise.all([ctx.services.panels.list(ctx.project, episode.id), ctx.services.characters.list(ctx.project, { includeArchived: true })])
    // Archived characters still name the cast of panels that were drawn before they were archived.
    const names = new Map(roster.map((c) => [c.id, c.name]))
    return {
      content: {
        panels: panels.slice(-(last ?? DEFAULT_LAST)).map((p) => ({
          id: p.id,
          index: episode.panelIds.indexOf(p.id),
          shot: p.shot,
          aspect: p.aspect,
          cast: p.characters.map((c) => ({ name: names.get(c.characterId) ?? c.characterId, characterId: c.characterId, variationId: c.variationId })),
          description: p.description,
          dialogue: p.dialogue,
          currentVersion: versionBrief(p)
        }))
      }
    }
  }
})

const getPanel = defineTool({
  name: 'get_panel',
  description: 'Get one panel in full: every field, the cast, the dialogue and the whole version history (prompts, reference images and status of each attempt).',
  input: z.object({ panelId }),
  handler: async ({ panelId }, ctx) => ({ content: await loadPanel(ctx, panelId) })
})

const viewPanelImage = defineTool({
  name: 'view_panel_image',
  description: "Look at a panel's current image. Use it to check what was drawn, for example before editing or continuing from it.",
  input: z.object({ panelId }),
  handler: async ({ panelId }, ctx) => {
    const current = currentVersion(await loadPanel(ctx, panelId))
    if (!current || current.status !== 'ready' || current.imagePath === null) throw new ToolError(`Panel ${panelId} has no ready image`)
    return { content: { panelId, versionId: current.id, imagePath: current.imagePath }, images: [current.imagePath] }
  }
})

const createPanel = defineTool({
  name: 'create_panel',
  description:
    'Add a panel to an episode (at the end, or after afterPanelId; null puts it first) and generate its image, waiting for it. ' +
    'Cast every character who appears with characterId and variationId from list_characters; the variation must have a ready image. ' +
    'A roster character named in the description must be cast or listed in offPanelMentions, otherwise the call is rejected. ' +
    "Describe the action and composition, not the characters' looks: each cast member's appearanceLock is added to the image prompt for you. " +
    'Dialogue is stored as data and drawn over the image, so the picture contains no text. ' +
    'If the image fails the panel still exists: read status and error, then call regenerate_panel. check is the consistency check result, or null when none ran.',
  input: PanelDraftSchema.extend({
    episodeId,
    afterPanelId: z.string().nullable().optional().describe('Insert after this panel; null inserts at the start. Default: append at the end.'),
    description: z.string().describe('What happens in the panel: action, composition, mood. No dialogue and no text in the picture.'),
    setting: z.string().describe('Where and when, e.g. "Apartment hallway, evening"'),
    aspect: PanelDraftSchema.shape.aspect.describe('Default: the project default aspect'),
    characters: z.array(PanelCharacterSchema).describe('Who is in the panel, at most three in the foreground. Empty for a scene without characters.'),
    dialogue: PanelDraftSchema.shape.dialogue.describe('Speech, thought, narration and sound effects in reading order. speakerId is a character id, or null for narration and sfx.'),
    continuityNotes: z.string().optional().describe('What must match the previous panel: lighting, time of day, props, outfits. Default empty.'),
    offPanelMentions: z.array(z.string()).optional().describe('Roster characters named in the description but not shown, e.g. ["Jin"]')
  }),
  handler: async (draft, ctx) => {
    await loadEpisode(ctx, draft.episodeId)
    const { panels } = ctx.services
    let created: { panel: Panel; warnings: string[] }
    try {
      created = await panels.create(ctx.project, draft, { createdBy: 'ai', strictMentions: true })
    } catch (error) {
      throw asToolError(error)
    }
    // Generation never throws for a provider failure; a failed image is reported in the result.
    const version = await panels.generate(ctx.project, created.panel.id, { signal: ctx.signal })
    return versionOutcome(created.panel.id, version, created.warnings)
  }
})

const updatePanel = defineTool({
  name: 'update_panel',
  description:
    'Change fields of a panel. Only the fields named in patch change, and the merged panel is validated like create_panel. ' +
    'This does not redraw the image: pass regenerate true to generate a new one now and wait for it (the result is then the new version, like create_panel), ' +
    'or call regenerate_panel later. Without regenerate the result is the updated panel.',
  input: z.object({
    panelId,
    patch: PanelPatchSchema.describe('The fields to change; fields left out stay as they are. A characters or dialogue list replaces the whole list.'),
    regenerate: z.boolean().optional().describe('Generate a new image after the update. Default false.')
  }),
  handler: async ({ panelId, patch, regenerate }, ctx) => {
    await loadPanel(ctx, panelId)
    const { panels } = ctx.services
    let updated: { panel: Panel; warnings: string[] }
    try {
      updated = await panels.update(ctx.project, panelId, patch, { strictMentions: true })
    } catch (error) {
      throw asToolError(error)
    }
    if (regenerate !== true) return { content: updated }
    const version = await panels.generate(ctx.project, panelId, { signal: ctx.signal })
    return versionOutcome(panelId, version, updated.warnings)
  }
})

const regeneratePanel = defineTool({
  name: 'regenerate_panel',
  description:
    "Generate a panel's image again from its current fields and wait for it; the old image stays in the history. " +
    'Use it to retry a failed image or after update_panel. If the new image fails, the previous image stays current.',
  input: z.object({ panelId }),
  handler: async ({ panelId }, ctx) => {
    await loadPanel(ctx, panelId)
    return versionOutcome(panelId, await ctx.services.panels.generate(ctx.project, panelId, { signal: ctx.signal }))
  }
})

const editPanelImage = defineTool({
  name: 'edit_panel_image',
  description:
    "Edit a panel's current image with an instruction and wait for the result, which becomes a new version. " +
    'Use it for small corrections to what was drawn (a color, an object, an expression) and regenerate_panel for a different composition. ' +
    'It needs a ready image; if the edit fails, the previous image stays current.',
  input: z.object({ panelId, instruction: z.string().min(1).describe('What to change, e.g. "Make the sky a warmer orange"') }),
  handler: async ({ panelId, instruction }, ctx) => {
    await loadPanel(ctx, panelId)
    return versionOutcome(panelId, await ctx.services.panels.editImage(ctx.project, panelId, instruction, { signal: ctx.signal }))
  }
})

export const panelTools: ToolDefinition[] = [listEpisodes, createEpisode, listPanels, getPanel, viewPanelImage, createPanel, updatePanel, regeneratePanel, editPanelImage]
