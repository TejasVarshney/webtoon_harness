import type { Character, Item, ItemUsage, Location, LocationState, Panel, Variation } from '@shared/types'
import { drawAspect, isTallAspect } from '@shared/draw-aspect'
import { hasReadyReference, hasReadyState, hasReadyUsage } from './panel-validation'
import { chooseCastToPack, type PackMember } from './reference-pack'

// Prompt builders for generated images. Wording is pinned by tests: the image models are sensitive
// to it, and every sheet must say "no text" because dialogue is rendered as HTML (never in the image).

/** The redraw instruction after a failed sheet check: `Important details: a; b.`, plain description added to the drawing prompt, or undefined when there are no issues. */
export function sheetFixInstruction(issues: string[]): string | undefined {
  return issues.length > 0 ? `Important details: ${issues.join('; ')}.` : undefined
}

/** Appends the optional fix instruction to a sheet prompt, after one space. */
function withFix(prompt: string, fix?: string): string {
  return fix ? `${prompt} ${fix}` : prompt
}

export function baseReferencePrompt(c: Character, stylePreset: string, fix?: string): string {
  return withFix(`Character reference sheet. ${stylePreset}. Full body, front view, neutral expression, standing straight, plain light-gray background, even studio lighting, no text. ${c.appearanceLock}`, fix)
}

export function variationPrompt(c: Character, v: Variation, stylePreset: string, fix?: string): string {
  return withFix(`Character reference sheet. ${stylePreset}. Full body, front view, plain light-gray background, no text. ${c.appearanceLock} Variation: ${v.name} — ${v.delta}. Keep face, hair, body and colors identical to the reference image except for the variation.`, fix)
}

export function itemReferencePrompt(item: Item, stylePreset: string, fix?: string): string {
  return withFix(`Item reference sheet. ${stylePreset}. The object alone, three-quarter view, centered, plain light-gray background, even studio lighting, no people, no hands, no text. ${item.appearanceLock}`, fix)
}

/** Action usages show only the gray grip; every other kind (state, and base, which `itemReferencePrompt` makes) uses the state wording. */
export function itemUsagePrompt(item: Item, usage: ItemUsage, stylePreset: string, fix?: string): string {
  if (usage.kind === 'action') {
    return withFix(`Item usage reference sheet. ${stylePreset}. Plain light-gray background, no text. ${item.appearanceLock} Usage: ${usage.name} — ${usage.delta}. Show only plain gray hands and forearms, cropped at the elbow, with no face, body, clothing or jewelry, so the sheet shows only the grip, the motion and the effect. Keep shape, size, materials, colors and markings identical to the reference image.`, fix)
  }
  return withFix(`Item reference sheet. ${stylePreset}. The object alone, three-quarter view, plain light-gray background, no people, no hands, no text. ${item.appearanceLock} State: ${usage.name} — ${usage.delta}. Keep shape, size, materials, colors and markings identical to the reference image except for the state.`, fix)
}

/** The words every location picture shares: what it is and what it must leave out. */
function locationPictureLead(l: Location, stylePreset: string): string {
  return `Location reference picture. ${stylePreset}. The empty place, wide shot from its main camera angle at eye level, in even neutral light with no lamps or ceiling lights switched on, no people, no animals, no text. ${l.name}. Layout from this angle: ${l.layout}`
}

export function locationReferencePrompt(l: Location, stylePreset: string, fix?: string): string {
  return withFix(locationPictureLead(l, stylePreset), fix)
}

export function locationStatePrompt(l: Location, state: LocationState, stylePreset: string, fix?: string): string {
  return withFix(
    `${locationPictureLead(l, stylePreset)} State: ${state.name} — ${state.delta}. Keep the layout, landmarks, architecture and camera angle identical to the reference image except for the state.`,
    fix
  )
}

// ---------------------------------------------------------------------------------------------
// Panel prompts. Dialogue never enters an image prompt: it is rendered as HTML over the
// panel, so `composePanelPrompt` does not even accept it.
// ---------------------------------------------------------------------------------------------

/**
 * Whose image a reference is. The checker matches references to cast and items by this, never by label. A pack is one
 * image holding several members' sheets, in grid order (see `reference-pack.ts`).
 */
type ReferenceSubject = { kind: 'character'; id: string } | { kind: 'location'; id: string } | { kind: 'item'; id: string } | { kind: 'sketch' } | { kind: 'previous' } | { kind: 'pack'; members: PackMember[] }

export interface PanelPromptReference {
  relPath: string
  label: string
  subject: ReferenceSubject
}

export interface PanelPromptInput {
  stylePreset: string
  panel: Pick<Panel, 'description' | 'setting' | 'shot' | 'aspect' | 'frame' | 'characters' | 'items' | 'continuityNotes'> & { location?: Panel['location'] }
  /** Characters; resolves cast entries and the holders of items. */
  roster: Map<string, Character>
  itemRoster: Map<string, Item>
  /** Resolves the panel's location. Left out (an edit), the panel is composed as if it had none. */
  locations?: Map<string, Location>
  /** The image the panel continues from: the panel right before it, or with `earlier` an earlier panel in the same location. */
  previous: { panelId: string; imagePath: string; earlier?: boolean } | null
  /** The user's layout sketch, for a generation only (an edit keeps the image's own composition). */
  sketch?: string | null
  /** The image model's reference-image cap. */
  maxReferences: number
  /**
   * Set to pack cast sheets onto one image over the cap instead of dropping them (a generation only: the edit prompt
   * says nothing of a pack). `path` names the file the caller draws the pack into before sending it (see `storePacks`).
   */
  packing?: { path: (members: PackMember[]) => string }
}

export interface PanelPromptResult {
  prompt: string
  /** In the order claimed: ready cast variations (cast order, a pack in the place of its first member), then the location's picture, then ready item usages (panel order), then the sketch, then the previous panel. */
  references: PanelPromptReference[]
}

const TALL_NOTE = 'Tall panel: keep the top fifth and bottom fifth plain background (sky, floor, darkness), so they can fade out.'
const BORDERLESS_NOTE = 'Art runs to the edges, no frame.'

const NO_REFERENCE = '(no reference image)'

/** Follows [CHARACTERS] when `sheets` cast sheets are packed onto reference image `n`. */
function packNote(n: number, sheets: number): string {
  return `Reference image ${n} holds ${sheets} character sheets, each labeled with the person's name, only to show what each person looks like: never copy its layout, background, poses or labels.`
}

const LAYOUT_PREFIX = '[LAYOUT] Follow the rough composition of the sketch'
const LAYOUT_NOTE =
  ': where the figures and objects sit, their poses, the camera angle and the framing. It is a rough guide only: never copy its scribbled lines, flat colours or blank background, and draw everything in the style above.'

/** Tall panels always fade out, so they never get the borderless line. */
function shapeNote(panel: Pick<Panel, 'aspect' | 'frame'>): string {
  if (isTallAspect(panel.aspect)) return ` ${TALL_NOTE}`
  return panel.frame === 'borderless' ? ` ${BORDERLESS_NOTE}` : ''
}

/** How the checker's image list names a continuity image that is not the panel right before. */
const EARLIER_LABEL = 'earlier panel in the same place'

/** How a location's picture is to be used: for the place's architecture and where its landmarks are, never its framing or its light (a live test copied a lit room into a dark night). */
const LOCATION_PICTURE_NOTE =
  "The reference shows the empty place from its main camera angle, only for its architecture and where its landmarks are, not its lighting: the light and the time of day come from the setting and the state. Draw it from this panel's camera and shot, with the cast in it."

/** Where the camera is, as the [LOCATION] line says it. */
function cameraSentence(camera: string): string {
  const said = camera.trim()
  if (said === '' || said.toLowerCase() === 'main') return 'Camera: its main angle, so every landmark stays on the side of the frame the layout gives.'
  if (said.toLowerCase() === 'reverse') return 'Camera: reverse angle, facing the other way, so the landmarks the layout puts on frame-left are on frame-right and the other way round.'
  return `Camera: ${said.replace(/\.$/, '')}.`
}

/** The panel's place. A state with no picture of its own is drawn from the base picture and its words. */
function placeOf(at: NonNullable<Panel['location']>, locations: Map<string, Location>) {
  const location = locations.get(at.locationId)
  if (!location) throw new Error(`Unknown location: ${at.locationId}`)
  const state = location.states.find((s) => s.id === at.stateId)
  if (!state) throw new Error(`State ${at.stateId} does not belong to ${location.name}`)
  const base = location.states.find((s) => s.kind === 'base')
  return { location, state, camera: at.camera, picture: hasReadyState(state) ? state.imagePath : base && hasReadyState(base) ? base.imagePath : null }
}

const ITEMS_HEADER =
  "[ITEMS] Draw each item exactly as its reference image shows it, and use it exactly as its reference shows. Gray hands in an item reference only show the grip: draw the holder's own hands, never gray hands."

/**
 * Builds the panel prompt and its ordered reference list. References are the cast members'
 * variation images in cast order, then the location's picture, then the panel items' usage images in panel order, then the user's
 * layout sketch (a [LAYOUT] line, left out with its image), then the image the panel continues from (the previous
 * panel, or an earlier one in the same place, each with its own [CONTINUITY] wording; with neither, the line holds only
 * the continuity notes, and is left out when there are none). With `packing`, over `maxReferences` some cast sheets
 * share one image first (`chooseCastToPack`): the pack takes its first member's place, [CHARACTERS] says what it is,
 * and each member reads "(reference image N, the sheet labeled Name)". Still over `maxReferences`, the previous panel
 * is dropped first, then the sketch, then items from the end, then the location's picture, then cast members from the
 * end, and a dropped entry reads "(no reference image)" (an item's lock still applies). A cast member or item whose
 * image is not ready reads the same way (validation reports that separately). Throws if a cast entry names a character
 * or variation that is not in `roster`, or an item entry names an item or usage that is not in `itemRoster`: callers
 * validate first. Archived characters and items still compose, so existing panels can be regenerated.
 */
export function composePanelPrompt(input: PanelPromptInput): PanelPromptResult {
  const { stylePreset, panel, roster, itemRoster, locations, previous, sketch, maxReferences, packing } = input
  const references: PanelPromptReference[] = []

  /** Records `file` as the next reference and gives its number, or null when there is no file or the cap is reached. */
  const refer = (file: string | null, label: string, subject: ReferenceSubject): number | null => {
    if (file === null || references.length >= maxReferences) return null
    references.push({ relPath: file, label, subject })
    return references.length
  }
  const markerOf = (n: number | null): string => (n === null ? NO_REFERENCE : `(reference image ${n})`)

  const cast = panel.characters.map((entry) => {
    const character = roster.get(entry.characterId)
    if (!character) throw new Error(`Unknown character: ${entry.characterId}`)
    const variation = character.variations.find((v) => v.id === entry.variationId)
    if (!variation) throw new Error(`Variation ${entry.variationId} does not belong to ${character.name}`)
    return { entry, character, variation, sheet: hasReadyReference(variation) ? variation.imagePath : null }
  })
  const gear = panel.items.map((entry) => {
    const item = itemRoster.get(entry.itemId)
    if (!item) throw new Error(`Unknown item: ${entry.itemId}`)
    const usage = item.usages.find((u) => u.id === entry.usageId)
    if (!usage) throw new Error(`Usage ${entry.usageId} does not belong to ${item.name}`)
    return { entry, item, usage, sheet: hasReadyUsage(usage) ? usage.imagePath : null }
  })

  // Resolved before packing is chosen: the picture takes a slot like any other reference.
  const place = panel.location && locations ? placeOf(panel.location, locations) : null

  const others = gear.filter((g) => g.sheet !== null).length + (place?.picture ? 1 : 0) + (sketch ? 1 : 0) + (previous ? 1 : 0)
  const packed = packing ? chooseCastToPack(cast.map((c) => c.sheet !== null), others, maxReferences) : []
  const members: PackMember[] = packed.map((i) => ({ subject: { kind: 'character', id: cast[i].character.id }, name: cast[i].character.name, relPath: cast[i].sheet ?? '' }))
  /** The pack's reference number once its first member has sent it (null if the cap left no room). */
  let pack = null as { n: number | null } | null

  const castLines = cast.map(({ entry, character, variation, sheet }, i) => {
    let marker: string
    if (packing && packed.includes(i)) {
      pack ??= { n: refer(packing.path(members), 'character sheets', { kind: 'pack', members }) }
      marker = pack.n === null ? NO_REFERENCE : `(reference image ${pack.n}, the sheet labeled ${character.name})`
    } else {
      marker = markerOf(refer(sheet, character.name, { kind: 'character', id: character.id }))
    }
    const look = variation.delta ? `${variation.name} — ${variation.delta}` : variation.name
    const details = [
      character.appearanceLock,
      `Look: ${look}.`,
      entry.action && `Action: ${entry.action}.`,
      entry.expression && `Expression: ${entry.expression}.`,
      entry.position.trim() && `Position: ${entry.position.trim()}.`
    ]
    return `- ${character.name} ${marker}: ${details.filter(Boolean).join(' ')}`
  })

  // The location's picture is claimed right after the cast, so over the cap it outlasts items, the sketch and the previous panel.
  let locationLine: string | null = null
  if (place) {
    const { location, state, camera, picture } = place
    const marker = markerOf(refer(picture, `${location.name} (the empty place, main camera angle)`, { kind: 'location', id: location.id }))
    locationLine = [
      `[LOCATION] ${location.name} ${marker}: ${location.layout.trim()}`,
      state.kind === 'base' ? '' : `State: ${state.delta ? `${state.name} — ${state.delta}` : state.name}.`,
      cameraSentence(camera),
      marker === NO_REFERENCE ? '' : LOCATION_PICTURE_NOTE
    ]
      .filter(Boolean)
      .join(' ')
  }

  const itemLines = gear.map(({ entry, item, usage, sheet }) => {
    const marker = markerOf(refer(sheet, item.name, { kind: 'item', id: item.id }))
    const look = usage.delta ? `${usage.name} — ${usage.delta}` : usage.name
    const holder = entry.heldBy === null ? 'nobody' : (roster.get(entry.heldBy)?.name ?? entry.heldBy)
    const action = entry.action.trim()
    return `- ${item.name} ${marker}: ${item.appearanceLock} Use: ${look}. Held by: ${holder}.${action ? ` Action: ${action}.` : ''}`
  })

  const lines = [
    `[STYLE] ${stylePreset}. Vertical-scroll webtoon panel, ${drawAspect(panel.aspect)} aspect ratio, ${panel.shot} shot. No text, no speech bubbles, no captions, no watermark.${shapeNote(panel)}`,
    `[SETTING] ${panel.setting}`,
    ...(locationLine === null ? [] : [locationLine]),
    `[ACTION] ${panel.description}`,
    pack?.n ? `[CHARACTERS] ${packNote(pack.n, members.length)}` : '[CHARACTERS]',
    ...castLines
  ]

  if (itemLines.length > 0) lines.push(ITEMS_HEADER, ...itemLines)

  if (sketch) {
    const n = refer(sketch, 'layout sketch', { kind: 'sketch' })
    if (n !== null) lines.push(`${LAYOUT_PREFIX} ${markerOf(n)}${LAYOUT_NOTE}`)
  }

  const notes = panel.continuityNotes.trim()
  if (previous?.earlier) {
    const marker = markerOf(refer(previous.imagePath, EARLIER_LABEL, { kind: 'previous' }))
    lines.push([`[CONTINUITY] Same place as an earlier panel ${marker}. Keep the layout of the place and its landmarks consistent with it.`, notes].filter(Boolean).join(' '))
  } else if (previous) {
    const marker = markerOf(refer(previous.imagePath, 'previous panel', { kind: 'previous' }))
    const continuity = `[CONTINUITY] Continues directly from the previous panel ${marker}. Keep setting layout, lighting, time of day and outfits consistent.`
    lines.push([continuity, notes].filter(Boolean).join(' '))
  } else if (notes) {
    // Nothing to continue from (a first panel, a new place), but the notes may still carry the scene's layout.
    lines.push(`[CONTINUITY] ${notes}`)
  }

  return { prompt: lines.join('\n'), references }
}

/** The instruction for editing an existing panel image in place (the first reference image). */
export function editPanelPrompt(
  instruction: string,
  cast: { name: string; appearanceLock: string }[],
  items: { name: string; appearanceLock: string }[] = []
): string {
  const onModelItems = items.length > 0 ? ` and keep these items on-model: ${items.map((i) => `${i.name}: ${i.appearanceLock}`).join(' ')}` : ''
  return `Edit the first image: ${instruction}. Keep everything else unchanged — composition, framing, lighting, art style — and keep these characters on-model: ${cast.map((c) => `${c.name}: ${c.appearanceLock}`).join(' ')}${onModelItems} No text, no speech bubbles.`
}
