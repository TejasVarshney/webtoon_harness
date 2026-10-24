import { z } from 'zod'
import { versionLabel } from '@shared/panel-versions'
import { PanelPatchSchema } from '@shared/schemas'
import type { Character, Episode, Panel, PanelVersion } from '@shared/types'
import { CorruptFileError, EntityNotFoundError, PathEscapeError } from '../../domain/errors'
import { PanelValidationError } from '../../domain/panel-service'
import type { Services } from '../../services'
import type { ProjectContext } from '../../storage/project-store'
import { castNames, speakerName, type PanelNeighbor } from '../system-prompt'
import { ToolError, ToolRegistry, defineTool, type ToolContext, type ToolDefinition, type ToolOutput } from './registry'

/*
 * The tools of a panel's side chat. Every one closes over the id of the panel the chat is bound to and
 * takes no panel id as input, so a model cannot reach another panel however it is prompted. Version
 * labels follow Ruling P7: `vN` is the position among the panel's ready versions, and a version that is
 * not ready has no label (its status says why).
 */

/** What the model sees of a panel's own fields. `roster` includes archived characters, which still name the cast of existing panels. */
function fieldsView(panel: Panel, roster: Character[]) {
  return {
    shot: panel.shot,
    aspect: panel.aspect,
    setting: panel.setting,
    description: panel.description,
    continuityNotes: panel.continuityNotes,
    offPanelMentions: panel.offPanelMentions,
    cast: panel.characters.map((entry) => ({
      characterId: entry.characterId,
      ...castNames(entry, roster),
      variationId: entry.variationId,
      action: entry.action,
      expression: entry.expression,
      position: entry.position
    })),
    dialogue: panel.dialogue.map((line) => ({
      id: line.id,
      speakerId: line.speakerId,
      speaker: speakerName(line, roster),
      kind: line.kind,
      text: line.text
    }))
  }
}

/** A neighboring panel in a few lines; `{ unreadable: true }` when its file could not be read. */
function neighborView(panel: PanelNeighbor, roster: Character[]) {
  if (panel === null) return null
  if (panel === 'unreadable') return { unreadable: true }
  return {
    id: panel.id,
    shot: panel.shot,
    aspect: panel.aspect,
    setting: panel.setting,
    description: panel.description,
    cast: panel.characters.map((entry) => {
      const { name, variationName } = castNames(entry, roster)
      return { name, variationName }
    }),
    dialogue: panel.dialogue.map((line) => ({ speaker: speakerName(line, roster), kind: line.kind, text: line.text }))
  }
}

export interface PanelBundle {
  panel: Panel
  /** Every character, archived ones included. */
  roster: Character[]
  previous: PanelNeighbor
  next: PanelNeighbor
}

/** Notes an unreadable panel file in `ctx.problems` (once per file), the way the panel service does for the panels it lists. */
function reportUnreadable(project: ProjectContext, error: CorruptFileError): void {
  let rel: string
  try {
    rel = project.paths.toRelative(error.path)
  } catch {
    rel = error.path
  }
  if (!project.problems.some((p) => p.path === rel)) project.problems.push({ path: rel, message: error.message })
}

/**
 * A panel with what its side chat needs around it: the roster and the panels before and after it in its
 * episode. A neighbor whose file is gone, or whose id names no panel (a hand-edited episode), counts as none.
 * One whose file is corrupt is `'unreadable'` and is reported as a project problem. Any other failure is thrown.
 */
export async function loadPanelBundle(services: Services, project: ProjectContext, panelId: string): Promise<PanelBundle> {
  const panel = await services.panels.get(project, panelId)
  const roster = await services.characters.list(project, { includeArchived: true })
  let episode: Episode | null = null
  try {
    episode = await services.episodes.get(project, panel.episodeId)
  } catch (error) {
    if (!(error instanceof EntityNotFoundError)) throw error
  }
  const at = episode ? episode.panelIds.indexOf(panel.id) : -1
  const neighbor = async (id: string | undefined): Promise<PanelNeighbor> => {
    if (id === undefined) return null
    try {
      return await services.panels.get(project, id)
    } catch (error) {
      if (error instanceof EntityNotFoundError || error instanceof PathEscapeError) return null
      if (error instanceof CorruptFileError) {
        reportUnreadable(project, error)
        return 'unreadable'
      }
      throw error
    }
  }
  const [previous, next] = at === -1 ? [null, null] : await Promise.all([neighbor(episode?.panelIds[at - 1]), neighbor(episode?.panelIds[at + 1])])
  return { panel, roster, previous, next }
}

/** What the service rejected becomes a message for the model: validation issues one per line. */
function asToolError(error: unknown): unknown {
  return error instanceof PanelValidationError ? new ToolError(error.issues.join('\n')) : error
}

/** The outcome of an image attempt. A `failed` status is a result for the model to read, not a thrown error. */
function versionResult(v: PanelVersion, label: string | null): ToolOutput {
  return {
    content: { versionId: v.id, label, status: v.status, error: v.error, imagePath: v.imagePath, check: v.check },
    images: v.status === 'ready' && v.imagePath !== null ? [v.imagePath] : []
  }
}

/**
 * A new version's label counts the ready versions after the attempt was recorded, so the panel is read back.
 * A ready result always carries its label (Ruling P7): if the panel cannot be read back (it was deleted, or the
 * read failed) or no longer lists the version as ready, the call fails with that reason instead.
 */
async function recordedResult(ctx: ToolContext, panelId: string, v: PanelVersion): Promise<ToolOutput> {
  if (v.status !== 'ready') return versionResult(v, null)
  const label = versionLabel(await ctx.services.panels.get(ctx.project, panelId), v.id)
  if (label === null) throw new ToolError(`Version ${v.id} is no longer a ready version of this panel`)
  return versionResult(v, label)
}

const getPanelContext = (panelId: string): ToolDefinition =>
  defineTool({
    name: 'get_panel_context',
    description:
      'Read this panel as it is now: shot, aspect, setting, description, the cast with variation names, the dialogue, the version list ' +
      '(label vN counts ready images only; a version that is not ready has no label and its status says why) and a summary of the previous and next panels. ' +
      "Use it when the panel_context in the user's message may be out of date, for example after a change you made.",
    input: z.object({}),
    handler: async (_input, ctx) => {
      const { panel, roster, previous, next } = await loadPanelBundle(ctx.services, ctx.project, panelId)
      return {
        content: {
          panelId: panel.id,
          episodeId: panel.episodeId,
          ...fieldsView(panel, roster),
          currentVersionId: panel.currentVersionId,
          versions: panel.versions.map((v) => ({ id: v.id, label: versionLabel(panel, v.id), status: v.status, source: v.source })),
          previous: neighborView(previous, roster),
          next: neighborView(next, roster)
        }
      }
    }
  })

const viewCurrentImage = (panelId: string): ToolDefinition =>
  defineTool({
    name: 'view_current_image',
    description: "Look at this panel's current image. Use it to see what was drawn before you edit it or describe a change.",
    input: z.object({}),
    handler: async (_input, ctx) => {
      const panel = await ctx.services.panels.get(ctx.project, panelId)
      const current = panel.versions.find((v) => v.id === panel.currentVersionId)
      if (!current || current.status !== 'ready' || current.imagePath === null) throw new ToolError('This panel has no ready image')
      return { content: { versionId: current.id, label: versionLabel(panel, current.id), imagePath: current.imagePath }, images: [current.imagePath] }
    }
  })

const patchInput = PanelPatchSchema.extend({
  description: PanelPatchSchema.shape.description.describe('What happens in the panel: action, composition, mood. No dialogue and no text in the picture.'),
  setting: PanelPatchSchema.shape.setting.describe('Where and when, e.g. "Apartment hallway, evening"'),
  characters: PanelPatchSchema.shape.characters.describe('Who is in the panel (characterId and variationId from the roster), replacing the whole cast. Empty for a scene without characters.'),
  dialogue: PanelPatchSchema.shape.dialogue.describe('Speech, thought, narration and sound effects in reading order, replacing all the dialogue. speakerId is a character id, or null for narration and sfx.'),
  continuityNotes: PanelPatchSchema.shape.continuityNotes.describe('What must match the previous panel: lighting, time of day, props, outfits.'),
  offPanelMentions: PanelPatchSchema.shape.offPanelMentions.describe('Roster characters named in the description but not shown, e.g. ["Jin"]')
})

const updatePanelFields = (panelId: string): ToolDefinition =>
  defineTool({
    name: 'update_panel_fields',
    description:
      'Change fields of this panel. Only the fields you name change, and the merged panel is validated. ' +
      'When the description changes, a roster character it names must be cast or listed in offPanelMentions, otherwise the call is rejected (any other edit only returns that as a warning). ' +
      'This does not redraw the image: a dialogue-only change needs no image at all, and a visual change needs regenerate_image or edit_image afterwards.',
    input: patchInput,
    handler: async (patch, ctx) => {
      let updated: { panel: Panel; warnings: string[] }
      try {
        // Ruling T21b (as T19a): strict only for a description edit, so a panel saved with an unattached-mention warning
        // (the manual editor allows it) stays editable here; the warning is passed on instead.
        updated = await ctx.services.panels.update(ctx.project, panelId, patch, { strictMentions: patch.description !== undefined })
      } catch (error) {
        throw asToolError(error)
      }
      const roster = await ctx.services.characters.list(ctx.project, { includeArchived: true })
      const named = Object.entries(patch).flatMap(([field, value]) => (value === undefined ? [] : [field]))
      return { content: { updated: named, warnings: updated.warnings, fields: fieldsView(updated.panel, roster) } }
    }
  })

const regenerateImage = (panelId: string): ToolDefinition =>
  defineTool({
    name: 'regenerate_image',
    description:
      "Draw this panel again from its current fields and wait for the result, which becomes a new version; the old images stay in the history. " +
      'Use it for a different composition, or after update_panel_fields changed what the picture shows. If the new image fails, the previous image stays current. ' +
      'check is the consistency check of the image that is now current, or null when none ran; a failed check has already been redrawn automatically.',
    input: z.object({}),
    handler: async (_input, ctx) => recordedResult(ctx, panelId, await ctx.services.panels.generate(ctx.project, panelId, { signal: ctx.signal }))
  })

const editImage = (panelId: string): ToolDefinition =>
  defineTool({
    name: 'edit_image',
    description:
      "Edit this panel's current image with an instruction and wait for the result, which becomes a new version. " +
      'Use it for local changes to what was drawn (an expression, a color, an object) and regenerate_image for a different composition. ' +
      'It needs a ready image; if the edit fails, the previous image stays current.',
    input: z.object({ instruction: z.string().min(1).describe('What to change, e.g. "Make her smile"') }),
    handler: async ({ instruction }, ctx) => recordedResult(ctx, panelId, await ctx.services.panels.editImage(ctx.project, panelId, instruction, { signal: ctx.signal }))
  })

const revertToVersion = (panelId: string): ToolDefinition =>
  defineTool({
    name: 'revert_to_version',
    description:
      "Make an earlier ready version of this panel's image current again. Take the versionId from get_panel_context. No version is deleted.",
    input: z.object({ versionId: z.string().describe('Version id, e.g. ver_0123456789, from get_panel_context') }),
    handler: async ({ versionId }, ctx) => {
      const before = await ctx.services.panels.get(ctx.project, panelId)
      const target = before.versions.find((v) => v.id === versionId)
      if (!target) throw new ToolError(`Unknown version: ${versionId}`)
      if (target.status !== 'ready') throw new ToolError(`Version ${versionId} is ${target.status}, so it cannot be made current: only a ready version can`)
      const after = await ctx.services.panels.revert(ctx.project, panelId, versionId)
      return versionResult(target, versionLabel(after, versionId))
    }
  })

/** The side chat's tools for one panel. Builds no I/O: the panel is only looked up when a tool runs. `view_current_image` needs a model that can see. */
export function buildPanelChatTools(panelId: string, opts: { vision: boolean }): ToolRegistry {
  const tools = [getPanelContext(panelId), viewCurrentImage(panelId), updatePanelFields(panelId), regenerateImage(panelId), editImage(panelId), revertToVersion(panelId)]
  return new ToolRegistry(opts.vision ? tools : tools.filter((tool) => tool.name !== 'view_current_image'))
}
