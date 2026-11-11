import type { Character, Item, Location, Panel, PanelAspect, PanelCharacter, PanelDraft, PanelItem, PanelLocation } from '@shared/types'

/** Where the Generate page was opened from: the chosen panels are in episode order. */
export interface GenerateRequest {
  episodeId: string
  referencePanelIds: string[]
  /** Where the new panel goes when no panel is chosen. Left out, it goes at the end. */
  afterPanelId?: string
}

/** What the page has collected for the new panel. */
export interface GenerateDraft {
  description: string
  setting: string
  shot: Panel['shot']
  aspect: PanelAspect
  location: PanelLocation | null
  characters: PanelCharacter[]
  items: PanelItem[]
  styleOverride: string | null
  promptOverride: string | null
  /** The layout sketch as a PNG data URL. */
  sketchPng: string | null
}

export function emptyDraft(aspect: PanelAspect): GenerateDraft {
  return { description: '', setting: '', shot: 'medium', aspect, location: null, characters: [], items: [], styleOverride: null, promptOverride: null, sketchPng: null }
}

/** Only a look with an image on disk can stand in as a reference (the rule the server applies). */
export function hasReadyImage(look: { status: string; imagePath: string | null }): boolean {
  return look.status === 'ready' && typeof look.imagePath === 'string' && look.imagePath.length > 0
}

/** The first look with a ready image, else the first look, else ''. Characters, items and locations choose their look the same way. */
function defaultLookId(looks: { id: string; status: string; imagePath: string | null }[]): string {
  return (looks.find(hasReadyImage) ?? looks[0])?.id ?? ''
}

export const defaultVariationId = (c: Character): string => defaultLookId(c.variations)
export const defaultUsageId = (i: Item): string => defaultLookId(i.usages)

/** A location is chosen in its base state, seen from its main camera. */
export function defaultLocation(l: Location): PanelLocation {
  return { locationId: l.id, stateId: (l.states.find((s) => s.kind === 'base') ?? l.states[0])?.id ?? '', camera: 'main' }
}

export function newCastMember(c: Character): PanelCharacter {
  return { characterId: c.id, variationId: defaultVariationId(c), action: '', expression: '', position: 'center' }
}

export function newItemUse(i: Item): PanelItem {
  return { itemId: i.id, usageId: defaultUsageId(i), heldBy: null, action: '' }
}

/** Drawing needs words to draw from: a description, or a prompt of the user's own. */
export function canDraw(d: GenerateDraft): boolean {
  return d.description.trim() !== '' || (d.promptOverride ?? '').trim() !== ''
}

/** Whether leaving would lose something the user entered or chose. The chosen panels are the page's way in, not work. */
export function isDraftDirty(d: GenerateDraft): boolean {
  return (
    d.description.trim() !== '' ||
    d.setting.trim() !== '' ||
    d.location !== null ||
    d.characters.length > 0 ||
    d.items.length > 0 ||
    d.styleOverride !== null ||
    d.promptOverride !== null ||
    d.sketchPng !== null
  )
}

/** The new panel goes right after the last chosen panel; with none chosen, after `afterPanelId`, else at the end. */
export function toPanelDraft(request: GenerateRequest, d: GenerateDraft): PanelDraft {
  const after = request.referencePanelIds.at(-1) ?? request.afterPanelId
  return {
    episodeId: request.episodeId,
    ...(after === undefined ? {} : { afterPanelId: after }),
    description: d.description,
    setting: d.setting,
    location: d.location,
    shot: d.shot,
    aspect: d.aspect,
    characters: d.characters,
    items: d.items,
    dialogue: [],
    referencePanelIds: request.referencePanelIds,
    styleOverride: d.styleOverride,
    promptOverride: d.promptOverride
  }
}
