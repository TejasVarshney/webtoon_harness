import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { areaOf, findCycles, importsOf, missingDocRefs, resolveImport, stalePointers } from './scan'

// Rules the compiler can't state, applied to the real tree. Each failure message says how to fix it.

const ROOT = path.resolve(__dirname, '../..')
const MAX_LINES = 500
const MAX_INSTRUCTION_LINES = 80

/** Runtime imports each layer may make. Areas not listed (main/index.ts, main/services.ts, main/test) wire things up and are free. */
const ALLOWED: Record<string, string[]> = {
  'src/shared': [],
  'src/preload': ['src/shared'],
  'src/renderer': ['src/shared'],
  'main/events': ['src/shared'],
  'main/storage': ['main/domain', 'src/shared'],
  'main/models': ['main/domain', 'main/storage', 'src/shared'],
  'main/domain': ['main/models', 'main/storage', 'src/shared'],
  'main/export': ['main/storage', 'src/shared'],
  'main/sessions': ['main/domain', 'main/storage', 'src/shared'],
  'main/agent': ['main/domain', 'main/models', 'main/storage', 'src/shared'],
  'main/plugins': ['main/agent', 'main/domain', 'main/models', 'main/storage', 'src/shared'],
  'main/protocol': ['main/domain', 'src/shared'],
  'main/ipc': ['main/domain', 'main/models', 'main/plugins', 'main/storage', 'src/shared']
}

const ELECTRON_ALLOWED = new Set([
  'src/main/domain/electron-image-ops.ts',
  'src/main/domain/electron-pack-composer.ts',
  'src/main/export/electron-codec.ts',
  'src/main/export/offscreen-capturer.ts',
  'src/main/index.ts',
  'src/main/models/electron-encryptor.ts',
  'src/main/protocol/asset-protocol.ts',
  'src/preload/index.ts'
])

const exists = (repoPath: string): boolean => fs.existsSync(path.join(ROOT, repoPath))
const read = (repoPath: string): string => fs.readFileSync(path.join(ROOT, repoPath), 'utf8')

function walk(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const repoPath = `${dir}/${entry.name}`
    return entry.isDirectory() ? walk(repoPath) : [repoPath]
  })
}

const isCode = (repoPath: string): boolean => /\.tsx?$/.test(repoPath)
const isTest = (repoPath: string): boolean => /\.test\.tsx?$/.test(repoPath)
const productionFiles = walk('src').filter((f) => isCode(f) && !isTest(f))

const runtimeImports = (file: string): string[] =>
  importsOf(read(file))
    .filter((ref) => !ref.typeOnly)
    .map((ref) => ref.specifier)

describe('the repo keeps its structure', () => {
  it('imports only from allowed layers at runtime', () => {
    const violations = productionFiles.flatMap((file) => {
      const area = areaOf(file)
      const allowed = area === null ? undefined : ALLOWED[area]
      if (allowed === undefined) return []
      return runtimeImports(file).flatMap((specifier) => {
        const resolved = resolveImport(file, specifier, exists)
        const target = resolved === null ? null : areaOf(resolved)
        if (target === null || target === area || allowed.includes(target)) return []
        return [`${file} imports ${target} at runtime; ${area} may import only ${allowed.join(', ') || 'itself'}. Use \`import type\` if only the type is needed, or move the shared piece down a layer.`]
      })
    })
    expect(violations).toEqual([])
  })

  it('keeps Electron and Node APIs where they belong', () => {
    const violations = productionFiles.flatMap((file) =>
      runtimeImports(file).flatMap((specifier) => {
        if (specifier === 'electron' && !ELECTRON_ALLOWED.has(file)) {
          return [`${file} imports electron. Services stay testable without Electron: inject this through the options, as ImageOps and Encryptor do.`]
        }
        if (specifier.startsWith('node:') && (file.startsWith('src/renderer/') || file.startsWith('src/shared/'))) {
          return [`${file} imports ${specifier}. This code runs in the renderer, which has no Node APIs: put the work in the main process behind an IPC channel.`]
        }
        return []
      })
    )
    expect(violations).toEqual([])
  })

  it('has no runtime import cycles', () => {
    const graph = new Map(
      productionFiles.map((file) => [
        file,
        runtimeImports(file)
          .map((specifier) => resolveImport(file, specifier, exists))
          .filter((target): target is string => target !== null)
      ])
    )
    const violations = findCycles(graph).map((cycle) => `Import cycle: ${cycle.join(' -> ')}. Break it with \`import type\`, or move what both sides need into a lower module.`)
    expect(violations).toEqual([])
  })

  it(`keeps production files to ${MAX_LINES} lines`, () => {
    const violations = productionFiles.flatMap((file) => {
      const lines = read(file).split('\n').length - 1
      if (lines <= MAX_LINES) return []
      return [`${file} has ${lines} lines (limit ${MAX_LINES}). Split it by responsibility, as panel-service.ts was split into panel-files.ts and panel-recording.ts.`]
    })
    expect(violations).toEqual([])
  })

  it('has no plan labels in code', () => {
    const files = [...walk('src'), ...walk('tests')].filter((f) => isCode(f) && !f.startsWith('tests/structure/'))
    const violations = files.flatMap((file) => {
      const found = stalePointers(read(file))
      return found.length === 0 ? [] : [`${file} has ${found.join(', ')}. Plan labels mean nothing to a reader. Write the reason in the comment itself.`]
    })
    expect(violations).toEqual([])
  })

  it(`keeps AGENTS.md to ${MAX_INSTRUCTION_LINES} lines`, () => {
    const lines = read('AGENTS.md').split('\n').length - 1
    expect(lines > MAX_INSTRUCTION_LINES ? [`AGENTS.md has ${lines} lines (limit ${MAX_INSTRUCTION_LINES}). It loads into every session: move detail to a path-scoped rule or leave it to the code.`] : []).toEqual([])
  })

  it('names only real paths and scripts in AGENTS.md', () => {
    const scripts = new Set(Object.keys((JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts))
    const violations = missingDocRefs(read('AGENTS.md'), exists, scripts).map((ref) => `AGENTS.md names ${ref}, which does not exist. Update the line or delete it.`)
    expect(violations).toEqual([])
  })

  it('documents every WEBTOON_ variable in the README', () => {
    const readme = read('README.md')
    const used = [...walk('src'), ...walk('tests'), ...walk('tools')].filter((f) => /\.(ts|tsx|mjs|ps1|py)$/.test(f)).flatMap((f) => read(f).match(/\bWEBTOON_[A-Z_]+\b/g) ?? [])
    const violations = [...new Set(used)].filter((name) => !readme.includes(name)).map((name) => `${name} is not documented. Add it to Environment overrides in README.md.`)
    expect(violations).toEqual([])
  })
})
