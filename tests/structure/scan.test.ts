import { describe, expect, it } from 'vitest'
import { areaOf, findCycles, importsOf, missingDocRefs, resolveImport, stalePointers } from './scan'

const refs = (s: string) => importsOf(s).map((r) => [r.specifier, r.typeOnly])

describe('importsOf', () => {
  it('reads every runtime and type-only form', () => {
    expect(refs("import type { A } from './a'")).toEqual([['./a', true]])
    expect(refs("import { type A, type B } from './a'")).toEqual([['./a', true]])
    expect(refs("import D, { type A } from './a'")).toEqual([['./a', false]])
    expect(refs("import { type A, b } from './a'")).toEqual([['./a', false]])
    expect(refs("import D from './a'")).toEqual([['./a', false]])
    expect(refs("import * as A from './a'")).toEqual([['./a', false]])
    expect(refs("export type { X } from './a'")).toEqual([['./a', true]])
    expect(refs("export { x } from './a'")).toEqual([['./a', false]])
    expect(refs("export * from './a'")).toEqual([['./a', false]])
    expect(refs("import './a.css'")).toEqual([['./a.css', false]])
    expect(refs("const m = await import('./lazy')")).toEqual([['./lazy', false]])
  })

  it('reads a multi-line import, with LF or CRLF', () => {
    expect(refs("import {\n  a,\n  b\n} from './a'")).toEqual([['./a', false]])
    expect(refs("import {\r\n  a\r\n} from './a'\r\n")).toEqual([['./a', false]])
    expect(refs("import type {\n  A,\n  B\n} from './a'")).toEqual([['./a', true]])
  })

  it('ignores what only looks like an import', () => {
    expect(refs("// import x from './no'")).toEqual([])
    expect(refs("/**\n * import x from './no'\n */")).toEqual([])
    expect(refs("// const m = await import('./no')")).toEqual([])
    expect(refs(" * see import('./no')")).toEqual([])
    expect(refs("const g = 'src/**/*.ts'\nimport './after'\nconst h = '*/'")).toEqual([['./after', false]])
    expect(refs("export const value = 1\nexport function run(): void {}")).toEqual([])
  })
})

describe('areaOf', () => {
  it('names the area, whichever separator the path uses', () => {
    expect(areaOf('src/main/domain/x.ts')).toBe('main/domain')
    expect(areaOf('src\\main\\domain\\x.ts')).toBe('main/domain')
    expect(areaOf('src/renderer/src/a/b.tsx')).toBe('src/renderer')
    expect(areaOf('src/shared/x.ts')).toBe('src/shared')
    expect(areaOf('src/preload/index.ts')).toBe('src/preload')
    expect(areaOf('src/main/services.ts')).toBe('main/services.ts')
    expect(areaOf('tests/x.ts')).toBeNull()
  })
})

describe('resolveImport', () => {
  it('resolves relative and alias imports, and nothing else', () => {
    const exists = (p: string) => ['src/main/a.ts', 'src/main/b/index.ts', 'src/shared/ids.ts', 'src/main/c.tsx', 'src/main/d/e.ts'].includes(p)
    expect(resolveImport('src/main/x.ts', './a', exists)).toBe('src/main/a.ts')
    expect(resolveImport('src/main/x.ts', './b', exists)).toBe('src/main/b/index.ts')
    expect(resolveImport('src/main/x.ts', './c', exists)).toBe('src/main/c.tsx')
    expect(resolveImport('src/main/d/x.ts', '../a', exists)).toBe('src/main/a.ts')
    expect(resolveImport('src\\main\\d\\x.ts', './e', exists)).toBe('src/main/d/e.ts')
    expect(resolveImport('src/main/x.ts', '@shared/ids', exists)).toBe('src/shared/ids.ts')
    expect(resolveImport('src/main/x.ts', 'zod', exists)).toBeNull()
    expect(resolveImport('src/main/x.ts', 'node:fs', exists)).toBeNull()
    expect(resolveImport('src/main/x.ts', './a.css', exists)).toBeNull()
  })
})

describe('findCycles', () => {
  it('finds cycles and only cycles', () => {
    expect(findCycles(new Map([['a', ['b']], ['b', ['c']], ['c', []]]))).toEqual([])
    expect(findCycles(new Map([['a', ['b', 'c']], ['b', ['c']], ['c', []]]))).toEqual([])
    expect(findCycles(new Map([['a', ['b']], ['b', ['a']]]))).toHaveLength(1)
    expect(findCycles(new Map([['a', ['a']]]))).toHaveLength(1)
    expect(findCycles(new Map([['a', ['b']], ['b', ['c']], ['c', ['a']]]))[0]).toEqual(expect.arrayContaining(['a', 'b', 'c']))
  })
})

describe('missingDocRefs', () => {
  const exists = (p: string) => ['src/main/test/', 'src/main/a.ts', 'README.md'].includes(p)
  const refs = (s: string) => missingDocRefs(s, exists, new Set(['check']))

  it('accepts real files, folders and scripts', () => {
    expect(refs('`src/main/a.ts`, `src/main/test/` and `README.md`')).toEqual([])
    expect(refs('Run `npm run check`.')).toEqual([])
  })

  it('leaves alone what is not a repo path', () => {
    expect(refs('`origin/main` and `<path>` and `node_modules/` and `out/`')).toEqual([])
    expect(refs('`tests/e2e/<spec>` and `resources/agent-docs/**` and `npx vitest run <path>`')).toEqual([])
    expect(refs('`.claude/worktrees/`')).toEqual([])
  })

  it('reports dead paths and unknown scripts', () => {
    expect(refs('`src/main/gone.ts`')).toEqual(['src/main/gone.ts'])
    expect(refs('`npm run nope`')).toEqual(['npm run nope'])
    expect(refs('`README.txt` is fine, `docs/gone/` is not')).toEqual(['docs/gone/'])
  })
})

describe('stalePointers', () => {
  it('flags plan labels', () => {
    for (const s of ['Ruling T18f: x', 'ruling R18', 'Review Focus 2', 'spec §9', '§ 6.1', '(Task 25)', '(I4)', '(R2)', '(C1, with a provider)', '// I6: requests', '// R3: events']) {
      expect(stalePointers(s), s).not.toEqual([])
    }
  })

  it('leaves ordinary words alone', () => {
    for (const s of ['ruling out the case', 'Multitask 3', 'a task 3 of them', 'T1 generic', 'Item (x)', 'r2 = 4', 'F1 key']) {
      expect(stalePointers(s), s).toEqual([])
    }
  })
})
