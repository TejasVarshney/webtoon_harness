import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { assetUrl } from '@shared/asset-url'
import { aspectRatio } from '@shared/strip-layout'
import type { Panel, PanelAspect } from '@shared/types'
import { useAppStore } from '../../stores/app-store'
import { usePanelsStore } from '../../stores/panels-store'
import { errorText } from '../characters/controls'
import { ShapePicker } from '../panel-editor/ShapePicker'
import { boxArea, fitBox, isWholeImage, moveBox, resizeBox, type CropBox, type CropCorner, type ImageSize } from './crop-box'

const CORNERS: CropCorner[] = ['nw', 'ne', 'sw', 'se']
/** An arrow moves the box by this share of the image; with Shift, ten times as far. */
const KEY_STEP = 0.01

/** Image file types `nativeImage` cannot decode, so main cannot crop them. */
export function croppable(imagePath: string): boolean {
  return !/\.(webp|gif)$/i.test(imagePath)
}

export interface CropDialogProps {
  panel: Panel
  /** The ready version being cropped, and its picture. */
  versionId: string
  imagePath: string
  onClose(): void
}

/**
 * Crops a panel's picture: the picture whole, with a box in the panel's shape over it. Another shape refits the box,
 * and the panel takes that shape when the crop is stored. Dragging the box moves it, dragging a corner resizes it (the
 * far corner stays put), and the arrows move it once it has the focus. Crop stores what the box covers as a new current
 * version, so Versions brings the whole picture back. Escape or Cancel closes it.
 */
export function CropDialog({ panel, versionId, imagePath, onClose }: CropDialogProps) {
  const projectId = useAppStore((s) => s.projectId)
  const [shape, setShape] = useState<PanelAspect>(panel.aspect)
  const ratio = aspectRatio(shape)
  const reshaped = shape !== panel.aspect
  const [image, setImage] = useState<ImageSize | null>(null)
  const [box, setBox] = useState<CropBox | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const drag = useRef<{ kind: 'move' | CropCorner; pointerId: number; x: number; y: number; start: CropBox } | null>(null)

  useEffect(() => dialog.current?.focus({ preventScroll: true }), [])

  function loaded(img: HTMLImageElement): void {
    const size = { width: img.naturalWidth, height: img.naturalHeight }
    if (size.width <= 0 || size.height <= 0) return
    setImage(size)
    setBox(fitBox(size, ratio))
  }

  /** Image pixels per screen pixel, or 0 before the picture is laid out. */
  function scale(): number {
    const shown = frame.current?.getBoundingClientRect().width ?? 0
    return image !== null && shown > 0 ? image.width / shown : 0
  }

  function begin(kind: 'move' | CropCorner, e: PointerEvent<HTMLElement>): void {
    if (e.button !== 0 || box === null) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { kind, pointerId: e.pointerId, x: e.clientX, y: e.clientY, start: box }
  }

  function follow(e: PointerEvent<HTMLElement>): void {
    const d = drag.current
    const k = scale()
    if (d === null || d.pointerId !== e.pointerId || image === null || k === 0) return
    const dx = (e.clientX - d.x) * k
    const dy = (e.clientY - d.y) * k
    setBox(d.kind === 'move' ? moveBox(d.start, dx, dy, image) : resizeBox(d.start, d.kind, dx, dy, image, ratio))
  }

  function end(e: PointerEvent<HTMLElement>): void {
    if (drag.current?.pointerId === e.pointerId) drag.current = null
  }

  /** A crop to the whole picture in the panel's own shape would change nothing. */
  const unchanged = box === null || image === null || (!reshaped && isWholeImage(box, image))

  function pickShape(next: PanelAspect): void {
    setShape(next)
    if (image !== null) setBox(fitBox(image, aspectRatio(next)))
  }

  function apply(): void {
    if (box === null || image === null || busy || unchanged) return
    setBusy(true)
    setError(null)
    usePanelsStore
      .getState()
      .cropPanelImage(panel.id, versionId, boxArea(box, image), reshaped ? shape : undefined)
      .then(onClose, (e: unknown) => {
        setError(errorText(e))
        setBusy(false)
      })
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault()
      apply()
    }
  }

  function onBoxKey(e: KeyboardEvent<HTMLDivElement>): void {
    const way = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
    if (way === undefined || box === null || image === null) return
    e.preventDefault()
    e.stopPropagation()
    const step = (e.shiftKey ? 10 : 1) * KEY_STEP
    setBox(moveBox(box, way[0] * step * image.width, way[1] * step * image.height, image))
  }

  const percent = (v: number, of: number): string => `${(v / of) * 100}%`

  return createPortal(
    // Clicks stop here, in the React tree it shares with the panel's tools, so none reaches the card or the strip.
    <div className="modal-backdrop" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <div ref={dialog} className="modal crop-dialog" role="dialog" aria-label="Crop panel" tabIndex={-1} onKeyDown={onKey}>
        <h2>Crop panel</h2>
        <p className="crop-hint">
          Pick the panel&apos;s shape, then drag the box to frame the picture, or a corner to resize it. The crop is a new version: Versions brings back the whole picture.
        </p>
        <ShapePicker label="Panel shape" value={shape} onChange={pickShape} disabled={busy} />
        <div className="crop-stage">
          <div ref={frame} className="crop-frame" data-testid="crop-frame" onPointerMove={follow} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
            {projectId !== null && (
              <img src={assetUrl(projectId, imagePath)} alt="" draggable={false} onLoad={(e) => loaded(e.currentTarget)} onError={() => setError("The picture couldn't be loaded")} />
            )}
            {box !== null && image !== null && (
              // The shade darkens all but the box, clipped to the picture; the box above it is not, so its corners show whole.
              <div className="crop-shade" aria-hidden="true">
                <div className="crop-hole" style={{ left: percent(box.x, image.width), top: percent(box.y, image.height), width: percent(box.width, image.width), height: percent(box.height, image.height) }} />
              </div>
            )}
            {box !== null && image !== null && (
              <div
                className="crop-box"
                data-testid="crop-box"
                tabIndex={0}
                aria-label="Crop area: drag it, or move it with the arrow keys"
                style={{ left: percent(box.x, image.width), top: percent(box.y, image.height), width: percent(box.width, image.width), height: percent(box.height, image.height) }}
                onPointerDown={(e) => begin('move', e)}
                onKeyDown={onBoxKey}
              >
                {CORNERS.map((corner) => (
                  <span key={corner} className="crop-handle" data-corner={corner} data-testid={`crop-handle-${corner}`} aria-hidden="true" onPointerDown={(e) => begin(corner, e)} />
                ))}
              </div>
            )}
          </div>
        </div>
        {error !== null && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" disabled={box === null || image === null} onClick={() => image !== null && setBox(fitBox(image, ratio))}>
            Reset
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={busy || unchanged} onClick={apply}>
            {busy ? 'Cropping…' : 'Crop'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
