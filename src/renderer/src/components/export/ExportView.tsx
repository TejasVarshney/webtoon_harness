import type { ExportSnapshot } from '@shared/types'
import { exportRows } from '@shared/strip-layout'
import { STRIP_CSS_WIDTH } from '@shared/strip-width'
import { WebtoonStrip } from '../visualizer/WebtoonStrip'

/**
 * The episode as the export draws it: the strip in export mode, finished panels only. The page and the strip are
 * STRIP_CSS_WIDTH (440) CSS px wide, as wide as the strip's rows on screen, so lettering and gaps keep their size
 * relative to the art; the capture scales that to 800 px (export.css reads the width as `--export-strip-width`).
 * The page background follows the first row's gutter, so nothing outside the bands shows a different colour.
 * Touches no store action and no `window.api`: the export window has neither a preload nor a project to load.
 */
export function ExportView({ snapshot }: { snapshot: ExportSnapshot }) {
  const rows = exportRows(snapshot.panels)
  document.documentElement.style.setProperty('--export-strip-width', `${STRIP_CSS_WIDTH}px`)
  document.body.style.background = rows[0]?.gutter === 'black' ? '#000' : '#fff'
  return <WebtoonStrip panels={snapshot.panels} rows={rows} lettering={snapshot.lettering} />
}
