// What a panel's picture shows, and which of it has changed since the picture was drawn. Pure and
// type-only imports: no Node modules, no zod, so the main process and the renderer can both use it.

import { drawAspect } from './draw-aspect'
import type { Panel, VisualField, VisualFields } from './types'

/** The fields that decide what the image looks like, in the order the editor names them. */
export const VISUAL_FIELDS: readonly VisualField[] = ['description', 'setting', 'shot', 'aspect', 'characters', 'items']

/** The picture-deciding fields of a panel, as an image version records them. */
export function visualFields(panel: Pick<Panel, VisualField>): VisualFields {
  return {
    description: panel.description,
    setting: panel.setting,
    shot: panel.shot,
    aspect: panel.aspect,
    characters: panel.characters,
    items: panel.items
  }
}

/**
 * The visual fields that differ from what the current version was drawn from, in `VISUAL_FIELDS` order.
 * Empty when there is no current version or it does not know (`drawnFrom` is null). Layout, dialogue and
 * placement are not visual, so changing them never shows here.
 */
export function staleVisualFields(panel: Panel): VisualField[] {
  const drawnFrom = panel.versions.find((v) => v.id === panel.currentVersionId)?.drawnFrom
  if (!drawnFrom) return []
  return VISUAL_FIELDS.filter((field) => (field === 'aspect' ? drawAspect(panel.aspect) !== drawAspect(drawnFrom.aspect) : JSON.stringify(panel[field]) !== JSON.stringify(drawnFrom[field])))
}
