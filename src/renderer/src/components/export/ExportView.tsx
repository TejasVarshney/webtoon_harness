import type { ExportSnapshot } from '@shared/types'
import { STRIP_CSS_WIDTH } from '@shared/strip-width'
import { StripCanvas } from '../visualizer/StripCanvas'

/**
 * The episode as the export draws it: the strip canvas in export mode, finished panels only, ending exactly at the
 * bottom of the lowest of them (the background and any bubble below that are cut). The page and the strip are
 * STRIP_CSS_WIDTH (440) CSS px wide, as wide as the canvas on screen, so lettering keeps its size relative to the art;
 * the capture scales that to 800 px (export.css reads the width as `--export-strip-width`). The episode's background
 * comes from the snapshot, since this window has no store to read it from.
 * Touches no store action and no `window.api`: the export window has neither a preload nor a project to load.
 */
export function ExportView({ snapshot }: { snapshot: ExportSnapshot }) {
  document.documentElement.style.setProperty('--export-strip-width', `${STRIP_CSS_WIDTH}px`)
  return <StripCanvas episodeId={snapshot.episode.id} panels={snapshot.panels} mode="export" lettering={snapshot.lettering} background={snapshot.episode.background} />
}
