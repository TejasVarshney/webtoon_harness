import { newId } from '@shared/ids'
import { PanelSchema } from '@shared/schemas'
import type { DialogueLine, Panel, PanelDraft, PromptPreview } from '@shared/types'
import type { ProjectContext, ProjectStore } from '../storage/project-store'
import type { ContinuityImage } from './continuity'
import { pickContinuity } from './continuity'
import type { EpisodeService } from './episode-service'
import { EntityNotFoundError } from './errors'
import { drawChoicesOf, readReferencePanels, styleOf } from './panel-draw-choices'
import { tryReadPanel } from './panel-files'
import type { CharacterService } from './character-service'
import type { ImageService } from './image-service'
import type { ItemService } from './item-service'
import type { LocationService } from './location-service'
import { composePanelPrompt } from './prompts'
import { now } from './records'

// A draft's prompt without a draw, and the continuity lookup that a draw and the preview share. Their own file to keep
// `panel-service.ts` under the size limit.

/** The panel a draft becomes. `dialogue` arrives with its ids; the preview has none to give. */
export function panelFromDraft(draft: PanelDraft, own: { id: string; aspect: Panel['aspect']; createdBy: Panel['createdBy']; at: string; dialogue: DialogueLine[] }): Panel {
  return PanelSchema.parse({
    id: own.id,
    episodeId: draft.episodeId,
    description: draft.description,
    setting: draft.setting,
    location: draft.location ?? null,
    shot: draft.shot,
    aspect: own.aspect,
    frame: draft.frame,
    beside: draft.beside,
    gapAfter: draft.gapAfter,
    // Panels are placed on the strip now: the colour between rows has no input, and only old files carry one.
    gutter: 'white',
    ...drawChoicesOf(draft),
    characters: draft.characters,
    items: draft.items ?? [],
    dialogue: own.dialogue,
    continuityNotes: draft.continuityNotes ?? '',
    offPanelMentions: draft.offPanelMentions ?? [],
    versions: [],
    currentVersionId: null,
    createdBy: own.createdBy,
    createdAt: own.at,
    updatedAt: own.at
  })
}

/**
 * The image a draw of the panel continues from (see `pickContinuity`). Without a location only the panel right before
 * can be it, so only that one is read. `index` is where the panel is, or will be, in its episode (default: where it is
 * now); a panel that is not in the episode, or comes first, continues from nothing.
 */
export async function continuityOf(ctx: ProjectContext, episodes: Pick<EpisodeService, 'get'>, panel: Pick<Panel, 'id' | 'episodeId' | 'location'>, index?: (panelIds: string[]) => number): Promise<ContinuityImage | null> {
  let panelIds: string[]
  try {
    panelIds = (await episodes.get(ctx, panel.episodeId)).panelIds
  } catch (error) {
    if (error instanceof EntityNotFoundError) return null
    throw error
  }
  const at = index ? index(panelIds) : panelIds.indexOf(panel.id)
  if (at <= 0) return null
  const ids = panel.location === null ? [panelIds[at - 1]] : panelIds.slice(0, at)
  return pickContinuity(panel, await Promise.all(ids.map((id) => tryReadPanel(ctx, id))))
}

export interface PreviewDeps {
  projects: Pick<ProjectStore, 'getMeta'>
  episodes: Pick<EpisodeService, 'get'>
  characters: Pick<CharacterService, 'list'>
  items: Pick<ItemService, 'list'>
  locations?: Pick<LocationService, 'list'>
  images: Pick<ImageService, 'maxReferences'>
  /** Set when a draw would pack cast sheets over the cap; the preview then counts the slots that frees. */
  packComposer?: unknown
}

/**
 * The prompt the app would compose for a new panel and the references it would send, and
 * the chosen panels the model's reference cap leaves out. The draft's own prompt (`promptOverride`) is ignored on purpose: the preview is the automatic text. Writes nothing and calls no model. A draft the prompt cannot
 * be composed from rejects with the reason.
 */
export async function previewPrompt(ctx: ProjectContext, deps: PreviewDeps, draft: PanelDraft, hasSketch: boolean): Promise<PromptPreview> {
  const episode = await deps.episodes.get(ctx, draft.episodeId)
  if (typeof draft.afterPanelId === 'string' && !episode.panelIds.includes(draft.afterPanelId)) throw new EntityNotFoundError('panel', draft.afterPanelId)
  const meta = await deps.projects.getMeta(ctx)
  const panel = panelFromDraft(draft, { id: newId('pnl'), aspect: draft.aspect ?? meta.defaultAspect, createdBy: 'user', at: now(), dialogue: [] })
  // A new panel goes after the anchor, at the start for null and at the end for none: where the draw will find it.
  const where = (ids: string[]): number => (draft.afterPanelId === undefined ? ids.length : draft.afterPanelId === null ? 0 : ids.indexOf(draft.afterPanelId) + 1)
  const previous = await continuityOf(ctx, deps.episodes, panel, where)
  const roster = new Map((await deps.characters.list(ctx, { includeArchived: true })).map((c) => [c.id, c]))
  const items = new Map((await deps.items.list(ctx, { includeArchived: true })).map((i) => [i.id, i]))
  const locations = new Map((deps.locations ? await deps.locations.list(ctx, { includeArchived: true }) : []).map((l) => [l.id, l]))
  const chosen = await readReferencePanels(ctx, panel)
  const composed = composePanelPrompt({
    stylePreset: styleOf(panel, meta.stylePreset),
    panel,
    roster,
    itemRoster: items,
    locations,
    previous,
    sketch: hasSketch ? 'sketch' : null,
    referencePanels: chosen,
    maxReferences: deps.images.maxReferences('image'),
    packing: deps.packComposer ? { path: () => 'packed-references.png' } : undefined
  })
  const sent = new Set(composed.references.flatMap((r) => (r.subject.kind === 'panel' ? [r.subject.id] : [])))
  return { prompt: composed.prompt, references: composed.references.map((r) => ({ label: r.label })), droppedPanelIds: chosen.filter((c) => !sent.has(c.panelId)).map((c) => c.panelId) }
}

/** Gives a draft line its id. A line sent without a placement, style or tail takes `inherited`'s; an explicit null stays null. */
export function withId(
  line: Omit<DialogueLine, 'id' | 'placement' | 'style' | 'tail'> & Partial<Pick<DialogueLine, 'placement' | 'style' | 'tail'>>,
  inherited: Pick<DialogueLine, 'placement' | 'style' | 'tail'> | undefined
): DialogueLine {
  return {
    id: newId('dlg'),
    speakerId: line.speakerId,
    kind: line.kind,
    text: line.text,
    placement: line.placement === undefined ? (inherited?.placement ?? null) : line.placement,
    style: line.style === undefined ? (inherited?.style ?? null) : line.style,
    tail: line.tail === undefined ? (inherited?.tail ?? null) : line.tail
  }
}
