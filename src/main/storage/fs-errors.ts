/** True when a file-system error means "nothing is there": a missing file or folder, or a path that runs through something that is not a folder. */
export function isNotFound(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error ? (error as { code: unknown }).code : undefined
  return code === 'ENOENT' || code === 'ENOTDIR'
}
