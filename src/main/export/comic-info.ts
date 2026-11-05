// ComicInfo.xml, the metadata file comic readers look for inside a CBZ.

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** The ComicInfo.xml for one CBZ. Number and Summary are left out when not given. */
export function comicInfoXml(meta: {
  series: string
  title: string
  number?: number
  summary?: string
  pageCount: number
}): string {
  const fields: [string, string | undefined][] = [
    ['Series', meta.series],
    ['Title', meta.title],
    ['Number', meta.number === undefined ? undefined : String(meta.number)],
    ['Summary', meta.summary],
    ['PageCount', String(meta.pageCount)],
    ['Manga', 'No']
  ]
  const body = fields
    .filter((f): f is [string, string] => f[1] !== undefined)
    .map(([tag, value]) => `<${tag}>${escapeXml(value)}</${tag}>`)
    .join('')
  return `<?xml version="1.0" encoding="utf-8"?><ComicInfo>${body}</ComicInfo>`
}
