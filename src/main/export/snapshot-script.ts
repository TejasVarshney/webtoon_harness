import type { ExportSnapshot } from '@shared/types'

/**
 * The script main runs in the export window to draw one episode. The snapshot goes in as a JSON string literal that
 * `JSON.parse` reads, so no part of its text (lettering with `</script>`, quotes, U+2028) is ever parsed as code.
 */
export function snapshotScript(snapshot: ExportSnapshot): string {
  return `window.webtoonExport.render(JSON.parse(${JSON.stringify(JSON.stringify(snapshot))}))`
}
