// Section editing for the story bible. A section is a `## Heading` line (column 0, one hash pair and a
// space) and everything up to the next such line. `###` and deeper headings are ordinary body text.
// Line endings are `\n`: project files are LF (Ruling P2), and nothing here converts anything.

/** The heading text of a `## ` line, or null when the line is not a section heading (indented, `###`, or nothing after the hashes). */
function headingOf(line: string): string | null {
  if (!line.startsWith('## ')) return null
  const name = line.slice(3).trim()
  return name === '' ? null : name
}

const sameHeading = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/** The section headings in document order, as written. */
export function listSections(md: string): string[] {
  const out: string[] = []
  for (const line of md.split('\n')) {
    const name = headingOf(line)
    if (name !== null) out.push(name)
  }
  return out
}

/**
 * The heading to use for `name`: trimmed, and without leading markdown hashes (a model often echoes the `## Premise` line it just
 * read; `#1 Theory` has no space after the hash and is a plain name). Throws when it is empty or spans lines.
 */
export function checkedHeading(name: string): string {
  const heading = name.trim().replace(/^#+(?:[ \t]+|$)/, '').trim()
  if (heading === '' || /[\r\n]/.test(heading)) throw new Error('A section heading must be one non-empty line')
  return heading
}

/** Content without leading blank lines (the first line's own indent stays) or trailing whitespace; no lines at all for nothing. */
function bodyLines(content: string): string[] {
  const body = content.replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd()
  return body === '' ? [] : body.split('\n')
}

/**
 * Replaces the body of the `## <heading>` section (matched case-insensitively, the document keeps its own
 * spelling of the heading) or appends the section when it is missing. The first section of that name wins when
 * a hand-edited document has two. A replaced body is followed by exactly one blank line before the next
 * heading; everything else, including whether the document ends in a newline, is left as it was.
 */
export function upsertMarkdownSection(md: string, heading: string, content: string): string {
  const wanted = checkedHeading(heading)
  const endsWithNewline = md === '' || md.endsWith('\n')
  const lines = md === '' ? [] : (md.endsWith('\n') ? md.slice(0, -1) : md).split('\n')
  const body = bodyLines(content)

  const start = lines.findIndex((line) => {
    const name = headingOf(line)
    return name !== null && sameHeading(name, wanted)
  })

  let out: string[]
  if (start === -1) {
    // Blank lines at the end of the document would stack on top of the separator.
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop()
    out = [...lines, ...(lines.length > 0 ? [''] : []), `## ${wanted}`, ...body]
  } else {
    let end = start + 1
    while (end < lines.length && headingOf(lines[end]) === null) end++
    // The section after this one is kept apart by a blank line; at the end of the document there is nothing to separate.
    out = [...lines.slice(0, start + 1), ...body, ...(end < lines.length ? [''] : []), ...lines.slice(end)]
  }
  return out.join('\n') + (endsWithNewline ? '\n' : '')
}
