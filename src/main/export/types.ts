// The two seams between an export job and Electron. ExportService only talks to these, so it is tested with fakes.

import type { ExportSnapshot, ViewLayout } from '@shared/types'
import type { Bitmap } from './long-image'
import type { Slice } from './slice-plan'

/** Draws a strip snapshot in an 800 CSS px wide view and captures horizontal slices of it. One per job. */
export interface StripCapturer {
  /** Prepare the view (the offscreen window). Called once per job, before the first `render`. */
  open(): Promise<void>
  /** Draw one episode and resolve once it is painted, or reject (a failed image, a crash, `timeoutMs` passed). */
  render(snapshot: ExportSnapshot, timeoutMs: number): Promise<ViewLayout>
  /** The image of `slice` (CSS px) at `scale` device px per CSS px. */
  capture(slice: Slice, scale: 1 | 2, format: 'jpeg' | 'png'): Promise<Buffer>
  /** Release the view. Called once however the job ends, and safe to call twice. */
  close(): Promise<void>
}

/** Image decoding and encoding (Electron's `nativeImage` in the app). JPEG is encoded at quality 90. */
export interface ImageCodec {
  /** Decode an image to raw BGRA. */
  toBitmap(png: Buffer): Bitmap
  encode(b: Bitmap, format: 'jpeg' | 'png'): Buffer
  /** An encoded image's size in device px. */
  size(img: Buffer): { width: number; height: number }
}
