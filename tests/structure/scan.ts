// Pure helpers behind repo-rules.test.ts. Paths are repo-relative with forward slashes.

export interface ImportRef {
  specifier: string
  typeOnly: boolean
}

// `import`/`export` statements that have a `from`. Only statements that begin a line count, which leaves out `//` and
// ` * ` comment lines. Comments are not stripped first: a string like 'src/**/*.ts' holds `/*` and would swallow code.
const FROM_STATEMENT = /^[ \t]*(?:import|export)\s+(type\s+)?(\*(?:\s+as\s+[\w$]+)?|\{[^}]*\}|[\w$]+(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+[\w$]+))?)\s+from\s*['"]([^'"]+)['"]/gm
const SIDE_EFFECT_IMPORT = /^[ \t]*import\s*['"]([^'"]+)['"]/gm
const DYNAMIC_IMPORT = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/

/** True for `{ type A, type B }`: every name in the braces is type-only, so nothing is imported at runtime. */
function allNamesAreTypes(clause: string): boolean {
  if (!clause.startsWith('{')) return false
  const names = clause
    .slice(1, -1)
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  return names.length > 0 && names.every((name) => /^type\s/.test(name))
}

export function importsOf(source: string): ImportRef[] {
  const refs: ImportRef[] = []
  for (const [, typeKeyword, clause, specifier] of source.matchAll(FROM_STATEMENT)) {
    refs.push({ specifier, typeOnly: typeKeyword !== undefined || allNamesAreTypes(clause) })
  }
  for (const [, specifier] of source.matchAll(SIDE_EFFECT_IMPORT)) refs.push({ specifier, typeOnly: false })
  for (const line of source.split('\n')) {
    if (COMMENT_LINE.test(line)) continue
    for (const [, specifier] of line.matchAll(DYNAMIC_IMPORT)) refs.push({ specifier, typeOnly: false })
  }
  return refs
}

const toForward = (p: string): string => p.split('\\').join('/')

/** Collapses `.` and `..` in a repo-relative path. */
function normalize(p: string): string {
  const parts: string[] = []
  for (const part of p.split('/')) {
    if (part === '.' || part === '') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

/** The repo-relative source file an import names. Null for packages and for anything that is not TypeScript. */
export function resolveImport(fromRepoPath: string, specifier: string, exists: (repoPath: string) => boolean): string | null {
  let base: string
  if (specifier.startsWith('@shared/')) base = `src/shared/${specifier.slice('@shared/'.length)}`
  else if (specifier.startsWith('.')) {
    const from = toForward(fromRepoPath)
    base = normalize(`${from.slice(0, from.lastIndexOf('/'))}/${specifier}`)
  } else return null
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (/\.tsx?$/.test(candidate) && exists(candidate)) return candidate
  }
  return null
}

/** The layer a source file belongs to: `src/shared`, `src/renderer`, `src/preload`, or `main/<folder or file>`. */
export function areaOf(repoPath: string): string | null {
  const parts = toForward(repoPath).split('/')
  if (parts[0] !== 'src') return null
  if (parts[1] === 'main') return parts[2] === undefined ? null : `main/${parts[2]}`
  return ['shared', 'renderer', 'preload'].includes(parts[1]) ? `src/${parts[1]}` : null
}

/** Every import cycle in the graph, as the files on it. One per back edge, which is enough to report and break. */
export function findCycles(graph: Map<string, string[]>): string[][] {
  const cycles: string[][] = []
  const done = new Set<string>()
  const path: string[] = []
  const visit = (node: string): void => {
    const at = path.indexOf(node)
    if (at >= 0) {
      cycles.push(path.slice(at))
      return
    }
    if (done.has(node)) return
    path.push(node)
    for (const next of graph.get(node) ?? []) visit(next)
    path.pop()
    done.add(node)
  }
  for (const node of graph.keys()) visit(node)
  return cycles
}

const REPO_PATH = /^(?:src|tests|tools|docs|resources|integrations)\//
const NPM_RUN = /^npm run ([\w:-]+)$/

/**
 * The backticked paths and `npm run` scripts in a markdown file that do not exist. Placeholders and globs are not
 * paths, and `.claude/` and `out/` are left out because a clean checkout does not have all of them.
 */
export function missingDocRefs(markdown: string, exists: (repoPath: string) => boolean, scripts: Set<string>): string[] {
  const missing: string[] = []
  for (const [, token] of markdown.matchAll(/`([^`\n]+)`/g)) {
    const script = NPM_RUN.exec(token)
    if (script) {
      if (!scripts.has(script[1])) missing.push(token)
    } else if (!/[<*]/.test(token) && (REPO_PATH.test(token) || token === 'README.md') && !exists(token)) {
      missing.push(token)
    }
  }
  return missing
}

// The labels of finished plans and rulings: `Ruling T18f`, `Ruling 3`, `Review Focus 2`, `spec §9`, `Task 25`, `(I4)`, `// R3:`, ` * I1:`.
const PLAN_LABEL = /\b[Rr]uling [A-Z]?\d|\bReview Focus\b|§\s?\d|\bTask \d+\b|\([CFIPRT]\d{1,2}[a-z]?[,)]|(?:^\s*\*|\/\/|\/\*\*?)\s*[CFIPRT]\d{1,2}[a-z]?:/gm

export function stalePointers(source: string): string[] {
  return source.match(PLAN_LABEL) ?? []
}
