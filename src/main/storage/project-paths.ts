import path from 'node:path'
import { PathEscapeError } from '../domain/errors'

/** `<prefix>_<alphanumerics>`: no separators, dots or colons, so an id is always a safe file name. */
const ID_PATTERN = /^[a-z]+_[A-Za-z0-9]+$/

/**
 * Every location inside one project folder (spec §5). Ids reach this class from AI tool input and
 * become file names, so each id-taking method validates its id; `resolveAsset` is the equivalent
 * guard for relative paths stored in project JSON. All returned paths are absolute.
 */
export class ProjectPaths {
  readonly root: string

  constructor(root: string) {
    this.root = path.resolve(root)
  }

  projectFile(): string {
    return this.join('project.json')
  }

  storyBible(): string {
    return this.join('story', 'bible.md')
  }

  storyOutline(): string {
    return this.join('story', 'outline.json')
  }

  charactersDir(): string {
    return this.join('characters')
  }

  characterFile(id: string): string {
    return this.join('characters', `${checkedId(id)}.json`)
  }

  characterDir(id: string): string {
    return this.join('characters', checkedId(id))
  }

  episodesDir(): string {
    return this.join('episodes')
  }

  episodeFile(id: string): string {
    return this.join('episodes', `${checkedId(id)}.json`)
  }

  panelsDir(): string {
    return this.join('panels')
  }

  panelFile(id: string): string {
    return this.join('panels', `${checkedId(id)}.json`)
  }

  panelDir(id: string): string {
    return this.join('panels', checkedId(id))
  }

  panelChatFile(id: string): string {
    return this.join('panels', `${checkedId(id)}.chat.jsonl`)
  }

  sessionsDir(): string {
    return this.join('sessions')
  }

  sessionFile(id: string): string {
    return this.join('sessions', `${checkedId(id)}.jsonl`)
  }

  uploadsDir(): string {
    return this.join('uploads')
  }

  agentDocsDir(): string {
    return this.join('agent')
  }

  /**
   * Resolves a project-relative path (as stored in JSON) to an absolute one. Throws
   * `PathEscapeError` for absolute paths, drive-letter or UNC paths, NUL bytes, and anything that
   * resolves outside the project root.
   */
  resolveAsset(relPath: string): string {
    // ':' covers drive letters (`C:\x`, drive-relative `C:x`) and NTFS alternate data streams;
    // assets are named after ids and never contain one.
    if (relPath.includes('\0') || relPath.includes(':') || path.posix.isAbsolute(relPath) || path.win32.isAbsolute(relPath)) {
      throw new PathEscapeError(relPath)
    }
    const resolved = path.resolve(this.root, relPath)
    if (!this.contains(resolved)) throw new PathEscapeError(relPath)
    return resolved
  }

  /** The project-relative POSIX form of an absolute path inside the project, as stored in JSON. */
  toRelative(absPath: string): string {
    const resolved = path.resolve(absPath)
    if (!this.contains(resolved)) throw new PathEscapeError(absPath)
    return path.relative(this.root, resolved).split(path.sep).join('/')
  }

  private join(...segments: string[]): string {
    return path.join(this.root, ...segments)
  }

  private contains(absPath: string): boolean {
    const relative = path.relative(this.root, absPath)
    // Compare whole segments: `..hidden` is a legal name, `..` and `..\x` are not.
    const leavesRoot = relative === '..' || relative.startsWith(`..${path.sep}`)
    return !leavesRoot && !path.isAbsolute(relative)
  }
}

function checkedId(id: string): string {
  if (!ID_PATTERN.test(id)) throw new PathEscapeError(id, 'Invalid id')
  return id
}
