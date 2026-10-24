import fs from 'node:fs'
import path from 'node:path'
import { EntityNotFoundError, PathEscapeError } from '../domain/errors'
import { writeFileAtomic } from '../storage/atomic'
import type { ProjectContext } from '../storage/project-store'
import { isNotFound } from '../storage/fs-errors'

const AGENTS = 'AGENTS.md'

/** Every file under `dir` as POSIX paths relative to it, sorted. A missing dir is empty. */
async function walk(dir: string, prefix = ''): Promise<string[]> {
  let entries: fs.Dirent[]
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (isNotFound(error)) return []
    throw error
  }
  const out: string[] = []
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), rel)))
    else if (e.isFile()) out.push(rel)
  }
  return out.sort()
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.promises.access(p)
    return true
  } catch {
    return false
  }
}

function firstHeading(markdown: string): string | null {
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^# (.+?)\s*$/.exec(line)
    if (m) return m[1]
  }
  return null
}

/** The regulating `.md` files: shipped templates, copied into each project's `agent/` folder, editable per project. */
export class WorkflowDocs {
  constructor(private readonly templatesDir: string) {}

  /** Copies the templates the project does not have yet; existing (possibly edited) files are kept. */
  install(ctx: ProjectContext): Promise<void> {
    return this.copy(ctx, false)
  }

  /** Overwrites every shipped file with its template. */
  reset(ctx: ProjectContext): Promise<void> {
    return this.copy(ctx, true)
  }

  /** The project's docs by name (path without `.md`) and title, sorted. AGENTS.md is left out unless `includeAgents`: the system prompt carries it whole. */
  async list(ctx: ProjectContext, opts: { includeAgents?: boolean } = {}): Promise<{ name: string; title: string }[]> {
    const dir = ctx.paths.agentDocsDir()
    const out: { name: string; title: string }[] = []
    for (const rel of await walk(dir)) {
      if (!rel.endsWith('.md') || (rel === AGENTS && opts.includeAgents !== true)) continue
      const name = rel.slice(0, -'.md'.length)
      out.push({ name, title: firstHeading(await fs.promises.readFile(path.join(dir, ...rel.split('/')), 'utf8')) ?? name })
    }
    return out
  }

  /** The absolute path of the doc `name` (no `.md`) in the project's docs folder. Throws PathEscapeError for a name that leaves it. */
  filePath(ctx: ProjectContext, name: string): string {
    const dir = ctx.paths.agentDocsDir()
    const abs = path.resolve(dir, `${name}.md`)
    const rel = path.relative(dir, abs)
    if (name.includes('\0') || name.includes(':') || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new PathEscapeError(name, 'Invalid doc name')
    }
    return abs
  }

  async read(ctx: ProjectContext, name: string): Promise<string> {
    const abs = this.filePath(ctx, name)
    try {
      return await fs.promises.readFile(abs, 'utf8')
    } catch (error) {
      if (isNotFound(error)) throw new EntityNotFoundError('doc', name)
      throw error
    }
  }

  agentsMd(ctx: ProjectContext): Promise<string> {
    return this.read(ctx, 'AGENTS')
  }

  private async copy(ctx: ProjectContext, overwrite: boolean): Promise<void> {
    const dir = ctx.paths.agentDocsDir()
    for (const rel of await walk(this.templatesDir)) {
      const target = path.join(dir, ...rel.split('/'))
      await ctx.mutex.run(target, async () => {
        if (!overwrite && (await exists(target))) return
        await fs.promises.mkdir(path.dirname(target), { recursive: true })
        await writeFileAtomic(target, await fs.promises.readFile(path.join(this.templatesDir, ...rel.split('/'))))
      })
    }
  }
}
