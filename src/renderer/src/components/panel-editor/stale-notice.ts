import type { VisualField } from '@shared/types'

/** What the editor calls each visual field. */
const LABELS: Record<VisualField, string> = {
  description: 'Description',
  setting: 'Setting',
  shot: 'Shot',
  aspect: 'Aspect',
  characters: 'Cast',
  items: 'Items'
}

/**
 * The notice over a panel whose picture no longer shows what the panel says, such as
 * `Description, cast and items changed since this image was drawn.` Null when nothing changed.
 */
export function staleNotice(fields: VisualField[]): string | null {
  if (fields.length === 0) return null
  const names = fields.map((f) => LABELS[f].toLowerCase())
  const joined = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)} changed since this image was drawn.`
}
