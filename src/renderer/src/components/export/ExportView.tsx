import type { ExportSnapshot } from '@shared/types'
import { exportRows } from '@shared/strip-layout'
import { WebtoonStrip } from '../visualizer/WebtoonStrip'

/**
 * The episode as the export draws it: the strip in export mode, finished panels only. The page background follows
 * the first row's gutter, so nothing outside the bands shows a different colour. Touches no store action and no
 * `window.api`: the export window has neither a preload nor a project to load.
 */
export function ExportView({ snapshot }: { snapshot: ExportSnapshot }) {
  const rows = exportRows(snapshot.panels)
  document.body.style.background = rows[0]?.gutter === 'black' ? '#000' : '#fff'
  return <WebtoonStrip episodeId={snapshot.episode.id} panels={snapshot.panels} rows={rows} mode="export" lettering={snapshot.lettering} />
}
