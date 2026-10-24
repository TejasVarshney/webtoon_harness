import type { ChatMessage } from '@shared/types'
import { ImageUnavailableError, type ImageLoader } from './types'

/** An image of a replayed message: its data, or a text note standing in for it. */
export type ReplayImage = { kind: 'image'; mime: string; base64: string } | { kind: 'note'; text: string }

/** How many images from before the latest user message are still sent in full (Ruling F2). */
export const EARLIER_IMAGES_KEPT = 4

export const unavailableNote = (relPath: string): string => `[image no longer available: ${relPath}]`
export const omittedNote = (relPath: string): string => `[earlier image omitted: ${relPath}]`

/**
 * Loads one image of the history for a text adapter. An image that is gone for good becomes a note (C1):
 * transcripts are append-only, so a throw here would fail every later turn of the thread.
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

/** The images of message `index` of the history (for a tool message, of its result number `result`), in order. */
export type ReplayImages = (index: number, paths: readonly string[], result?: number) => Promise<ReplayImage[]>

/**
 * Ruling F2, shared by both text adapters: images are sent in full for the latest user message and for the tool
 * results after it (the current run), plus the `EARLIER_IMAGES_KEPT` most recent images before it. Every older
 * image becomes an `[earlier image omitted: <path>]` note and is not loaded, so a long thread stays within the
 * providers' request-size and image-count limits. Indexes refer to `messages`, the array the adapter converts.
 */
export function planImageReplay(messages: readonly ChatMessage[], loadImage: ImageLoader): ReplayImages {
  const slot = (index: number, result: number, image: number): string => `${index}/${result}/${image}`
  const latestUser = messages.findLastIndex((m) => m.role === 'user')
  const earlier: string[] = []
  messages.forEach((m, index) => {
    if (index >= latestUser) return
    if (m.role === 'user') m.imagePaths.forEach((_, image) => earlier.push(slot(index, 0, image)))
    else if (m.role === 'tool') m.results.forEach((res, result) => res.images.forEach((_, image) => earlier.push(slot(index, result, image))))
  })
  const keptEarlier = new Set(earlier.slice(-EARLIER_IMAGES_KEPT))

  return async (index, paths, result = 0) => {
    const out: ReplayImage[] = []
    for (const [image, relPath] of paths.entries()) {
      const full = index >= latestUser || keptEarlier.has(slot(index, result, image))
      out.push(full ? await replayImage(loadImage, relPath) : { kind: 'note', text: omittedNote(relPath) })
    }
    return out
  }
}
