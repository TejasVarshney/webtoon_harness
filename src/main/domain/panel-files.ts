import fs from 'node:fs'
import path from 'node:path'
import { PanelSchema } from '@shared/schemas'
import type { Panel } from '@shared/types'
import { readJson } from '../storage/atomic'
import { isNotFound } from '../storage/fs-errors'
import type { ProjectContext } from '../storage/project-store'
import { CorruptFileError, EntityNotFoundError } from './errors'

// Reading panel files (`panels/<pnlId>.json`) and reporting the ones that cannot be read.

const PANEL_FILE = /^pnl_[A-Za-z0-9]+\.json$/

/** Reads a panel file and checks that it holds the id its file name says. */
export async function readPanelFile(file: string, id: string): Promise<Panel> {
  const panel = await readJson(file, PanelSchema)
  if (panel.id !== id) throw new CorruptFileError(file, `holds panel id ${JSON.stringify(panel.id)}, which does not match its file name`)
  return panel
}

export async function getPanel(ctx: ProjectContext, id: string): Promise<Panel> {
  try {
    return await readPanelFile(ctx.paths.panelFile(id), id)
  } catch (error) {
    if (isNotFound(error)) throw new EntityNotFoundError('panel', id)
    throw error
  }
}

/** The panel, or null if it is missing or unreadable (an unreadable file is reported in `ctx.problems`). */
export async function tryReadPanel(ctx: ProjectContext, id: string): Promise<Panel | null> {
  let file: string
  try {
    file = ctx.paths.panelFile(id)
  } catch {
    return null // a malformed id in a hand-edited episode names no panel
  }
  try {
    return await readPanelFile(file, id)
  } catch (error) {
    if (!isNotFound(error)) reportProblem(ctx, file, error)
    return null
  }
}

/** Every readable panel file in `panels/` (ids verified against the file names), whether or not an episode lists it. */
export async function scanPanels(ctx: ProjectContext): Promise<Panel[]> {
  let names: string[]
  try {
    names = await fs.promises.readdir(ctx.paths.panelsDir())
  } catch (error) {
    if (isNotFound(error)) return []
    throw error
  }
  const panels: Panel[] = []
  for (const name of names) {
    if (!PANEL_FILE.test(name)) continue
    const abs = path.join(ctx.paths.panelsDir(), name)
    try {
      // The id comes from the file name; a file holding any other id is reported and skipped.
      panels.push(await readPanelFile(abs, name.slice(0, -'.json'.length)))
    } catch (error) {
      if (!isNotFound(error)) reportProblem(ctx, abs, error)
    }
  }
  return panels
}

/** Records an unreadable file in `ctx.problems`. Never throws, so callers can use it from a catch block. */
export function reportProblem(ctx: ProjectContext, abs: string, error: unknown): void {
  let rel: string
  try {
    rel = ctx.paths.toRelative(abs)
  } catch {
    rel = abs
  }
  if (!ctx.problems.some((p) => p.path === rel)) ctx.problems.push({ path: rel, message: error instanceof Error ? error.message : String(error) })
}
