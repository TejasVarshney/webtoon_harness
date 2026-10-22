import { ImageUnavailableError, type ImageLoader } from './types'

/** An image of a replayed message: its data, or a text note standing in for it. */
export type ReplayImage = { kind: 'image'; mime: string; base64: string } | { kind: 'note'; text: string }

export const unavailableNote = (relPath: string): string => `[image no longer available: ${relPath}]`

/**
 * Loads one image of the history for a text adapter (shared by both). An image that is gone for good becomes a
 * note (C1): transcripts are append-only, so a throw here would fail every later turn of the thread.
 */
export async function replayImage(loadImage: ImageLoader, relPath: string): Promise<ReplayImage> {
  try {
    const { mime, base64 } = await loadImage(relPath)
    return { kind: 'image', mime, base64 }
  } catch (error) {
    if (error instanceof ImageUnavailableError) return { kind: 'note', text: unavailableNote(relPath) }
    throw error
  }
}
