import path from 'node:path'

export interface LocateClaudeOptions {
  /** The path set in Settings → Plugins; '' when unset. */
  configured: string
  /** Resolves a command on PATH, null when absent. */
  pathLookup: (cmd: string) => string | null
  /** %APPDATA% */
  appData: string
  exists: (p: string) => boolean
  /** Entry names of a directory; [] when it cannot be read. */
  listDir: (p: string) => string[]
}

/** Compares dotted version names part by part as numbers, so 2.1.309 is newer than 2.1.99. */
function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** The Claude Code executable: the configured path, then PATH, then the newest desktop-app install. */
export function locateClaude(opts: LocateClaudeOptions): string | null {
  if (opts.configured && opts.exists(opts.configured)) return opts.configured
  const onPath = opts.pathLookup('claude')
  if (onPath) return onPath

  const base = path.win32.join(opts.appData, 'Claude', 'claude-code')
  const versions = opts
    .listDir(base)
    .filter((name) => /^\d+(\.\d+)*$/.test(name))
    .sort((a, b) => compareVersions(b, a))
  for (const version of versions) {
    for (const hash of opts.listDir(path.win32.join(base, version))) {
      const exe = path.win32.join(base, version, hash, 'claude.exe')
      if (opts.exists(exe)) return exe
    }
  }
  return null
}
