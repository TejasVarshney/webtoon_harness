import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PathEscapeError } from '../domain/errors'
import { ProjectPaths } from './project-paths'

const ROOT = 'C:/x/My Projects/prj_0000000001'
const paths = new ProjectPaths(ROOT)
const abs = (...parts: string[]): string => path.join(path.resolve(ROOT), ...parts)

describe('ProjectPaths layout (spec §5)', () => {
  it('maps every well-known file and directory', () => {
    expect(paths.projectFile()).toBe(abs('project.json'))
    expect(paths.storyBible()).toBe(abs('story', 'bible.md'))
    expect(paths.storyOutline()).toBe(abs('story', 'outline.json'))
    expect(paths.charactersDir()).toBe(abs('characters'))
    expect(paths.characterFile('chr_0000000001')).toBe(abs('characters', 'chr_0000000001.json'))
    expect(paths.characterDir('chr_0000000001')).toBe(abs('characters', 'chr_0000000001'))
    expect(paths.episodesDir()).toBe(abs('episodes'))
    expect(paths.episodeFile('epi_0000000001')).toBe(abs('episodes', 'epi_0000000001.json'))
    expect(paths.panelsDir()).toBe(abs('panels'))
    expect(paths.panelFile('pnl_0000000001')).toBe(abs('panels', 'pnl_0000000001.json'))
    expect(paths.panelDir('pnl_0000000001')).toBe(abs('panels', 'pnl_0000000001'))
    expect(paths.panelChatFile('pnl_0000000001')).toBe(abs('panels', 'pnl_0000000001.chat.jsonl'))
    expect(paths.sessionsDir()).toBe(abs('sessions'))
    expect(paths.sessionFile('ses_0000000001')).toBe(abs('sessions', 'ses_0000000001.jsonl'))
    expect(paths.uploadsDir()).toBe(abs('uploads'))
    expect(paths.agentDocsDir()).toBe(abs('agent'))
  })
})

describe('ProjectPaths id guard (ruling T3a)', () => {
  const idMethods: [string, (id: string) => string][] = [
    ['characterFile', (id) => paths.characterFile(id)],
    ['characterDir', (id) => paths.characterDir(id)],
    ['episodeFile', (id) => paths.episodeFile(id)],
    ['panelFile', (id) => paths.panelFile(id)],
    ['panelDir', (id) => paths.panelDir(id)],
    ['panelChatFile', (id) => paths.panelChatFile(id)],
    ['sessionFile', (id) => paths.sessionFile(id)]
  ]
  const badIds = ['', '..', '../x', 'pnl_1/../..', 'pnl_1\\..\\..', 'pnl_1/x', '/abs', 'C:\\x', 'pnl', 'pnl_', '_abc', 'PNL_1', 'pnl_1.json', 'pnl_1 ', 'pnl_1\0']

  it('rejects traversal through ids', () => {
    expect(() => paths.panelFile('../x')).toThrow(PathEscapeError)
    expect(() => paths.panelFile('pnl_1/../..')).toThrow(PathEscapeError)
  })

  it.each(idMethods)('%s rejects anything that is not <prefix>_<alphanumerics>', (_name, fn) => {
    for (const bad of badIds) {
      expect(() => fn(bad), JSON.stringify(bad)).toThrow(PathEscapeError)
    }
  })

  it.each(idMethods)('%s accepts a well-formed id', (_name, fn) => {
    expect(() => fn('chr_0123456789')).not.toThrow()
    expect(() => fn('pnl_1')).not.toThrow()
  })
})

describe('ProjectPaths.resolveAsset / toRelative', () => {
  it('guards traversal and handles spaces', () => {
    expect(() => paths.resolveAsset('../other/file.png')).toThrow(PathEscapeError)
    expect(paths.toRelative(paths.resolveAsset('panels/pnl_1/ver 1.png'))).toBe('panels/pnl_1/ver 1.png')
  })

  it('resolves inside the root', () => {
    expect(paths.resolveAsset('panels/pnl_1/ver 1.png')).toBe(abs('panels', 'pnl_1', 'ver 1.png'))
    expect(paths.resolveAsset('panels/../characters/x.png')).toBe(abs('characters', 'x.png'))
  })

  it('rejects paths that leave the root', () => {
    for (const bad of ['..', '../x', 'panels/../../x', 'a/../../b']) {
      expect(() => paths.resolveAsset(bad), bad).toThrow(PathEscapeError)
    }
  })

  it('rejects paths that resolve to the project root itself (I4)', () => {
    for (const bad of ['', '.', './', 'characters/..', 'panels/../.', 'uploads/../']) {
      expect(() => paths.resolveAsset(bad), JSON.stringify(bad)).toThrow(PathEscapeError)
    }
  })

  it('rejects absolute, drive-relative, drive-letter and UNC paths', () => {
    const bad = ['/etc/passwd', '\\windows\\x', 'C:\\Windows\\x.png', 'C:/Windows/x.png', 'c:foo.png', 'D:', '\\\\srv\\share\\x.png', '//srv/share/x.png', 'panels/a:stream']
    for (const p of bad) {
      expect(() => paths.resolveAsset(p), p).toThrow(PathEscapeError)
    }
  })

  it('rejects an absolute path even when it points inside the root', () => {
    expect(() => paths.resolveAsset(abs('panels', 'x.png'))).toThrow(PathEscapeError)
  })

  it('rejects NUL bytes', () => {
    expect(() => paths.resolveAsset('panels/x\0.png')).toThrow(PathEscapeError)
  })

  it('does not mistake a dotted file name for traversal', () => {
    expect(paths.toRelative(paths.resolveAsset('..hidden/x.png'))).toBe('..hidden/x.png')
  })

  it('toRelative returns POSIX separators and rejects paths outside the root', () => {
    expect(paths.toRelative(abs('panels', 'pnl_1', 'v.png'))).toBe('panels/pnl_1/v.png')
    expect(() => paths.toRelative(path.resolve(ROOT, '..', 'other.png'))).toThrow(PathEscapeError)
  })
})

describe('ProjectPaths on Windows', () => {
  it.runIf(process.platform === 'win32')('treats a backslash as a separator, so backslash traversal is caught', () => {
    expect(() => paths.resolveAsset('..\\x')).toThrow(PathEscapeError)
    expect(() => paths.resolveAsset('panels\\..\\..\\x')).toThrow(PathEscapeError)
  })
})
