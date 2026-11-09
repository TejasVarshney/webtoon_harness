import type { StyleEntry } from '@shared/ipc'

/** What a project's style is called: the library style with exactly its words, or Custom. A project keeps its own copy of the words, so a later edit to the library style makes this Custom until the user picks it again. */
export function styleNameFor(styles: StyleEntry[], stylePreset: string): string {
  return styles.find((s) => s.text === stylePreset)?.name ?? 'Custom'
}
