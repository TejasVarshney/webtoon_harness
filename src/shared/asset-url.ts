// URLs for project files served by the privileged `webtoon-asset` protocol (spec §4):
//   webtoon-asset://<projectId>/<project-relative POSIX path>
// This file is imported by the renderer and the main process, so it uses only the web-standard
// `URL` and no Node modules.

export const ASSET_SCHEME = 'webtoon-asset'

export interface ParsedAssetUrl {
  projectId: string
  /** Decoded, project-relative path. Not yet checked against the project root: that is `ProjectPaths.resolveAsset`'s job. */
  relPath: string
}

/**
 * `encodeURI` leaves `#` and `?` raw, so a name containing one would not round-trip (it would parse
 * as a fragment or query). That cannot happen: every asset is named after ids (spec §5).
 */
export function assetUrl(projectId: string, relPath: string): string {
  return `${ASSET_SCHEME}://${projectId}/${encodeURI(relPath)}`
}

/** Throws on anything that is not a well-formed asset URL with a project id and a non-empty path. */
export function parseAssetUrl(url: string): ParsedAssetUrl {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Malformed asset URL: ${url}`)
  }
  if (parsed.protocol !== `${ASSET_SCHEME}:`) throw new Error(`Not a ${ASSET_SCHEME} URL: ${url}`)
  if (parsed.hostname === '') throw new Error(`Asset URL has no project id: ${url}`)

  let relPath: string
  try {
    relPath = decodeURIComponent(parsed.pathname.slice(1))
  } catch {
    throw new Error(`Asset URL has a malformed escape sequence: ${url}`)
  }
  if (relPath === '') throw new Error(`Asset URL has no path: ${url}`)
  return { projectId: parsed.hostname, relPath }
}
