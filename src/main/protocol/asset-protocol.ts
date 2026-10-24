import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { ASSET_SCHEME, parseAssetUrl, type ParsedAssetUrl } from '@shared/asset-url'
import { EntityNotFoundError, PathEscapeError } from '../domain/errors'
import type { ProjectStore } from '../storage/project-store'

// Kept thin on purpose: this is the only module here that imports electron, so everything it
// builds on (`parseAssetUrl`, `ProjectStore`, `ProjectPaths.resolveAsset`) is unit-tested without
// it. The handler itself is exercised by the e2e tests.

/**
 * Registers `webtoon-asset` as a privileged scheme. Must run before the app's `ready` event, so
 * call it at module top level in the main entry.
 */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])
}

function status(code: number, body: string): Response {
  return new Response(body, { status: code, headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

/**
 * Serves `webtoon-asset://<projectId>/<relPath>` from the project folder. 403 for a malformed URL
 * or a path that leaves the project, 404 for an unknown project or a missing file. Call after
 * `app.whenReady()`.
 */
export function handleAssetProtocol(store: ProjectStore): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    let parsed: ParsedAssetUrl
    try {
      parsed = parseAssetUrl(request.url)
    } catch {
      return status(403, 'Forbidden')
    }

    let absPath: string
    try {
      const ctx = await store.open(parsed.projectId)
      absPath = ctx.paths.resolveAsset(parsed.relPath)
    } catch (error) {
      if (error instanceof EntityNotFoundError) return status(404, 'Not found')
      if (error instanceof PathEscapeError) return status(403, 'Forbidden')
      console.error(`Asset request for ${request.url} failed`, error)
      return status(500, 'Internal error')
    }

    // A directory would otherwise be answered with a listing, and a missing file makes net.fetch reject.
    const stats = await fs.promises.stat(absPath).catch(() => null)
    if (!stats?.isFile()) return status(404, 'Not found')
    try {
      return await net.fetch(pathToFileURL(absPath).toString())
    } catch {
      return status(404, 'Not found')
    }
  })
}
