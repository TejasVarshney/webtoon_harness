import type { Panel } from '@shared/types'

/** The image a draw continues from. `earlier` is set when it is not the panel right before. */
export interface ContinuityImage {
  panelId: string
  imagePath: string
  earlier: boolean
}

/**
 * Shots that show the place around the people, so a later panel can keep its layout. The rest show too little of it
 * (close-ups, an over-the-shoulder) or show it from an odd angle (a low or high angle), which an image model copies.
 */
const OPEN_SHOTS: ReadonlySet<Panel['shot']> = new Set(['establishing', 'wide', 'medium'])

/** The saved location a panel is set in, or '' when it has none. Its state and camera do not count: it is the same place. */
function locationKey(location: Panel['location']): string {
  return location?.locationId ?? ''
}

/** The panel's current image, if that version is ready. */
function readyImage(panel: Panel | null, earlier: boolean): ContinuityImage | null {
  const version = panel?.versions.find((v) => v.id === panel.currentVersionId)
  return panel && version && version.status === 'ready' && version.imagePath ? { panelId: panel.id, imagePath: version.imagePath, earlier } : null
}

/**
 * Which image a draw of `panel` continues from, given the panels before it in its episode, in order (null for one
 * that could not be read).
 *
 * - When this panel or the one right before has no location, it is the one right before, as it always was.
 * - Panels are in the same place when they name the same saved location, whatever its state or the camera.
 * - Otherwise it is the nearest earlier panel in the same location that has a ready image, an open shot first: a
 *   close-up or a low angle right before would show too little of the place, or show it wrong.
 * - None when no earlier panel is in this location: a new place never continues from the last one. A return to a
 *   place (after a cutaway or a flashback) continues from the last panel there.
 */
export function pickContinuity(panel: Pick<Panel, 'location'>, before: readonly (Panel | null)[]): ContinuityImage | null {
  const previous = before.at(-1) ?? null
  const key = locationKey(panel.location)
  if (key === '' || previous === null || locationKey(previous.location) === '') return readyImage(previous, false)
  const here = before.filter((p): p is Panel => p !== null && locationKey(p.location) === key && readyImage(p, false) !== null).reverse()
  const chosen = here.find((p) => OPEN_SHOTS.has(p.shot)) ?? here[0]
  return chosen === undefined ? null : readyImage(chosen, chosen !== previous)
}
