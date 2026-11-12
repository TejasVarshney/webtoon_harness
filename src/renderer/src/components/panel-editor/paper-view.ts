// Where the sketch paper sits in its frame, and how big. Pure: no React, so the rules are easy to test.
// Every length is in CSS px of the frame; a view's x and y are the paper's top-left corner in the frame.

export interface Frame {
  width: number
  height: number
}

export interface PaperView {
  /** Relative to the fit: 1 is the whole paper as large as the frame allows. */
  zoom: number
  x: number
  y: number
}

/** The paper at the fit: as large as fits the frame at `ratio` (width over height). */
export function fitSize(frame: Frame, ratio: number): Frame {
  if (frame.width <= 0 || frame.height <= 0 || !(ratio > 0)) return { width: 0, height: 0 }
  const width = Math.min(frame.width, frame.height * ratio)
  return { width, height: width / ratio }
}

export function paperSize(zoom: number, frame: Frame, ratio: number): Frame {
  const fit = fitSize(frame, ratio)
  return { width: fit.width * zoom, height: fit.height * zoom }
}

/** How much of the paper a pan always leaves in the frame: this share of the paper, or of the frame when that is smaller. */
const KEEP_IN_VIEW = 0.25

/**
 * Keeps the paper in sight along one axis: it moves freely, past either edge of the frame, until only a quarter of it
 * (or of the frame, for a paper larger than the frame) is left in view, so there is always some of it to drag back.
 */
export function clampAxis(position: number, paper: number, frame: number): number {
  const keep = Math.min(paper, frame) * KEEP_IN_VIEW
  const low = keep - paper
  const high = frame - keep
  return low > high ? (low + high) / 2 : Math.min(high, Math.max(low, position))
}

function clampView(view: PaperView, frame: Frame, ratio: number): PaperView {
  const size = paperSize(view.zoom, frame, ratio)
  return { zoom: view.zoom, x: clampAxis(view.x, size.width, frame.width), y: clampAxis(view.y, size.height, frame.height) }
}

/** The paper at `zoom`, in the middle of the frame. */
export function centred(zoom: number, frame: Frame, ratio: number): PaperView {
  const size = paperSize(zoom, frame, ratio)
  return { zoom, x: (frame.width - size.width) / 2, y: (frame.height - size.height) / 2 }
}

/** Zooms to `zoom`, keeping the point of the paper under `at` (a point of the frame) where it is, then keeps it in sight. */
export function zoomAt(view: PaperView, zoom: number, at: { x: number; y: number }, frame: Frame, ratio: number): PaperView {
  const k = zoom / view.zoom
  return clampView({ zoom, x: at.x - (at.x - view.x) * k, y: at.y - (at.y - view.y) * k }, frame, ratio)
}

/** Moves the paper by a drag's travel, as far as it stays in sight. */
export function panBy(view: PaperView, dx: number, dy: number, frame: Frame, ratio: number): PaperView {
  return clampView({ zoom: view.zoom, x: view.x + dx, y: view.y + dy }, frame, ratio)
}
