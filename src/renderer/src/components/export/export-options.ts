import type { ExportPreset } from '@shared/types'

export interface VisibleOptions {
  imageType: boolean
  paper: boolean
  resolution: boolean
  combine: boolean
}

/** Which of the dialog's options apply to a preset (spec §5). `combine` also needs two or more episodes ticked. */
export function visibleOptions(preset: ExportPreset, episodeCount: number): VisibleOptions {
  return {
    imageType: preset === 'webtoon' || preset === 'long-image',
    paper: preset === 'pdf-print',
    // Print is always High, so the choice is hidden.
    resolution: preset !== 'pdf-print',
    combine: episodeCount >= 2 && (preset === 'pdf-reading' || preset === 'pdf-print' || preset === 'cbz')
  }
}
