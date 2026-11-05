// File names for exported episodes. Pure, and safe on Windows, macOS and Linux.

const MAX_NAME = 120
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** Make text usable as a file name: no path or control characters, no trailing dots or spaces, no reserved names. */
export function safeFileName(text: string): string {
  let name = text.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim()
  name = name.slice(0, MAX_NAME).replace(/[. ]+$/, '')
  if (!name) return 'Untitled'
  // Windows reserves these even with an extension (CON.txt), so test the part before the first dot.
  if (RESERVED.test(name.split('.')[0].trim())) name = `_${name}`
  return name
}

/**
 * Base names (no extension) for an export: one per episode, or a single one for a combined volume.
 * Names are unique, ignoring case, by adding " (2)", " (3)"... to a repeat.
 */
export function outputNames(
  projectTitle: string,
  episodes: { number: number; title: string }[],
  combined: boolean
): string[] {
  const project = safeFileName(projectTitle)
  const raw = combined
    ? [`${project} - Episodes ${Math.min(...episodes.map((e) => e.number))}-${Math.max(...episodes.map((e) => e.number))}`]
    : episodes.map((e) => `${project} - ${String(e.number).padStart(2, '0')} - ${safeFileName(e.title)}`)
  const seen = new Map<string, number>()
  return raw.map((name) => {
    const key = name.toLowerCase()
    const count = (seen.get(key) ?? 0) + 1
    seen.set(key, count)
    return count === 1 ? name : `${name} (${count})`
  })
}
