// What the character, item and panel services share when they record an image, and the timestamp every service stamps.

export const INTERRUPTED = 'Interrupted: the app closed during generation'

/** A sheet created without a generation has nothing that would ever move it out of `pending`, so it starts `failed` with this. */
export const NO_IMAGE_YET = 'No image yet: upload one or regenerate'

export const UPLOAD_EXTS = ['png', 'jpg', 'webp'] as const
export type UploadExt = (typeof UPLOAD_EXTS)[number]

export const now = (): string => new Date().toISOString()

export function failureMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return 'Cancelled'
  return error instanceof Error && error.message ? error.message : String(error)
}
