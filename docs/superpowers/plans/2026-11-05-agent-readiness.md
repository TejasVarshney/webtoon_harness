# Agent Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make this repo cheaper and safer for coding agents to work in, after first getting `main` and the feature line back into one history.

**Architecture:** Integrate `origin/main` on its own branch and PR. Then, on a second branch: one `npm run check` command, dead-code removal, comment cleanup and a split of the hottest file, all held in place by one structure test. Finish with a short instruction file that says only what the code won't show, a Stop hook and CI.

**Tech Stack:** Electron 45, TypeScript 7, React 19, Vitest 5, Playwright. One new dev dependency: knip.

**Spec:** `docs/superpowers/specs/2026-11-05-agent-readiness-design.md`

## Global Constraints

- No user-visible behaviour changes, apart from export and sketch reaching `main` alongside sheet-check.
- No new runtime dependencies. The only new dev dependency is `knip@6.44.1`, pinned exactly.
- Unit test count only grows. After Task 1 the baseline is 1914 passed, 2 skipped, unless `origin/main` has moved.
- Nothing under `resources/agent-docs/` changes: those files ship to every project and each is listed to the in-app agent.
- Never push, open a PR, delete a branch or remove a worktree without the user's explicit yes in chat.
- Match the surrounding style: no semicolons, single quotes, LF line endings.
- Commit messages end with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The spec and this plan are untracked when work starts. Keep them out of Task 1's commit; Task 2 commits them.

## Review Focus

1. **A failed sheet cast in the new editor.** It must still warn. The merge removes the dialog that showed this warning, so only an end-to-end run proves it. Pinned in Task 1.
2. **Import forms the scanner could misread.** Inline `type`, multi-line imports, CRLF, `export *`, dynamic `import()`, and text that merely looks like an import. A miss hides a real breach and a false hit blocks good work. Pinned in Task 6.
3. **Windows separators.** Paths arrive with backslashes, and this repo's own path has spaces. Pinned in Task 6, and in Task 8 for the hook.
4. **The Stop hook trapping an agent.** If the user opts in, it must not block a turn with no source change or a fresh worktree with no `tsc`, and it must block a real type error with the compiler's output. Pinned in Task 8.
5. **The instruction-file checker crying wolf.** Placeholders, globs, directories and `origin/main` must not count as dead paths, and a dead path or unknown `npm run` script must. Pinned in Task 7.

---

### Task 1: Put `origin/main` and the feature line into one history

**Files:**
- Modify: `src/shared/schemas.ts`, `src/main/domain/panel-service.test.ts` (conflicts)
- Modify: `src/main/agent/tools/panel-chat-tools.test.ts`, `src/main/export/export-service.test.ts` (call sites)
- Modify: `tests/e2e/sheet-check.spec.ts`

**Interfaces:**
- Produces: branch `chore/integrate-main`, the base of every later task.

- [ ] **Step 1: Fast-forward local `main`**

Run: `git fetch origin && git merge-base --is-ancestor main origin/main && git fetch origin main:main`
Expected: `main` matches `origin/main`, with no error.

- [ ] **Step 2: Branch and merge**

Run: `git switch -c chore/integrate-main feat/panel-sketch && git merge --no-ff origin/main`
Expected: conflicts in exactly `src/shared/schemas.ts` and `src/main/domain/panel-service.test.ts`. If `origin/main` has moved and there are others, resolve them by keeping both sides' intent and tell the user which.

- [ ] **Step 3: Resolve `src/shared/schemas.ts`**

Keep `VisualFieldsSchema` from `HEAD`. Drop `HEAD`'s `CheckResultSchema` block, because `origin/main` moved it above the character schemas. Afterwards `grep -c "CheckResultSchema = " src/shared/schemas.ts` prints `1`.

- [ ] **Step 4: Resolve `src/main/domain/panel-service.test.ts`**

```ts
const USER = { createdBy: 'user' as const, strictMentions: false, strictSheets: false }
const AGENT = { createdBy: 'ai' as const, strictMentions: true, strictSheets: false }
```

Keep `HEAD`'s `VERSION_KEYS`, which includes `'drawnFrom'`.

- [ ] **Step 5: Add `strictSheets: false` at the call sites the compiler names**

Run: `npm run typecheck`
Expected before the fix: 5 `TS2741` errors, 3 in `panel-chat-tools.test.ts` and 2 in `export-service.test.ts`. Add `strictSheets: false` to each. At runtime these were `undefined`, so `false` keeps their behaviour.

- [ ] **Step 6: Run typecheck and unit tests**

Run: `npm run typecheck && npx vitest run`
Expected: no type errors, `1914 passed | 2 skipped`.

- [ ] **Step 7: Rewrite the panel half of `tests/e2e/sheet-check.spec.ts` for the new editor**

Keep the test name and the character half. Replace everything from `openTab(page, 'webtoon')` through the warning assertion: click `add-panel`, cast Mina the way `tests/e2e/panels.spec.ts` does in the new editor, then:

```ts
await expect(page.locator('.inspector-warnings')).toContainText('failed its sheet check')
```

Keep the final `character.variations[0].check.passed` assertion.

- [ ] **Step 8: Run the end-to-end suite**

Run: `npm run test:e2e`
Expected: all pass and the `*-live` specs skip. A failure from the old create dialog is a spec to update the same way. Any other failure is a product regression from the merge: stop and report it.

- [ ] **Step 9: Commit the merge**

```bash
git add src tests
git commit -m "merge: bring sheet-check from main together with export and sketch"
```

- [ ] **Step 10: Stop and ask**

Tell the user that PRs #10 and #11 show MERGED, but their work is not on `main`. Ask whether to push `chore/integrate-main` and open its PR with base `main`. Later tasks continue either way; if the user waits, say that a later rebase may be needed.

---

### Task 2: One check command, stricter compiler, no dead code

**Files:**
- Create: `knip.json`
- Modify: `package.json`, `package-lock.json`, `tsconfig.node.json`, `tsconfig.web.json`
- Modify: `src/main/export/offscreen-capturer.ts`, `src/main/export/preset-writers.ts`, `src/renderer/src/test/setup.ts`, `src/renderer/src/components/export/ExportDialog.tsx`
- Modify: each file knip names

**Interfaces:**
- Produces: `npm run check`, the command every later task ends with. Also `npm run dead`.

- [ ] **Step 1: Branch and commit the spec and plan**

```bash
git switch -c chore/agent-readiness chore/integrate-main
git add docs/superpowers/specs/2026-11-05-agent-readiness-design.md docs/superpowers/plans/2026-11-05-agent-readiness.md
git commit -m "docs: findings and plan for agent readiness"
```

- [ ] **Step 2: Add the compiler flags and see them fail**

Add to `compilerOptions` in both tsconfigs: `noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noImplicitReturns`, all `true`.

Run: `npm run typecheck`
Expected: exactly 2 errors, `offscreen-capturer.ts(4,15)` TS6196 and `preset-writers.ts(360,19)` TS4114. Line numbers may have shifted if `origin/main` moved.

- [ ] **Step 3: Fix both**

Remove the unused `ExportSnapshot` import. Add `override` at `preset-writers.ts:360`.

- [ ] **Step 4: Silence the canvas noise and the stale directive**

In `src/renderer/src/test/setup.ts`, stub `HTMLCanvasElement.prototype.getContext` to return `null`. Tests that need a real context already spy on it per test. In `ExportDialog.tsx`, delete the `eslint-disable-next-line` line, since this repo has no ESLint, and keep the comment above it that gives the reason.

- [ ] **Step 5: Add knip and the scripts**

Run: `npm install --save-dev --save-exact knip@6.44.1`

`knip.json`:

```json
{
  "entry": [
    "src/main/index.ts",
    "src/preload/index.ts",
    "src/renderer/src/main.tsx",
    "src/renderer/src/export-main.tsx",
    "tools/**/*.mjs",
    "src/main/plugins/claude-code/fixtures/fake-claude.mjs"
  ],
  "project": ["src/**/*.{ts,tsx}", "tests/**/*.ts", "tools/**/*.mjs"],
  "ignore": ["src/renderer/src/global.d.ts"]
}
```

`package.json` scripts: `"dead": "knip --no-progress"` and `"check": "npm run typecheck && npm run dead && vitest run"`. Set `description` to `"Desktop app where an AI agent co-creates a vertical-scroll webtoon with you."`.

- [ ] **Step 6: Clear what knip reports**

Run: `npm run dead`
Expected: about 49 unused exports and types, listed under about 32 file entries. Drop each `export`. If the name then trips `noUnusedLocals`, it was dead: delete it and whatever only it used. A report of an unused file or dependency means the config is wrong, not the code: fix the config.

- [ ] **Step 7: Run the whole check**

Run: `npm run check`
Expected: exit 0, no `Not implemented` lines, same test count as Task 1.

- [ ] **Step 8: Commit**

```bash
git add -A -- src tests knip.json package.json package-lock.json tsconfig.node.json tsconfig.web.json
git commit -m "chore: one check command, stricter compiler, no unused exports"
```

---

### Task 3: Share the helpers the services repeat

**Files:**
- Create: `src/main/domain/records.ts`, `src/main/domain/records.test.ts`, `src/main/models/providers/openai-errors.ts`
- Modify: `src/main/domain/{character,item,panel,episode,story}-service.ts`, `src/main/models/providers/{openai-chat,openai-images}.ts`

**Interfaces:**
- Consumes: `npm run check` from Task 2.
- Produces, in `src/main/domain/records.ts`: `now(): string`, `failureMessage(error: unknown): string`, `INTERRUPTED`, `NO_IMAGE_YET`, `UPLOAD_EXTS`, `type UploadExt`. In `openai-errors.ts`: `isAbort(err: unknown, signal: AbortSignal): boolean`, `mapError(err: unknown): ProviderError`.

- [ ] **Step 1: Write the failing test `src/main/domain/records.test.ts`**

```ts
it('failureMessage names a cancelled call', () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
  expect(failureMessage(abort)).toBe('Cancelled')
})
it('failureMessage uses the message of an error', () => {
  expect(failureMessage(new Error('boom'))).toBe('boom')
})
it('failureMessage falls back to the string form', () => {
  expect(failureMessage(new Error(''))).toBe('Error')
  expect(failureMessage('plain')).toBe('plain')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/main/domain/records.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `records.ts` by moving the existing definitions unchanged, and import them**

Replace the copies in the five services. They were byte-identical when this plan was written; `origin/main` is merged by now, so diff them again, and stop and report if any differs, because merging different copies would change recorded text. Leave `consistency-checker.ts`'s `failureMessage` alone: it takes a signal and behaves differently. `src/main/agent/loop.ts`'s `INTERRUPTED` is different text, so leave that too.

- [ ] **Step 4: Move the OpenAI pair**

Run: `diff <(sed -n '/^function isAbort/,/^}/p;/^function mapError/,/^}/p' src/main/models/providers/openai-chat.ts) <(sed -n '/^function isAbort/,/^}/p;/^function mapError/,/^}/p' src/main/models/providers/openai-images.ts)`
Expected: only `isAbort`'s return line differs, where `openai-chat.ts` uses `isRecord(err)` and `openai-images.ts` spells out the object check. `mapError` is identical. Any other difference: stop and report rather than picking one.

Move them into `openai-errors.ts` using the spelled-out `isAbort` from `openai-images.ts`, so the new file needs no helper import, and import them in both. Keep `isRecord` in `openai-chat.ts` if it still has other uses; `noUnusedLocals` will tell you. Leave `anthropic.ts`, `gemini-images.ts` and `loop.ts` alone.

- [ ] **Step 5: Run the whole check**

Run: `npm run check`
Expected: exit 0, test count grew by 3.

- [ ] **Step 6: Commit**

```bash
git add src
git commit -m "refactor: share the small helpers the services repeat"
```

---

### Task 4: Replace plan labels in code with the reasons

**Files:**
- Modify: about 60 files in `src/` and `tests/`, comments and test titles only.

**Interfaces:**
- Produces: a tree with no plan labels, which Task 6's guard then holds.

- [ ] **Step 1: List the labels**

Run: `git grep -nE 'Ruling [A-Z][0-9]|Review Focus|§ ?[0-9]|\bTask [0-9]+\b|\([FIPT][0-9]{1,2}[a-z]?\)|// [FIPT][0-9]{1,2}:' -- src tests`
Expected: about 195 lines.

- [ ] **Step 2: Rewrite each one**

A reader must be able to understand the comment with no other file open.
- If the comment already gives the reason, drop only the label.
- If the label was the only explanation, write the reason in one clause, taken from `docs/superpowers/rulings-2026-10-21-webtoon-ai-harness.md` or the spec it names.
- In a test title, keep the behaviour and drop the whole label, including companions like the `C2` in `(C2, Ruling F1)`.
- Never write "see the docs" in its place.

Every match today is a comment or a test title. If `origin/main` has added one in a string the app uses at runtime, stop and report it, because Task 6's guard would reject it.

While here, remove the orphan doc comment above `recordCheck` in `panel-service.ts`: two doc blocks sit on one method, and the second is the accurate one.

- [ ] **Step 3: Verify none are left and nothing else moved**

Run: the Step 1 command, then `npm run check`
Expected: no matches; exit 0; same test count as Task 3.

- [ ] **Step 4: Commit**

```bash
git add src tests
git commit -m "docs: say why in the comments instead of pointing at plan labels"
```

---

### Task 5: Split `panel-service.ts` below 500 lines

**Files:**
- Create: `src/main/domain/panel-files.ts`, `src/main/domain/panel-recording.ts`, `src/main/domain/panel-images.ts`
- Modify: `src/main/domain/panel-service.ts`, `src/main/domain/panel-validation.ts`
- Test: `src/main/domain/panel-service.test.ts` stays byte-identical.

**Interfaces:**
- Consumes: `now`, `failureMessage`, `UPLOAD_EXTS`, `UploadExt` from `records.ts`.
- Produces, used only by `panel-service.ts`:
  - `panel-files.ts`: `readPanelFile(file: string, id: string): Promise<Panel>`, `getPanel(ctx: ProjectContext, id: string): Promise<Panel>`, `tryReadPanel(ctx, id): Promise<Panel | null>`, `scanPanels(ctx): Promise<Panel[]>`, `reportProblem(ctx, abs: string, error: unknown): void`
  - `panel-recording.ts`: `interface Attempt`, `type Preparation`, `type EmitPanelChanged = (ctx: ProjectContext, panelId: string) => void`, `recordAttempt(emit: EmitPanelChanged, ctx, panelId: string, attempt: Attempt, preparation: Preparation): Promise<PanelVersion>`, `recordCheck(emit: EmitPanelChanged, ctx, panelId: string, versionId: string, check: CheckResult): Promise<Panel | null>`, `panelImageRelPath(panelId: string, versionId: string, ext: string): string`
  - `panel-images.ts`: `storeUploadedImage(ctx, id: string, data: Buffer, ext: UploadExt): Promise<PanelVersion>`, `storeSketch(ctx, id: string, png: Buffer | null): Promise<Panel>`, `readSketchFile(ctx, sketchPath: string): Promise<Buffer | null>`
  - `panel-validation.ts` gains `grandfatherUnchangedCast` and `grandfatherUnchangedItems`, moved as they are.
- `PanelService`'s public methods and signatures, and the `PanelValidationError` export from `panel-service.ts`, do not change, so no caller changes.

- [ ] **Step 1: Note the baseline**

Run: `npx vitest run src/main/domain/panel-service.test.ts`
Expected: PASS. Note the count.

- [ ] **Step 2: Move the file access, then run that test**

Move `readPanelFile`, the body of `get`, `tryRead`, `scan` and `report` into `panel-files.ts`, keeping bodies as they are. Import from `../storage/atomic` directly, not through a re-export: `panel-service.test.ts` mocks that module to inject write failures.

- [ ] **Step 3: Move the recording, then run that test**

Move `Attempt`, `Preparation`, `record`, `append`, `recordCheck`, `finish`, `imageRelPath` and `PANEL_DELETED` into `panel-recording.ts`. Keep the bodies, replacing `this.emit` with the `emit` parameter. `PanelService` passes its own `emit` bound once.

- [ ] **Step 4: Move upload and sketch, then run that test**

Move the bodies of `uploadImage`, `saveSketch` and `readSketch` into `panel-images.ts`. The `PanelService` methods become one-line calls followed by `this.emit` where the body emitted. Keep the emit outside the lock, as today.

- [ ] **Step 5: Move the two grandfather helpers to `panel-validation.ts`**

- [ ] **Step 6: Verify nothing else moved**

Run: `git diff --quiet -- src/main/domain/panel-service.test.ts && echo unchanged; wc -l src/main/domain/panel-service.ts; npm run check`
Expected: `unchanged`; under 500 lines; exit 0; same test count as Task 4.

- [ ] **Step 7: Commit**

```bash
git add src/main/domain
git commit -m "refactor: split panel-service into file access, recording and images"
```

---

### Task 6: One structure test that holds all of this in place

**Files:**
- Create: `tests/structure/scan.ts`, `tests/structure/scan.test.ts`, `tests/structure/repo-rules.test.ts`
- Modify: `vitest.config.mts` (add `'tests/structure/**/*.test.ts'` to the `main` project's `include`)

**Interfaces:**
- Produces, in `tests/structure/scan.ts`:
  - `interface ImportRef { specifier: string; typeOnly: boolean }`
  - `importsOf(source: string): ImportRef[]`
  - `resolveImport(fromRepoPath: string, specifier: string, exists: (repoPath: string) => boolean): string | null`, which handles relative paths and `@shared/`, tries `.ts`, `.tsx` and `/index.ts`, and returns null for packages and non-code files
  - `areaOf(repoPath: string): string | null`
  - `findCycles(graph: Map<string, string[]>): string[][]`
  - `stalePointers(source: string): string[]`

- [ ] **Step 1: Add the `vitest.config.mts` include, and write the failing test `tests/structure/scan.test.ts`**

```ts
const refs = (s: string) => importsOf(s).map((r) => [r.specifier, r.typeOnly])

it('reads every runtime and type-only form', () => {
  expect(refs("import type { A } from './a'")).toEqual([['./a', true]])
  expect(refs("import { type A, type B } from './a'")).toEqual([['./a', true]])
  expect(refs("import D, { type A } from './a'")).toEqual([['./a', false]])
  expect(refs("import { type A, b } from './a'")).toEqual([['./a', false]])
  expect(refs("export type { X } from './a'")).toEqual([['./a', true]])
  expect(refs("export { x } from './a'")).toEqual([['./a', false]])
  expect(refs("export * from './a'")).toEqual([['./a', false]])
  expect(refs("import './a.css'")).toEqual([['./a.css', false]])
  expect(refs("const m = await import('./lazy')")).toEqual([['./lazy', false]])
})
it('reads a multi-line import, with LF or CRLF', () => {
  expect(refs("import {\n  a,\n  b\n} from './a'")).toEqual([['./a', false]])
  expect(refs("import {\r\n  a\r\n} from './a'\r\n")).toEqual([['./a', false]])
})
it('ignores what only looks like an import', () => {
  expect(refs("// import x from './no'")).toEqual([])
  expect(refs("/**\n * import x from './no'\n */")).toEqual([])
  expect(refs("const g = 'src/**/*.ts'\nimport './after'\nconst h = '*/'")).toEqual([['./after', false]])
})
it('names the area, whichever separator the path uses', () => {
  expect(areaOf('src/main/domain/x.ts')).toBe('main/domain')
  expect(areaOf('src\\main\\domain\\x.ts')).toBe('main/domain')
  expect(areaOf('src/renderer/src/a/b.tsx')).toBe('src/renderer')
  expect(areaOf('src/shared/x.ts')).toBe('src/shared')
  expect(areaOf('src/main/services.ts')).toBe('main/services.ts')
  expect(areaOf('tests/x.ts')).toBeNull()
})
it('resolves relative and alias imports, and nothing else', () => {
  const exists = (p: string) => ['src/main/a.ts', 'src/main/b/index.ts', 'src/shared/ids.ts', 'src/main/c.tsx'].includes(p)
  expect(resolveImport('src/main/x.ts', './a', exists)).toBe('src/main/a.ts')
  expect(resolveImport('src/main/x.ts', './b', exists)).toBe('src/main/b/index.ts')
  expect(resolveImport('src/main/x.ts', './c', exists)).toBe('src/main/c.tsx')
  expect(resolveImport('src\\main\\x.ts', './a', exists)).toBe('src/main/a.ts')
  expect(resolveImport('src/main/x.ts', '@shared/ids', exists)).toBe('src/shared/ids.ts')
  expect(resolveImport('src/main/x.ts', 'zod', exists)).toBeNull()
  expect(resolveImport('src/main/x.ts', './a.css', exists)).toBeNull()
})
it('finds cycles and only cycles', () => {
  expect(findCycles(new Map([['a', ['b']], ['b', ['c']], ['c', []]]))).toEqual([])
  expect(findCycles(new Map([['a', ['b']], ['b', ['a']]]))).toHaveLength(1)
  expect(findCycles(new Map([['a', ['a']]]))).toHaveLength(1)
})
it('flags plan labels but not ordinary words', () => {
  for (const s of ['Ruling T18f: x', 'Review Focus 2', 'spec §9', '§ 6.1', '(Task 25)', '(I4)', '// I6: requests']) expect(stalePointers(s)).not.toEqual([])
  for (const s of ['ruling out the case', 'Multitask 3', 'a task 3 of them', 'T1 generic', 'Item (x)']) expect(stalePointers(s)).toEqual([])
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/structure/scan.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `tests/structure/scan.ts`**

Don't strip block comments with a regex: `'src/**/*.ts'` contains `/*` and would swallow the imports after it. Match statements that begin a line (`^\s*(import|export)\b`, multiline), which leaves out `//` and ` * ` comment lines, and find dynamic `import('...')` on lines that don't start with `//` or `*`. Decide `typeOnly` from the statement's own clause.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/structure/scan.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `tests/structure/repo-rules.test.ts`**

It walks `src/` for non-test `.ts` and `.tsx` files, from the repo root taken from `__dirname`, and applies four rules. Each `expect(violations).toEqual([])` compares fix-it strings, so a failure tells the reader what to do.

Layers (runtime imports only; areas not listed are composition roots and unconstrained):

```ts
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
```

Message: `` `${file} imports ${target} at runtime; ${area} may import only ${allowed}. Use \`import type\` if only the type is needed, or move the shared piece down a layer.` ``

Process APIs: `electron` only in `src/main/domain/electron-image-ops.ts`, `src/main/export/electron-codec.ts`, `src/main/export/offscreen-capturer.ts`, `src/main/index.ts`, `src/main/models/electron-encryptor.ts`, `src/main/protocol/asset-protocol.ts`, `src/preload/index.ts`. `node:*` nowhere in `src/renderer` or `src/shared`. Message: `Services stay testable without Electron: inject this through the options, as ImageOps and Encryptor do.`

Cycles: `findCycles` over the runtime graph is empty. Message: name the cycle, then `Break it with \`import type\`, or move what both sides need into a lower module.`

Size: every non-test `.ts` and `.tsx` file under `src/` has at most 500 lines. Message: `` `${file} has ${n} lines (limit 500). Split it by responsibility, as panel-service.ts was split into panel-files.ts and panel-recording.ts.` ``

Plan labels: `stalePointers` is empty across `src/` and `tests/`, test files included, with `tests/structure/` excepted because it quotes the patterns. Message: `Plan labels mean nothing to a reader. Write the reason in the comment itself.`

- [ ] **Step 6: Prove the rules can fail**

Temporarily add `import { app } from 'electron'` to `src/shared/ids.ts`.
Run: `npx vitest run tests/structure/repo-rules.test.ts`
Expected: FAIL, showing the process-API message. Revert with `git checkout src/shared/ids.ts`.

- [ ] **Step 7: Run the whole check**

Run: `npm run check`
Expected: exit 0, with the new tests counted.

- [ ] **Step 8: Commit**

```bash
git add tests/structure vitest.config.mts
git commit -m "test: hold layers, cycles, file size and comment labels in place"
```

---

### Task 7: Instruction files, README drift and doc checks

**Files:**
- Create: `AGENTS.md`, `CLAUDE.md`, `.claude/rules/agent-docs.md`
- Modify: `README.md`, `.gitignore`, `tests/structure/scan.ts`, `tests/structure/scan.test.ts`, `tests/structure/repo-rules.test.ts`

**Interfaces:**
- Consumes: `tests/structure/scan.ts` from Task 6.
- Produces: `missingDocRefs(markdown: string, exists: (repoPath: string) => boolean, scripts: Set<string>): string[]` in `tests/structure/scan.ts`.

- [ ] **Step 1: Add the failing test to `scan.test.ts`**

```ts
it('reports dead paths and unknown scripts, and nothing else', () => {
  const exists = (p: string) => ['src/main/test/', 'src/main/a.ts', 'README.md'].includes(p)
  const scripts = new Set(['check'])
  const refs = (s: string) => missingDocRefs(s, exists, scripts)
  expect(refs('`src/main/a.ts`, `src/main/test/` and `README.md`')).toEqual([])
  expect(refs('`npm run check` and `origin/main` and `<path>`')).toEqual([])
  expect(refs('`tests/e2e/<spec>` and `resources/agent-docs/**` and `npx vitest run <path>`')).toEqual([])
  expect(refs('`src/main/gone.ts`')).toEqual(['src/main/gone.ts'])
  expect(refs('`npm run nope`')).toEqual(['npm run nope'])
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/structure/scan.test.ts`
Expected: FAIL, `missingDocRefs` is not a function.

- [ ] **Step 3: Implement `missingDocRefs`**

Check only backticked tokens that start with `src/`, `tests/`, `tools/`, `docs/`, `resources/` or `integrations/`, or that are exactly `README.md`, and that contain no `<` or `*`. Separately, check tokens of the form `npm run <name>`. Leave out `.claude/`: `AGENTS.md` names `.claude/worktrees/`, which doesn't exist on a clean checkout, so including it would fail in CI.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/structure/scan.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `CLAUDE.md`**

Exactly one line: `@AGENTS.md`. A root `AGENTS.md` alone would not load, because `E:\claude\CLAUDE.md` sits above this repo.

- [ ] **Step 6: Write `AGENTS.md` with this exact copy**

```markdown
# Webtoon AI Harness

Electron + React + TypeScript desktop app. `README.md` covers what it does for users.

## Commands

- Everything: `npm run check` (typecheck, dead code, unit and structure tests, about 30 s)
- One unit test file: `npx vitest run <path>`
- End to end: `npm run test:e2e`, which builds first. One spec: `npm run build`, then `npx playwright test tests/e2e/full-flow.spec.ts`. These open real windows and test the built `out/`, so rebuild after a source change.
- `*-live.spec.ts` and `*.live.test.ts` skip unless a `WEBTOON_LIVE_*` variable is set. They use real models and accounts, so don't set one unless asked.
- To run the agent flow offline, script the mock model: see `WEBTOON_MOCK_SCRIPT` in `README.md`.

## Things that are not what they look like

- `resources/agent-docs/` is product content, not instructions for you. `resources/agent-docs/AGENTS.md` is the in-app agent's system prompt.
- `docs/superpowers/plans/` and `docs/superpowers/rulings-2026-10-21-webtoon-ai-harness.md` record finished work, and `docs/superpowers/specs/` holds design records. Where any of them disagrees with the code, the code wins.
- An unscoped `**` Glob also matches `node_modules/`, `out/`, `.local-env/` and stale checkouts in `.claude/worktrees/`. Scope it to `src/`, `tests/` or `resources/`. Grep skips them.
- Compare against `origin/main`. Local `main` can lag far behind.

## Rules the code won't show you

- No lock is held across a model call: mark pending under `ctx.mutex`, call the model outside it, then re-read and record under it. A panel's lock is never held together with an episode's.
- Write project files with `writeJsonAtomic` or `writeFileAtomic` (`src/main/storage/atomic.ts`). JSONL logs are the exception: they append.
- Characters and items are twins. Their services, tools, handlers, UI and tests exist once per kind and are nearly identical, so a change to one usually belongs in the other.
- New IPC channel: add it to `IpcContract` and `channelSet` in `src/shared/ipc.ts`, put the handler in `src/main/ipc/handlers/`, and validate input with `parseInput` (`src/main/ipc/validate.ts`).
- A prompt change in `src/main/domain/prompts.ts` needs the same change in `resources/agent-docs/reference/prompt-templates.md`. `src/main/agent/workflow-docs.lint.test.ts` compares them.
- User-visible text is asserted verbatim in tests. Change the test with the text.
- The in-app agent has no delete tools, and deleted files go to the OS trash. API keys never reach the renderer. Generated images hold no text: dialogue is data the app draws.

## Tests

- Helpers: `src/main/test/` (`testServices`, `tempProject`, factories) and `src/renderer/src/test/`.
- A rare worker crash (0xC0000409) in `mcp-server.test.ts` came from Node 24.15, not the test: rerun it. Node 24.22 didn't reproduce it.

## Git

- PRs target `main`. A PR based on another feature branch can show MERGED without its work ever reaching `main`; that stranded export and sketch in PRs #10 and #11.
```

- [ ] **Step 7: Write `.claude/rules/agent-docs.md` with this exact copy**

Before relying on the second bullet, confirm that both checklists are passed as `doc:` in `src/main/domain/consistency-checker.ts`.

```markdown
---
paths:
  - "resources/agent-docs/**"
---
Everything here ships: it is copied into each project's `agent/` folder, and every `.md` is listed to the in-app agent. Don't add notes for coding agents.

- `AGENTS.md` is the in-app agent's system prompt.
- `reference/consistency-checklist.md` and `reference/sheet-checklist.md` are the vision checker's instructions and must keep their JSON output contract.
- `src/main/agent/workflow-docs.lint.test.ts` checks required sections, tool names, example tool calls and prompt templates against the code.
- Existing projects keep their copies until the user presses Reset all to defaults. Only missing files are copied in.
```

- [ ] **Step 8: Fix the README drift**

In "Project folder layout", add `items/` (`itm_xxxxxxxxxx.json` and its image folder, like `characters/`), add `item-creation` to `workflows/` and `sheet-checklist` to `reference/`. In "Environment overrides", add `WEBTOON_LIVE_LOCAL`, `WEBTOON_LIVE_BRIDGE` and `WEBTOON_LIVE_CLAUDE` (opt-in live tests) and `WEBTOON_MCP_PORT` and `WEBTOON_MCP_TOKEN` (read by the Claude Code plugin's `.mcp.json`). Check each description against its use in the code before writing it.

- [ ] **Step 9: Move the local ignores into `.gitignore`**

Append `.claude/worktrees/`, `.superpowers/`, `.taste-skill/` and `tests/e2e/zz-*.spec.ts`, so a fresh clone gets what today lives only in `.git/info/exclude`. Do not ignore all of `.claude/`: `settings.json` and `rules/` are tracked.

- [ ] **Step 10: Add the two doc rules to `repo-rules.test.ts`**

`AGENTS.md` has at most 80 lines, and `missingDocRefs` on it is empty, using `package.json`'s scripts. Messages: `AGENTS.md loads into every session: move detail to a path-scoped rule or leave it to the code.` and `` `AGENTS.md names ${ref}, which does not exist. Update the line or delete it.` ``

Every `WEBTOON_[A-Z_]+` found in `src/`, `tests/` and `tools/` appears in `README.md`. Message: `` `${name} is not documented. Add it to Environment overrides in README.md.` ``

- [ ] **Step 11: Run the whole check**

Run: `npm run check`
Expected: exit 0. Also confirm `CLAUDE.md` and the rule file are not ignored: `git check-ignore CLAUDE.md .claude/rules/agent-docs.md` prints nothing.

- [ ] **Step 12: Commit**

```bash
git add AGENTS.md CLAUDE.md .claude/rules/agent-docs.md README.md .gitignore tests/structure
git commit -m "docs: instructions for coding agents, checked against the repo"
```

---

### Task 8: Stop hook, CI and final verification

**Files:**
- Create: `tools/agent/stop-check.mjs`, `tests/structure/stop-check.test.ts`, `.claude/settings.json`, `.github/workflows/check.yml`

**Interfaces:**
- Consumes: `npm run typecheck` and `npm run check`.
- Produces: exit code contract for `tools/agent/stop-check.mjs`: 0 lets the turn end, 2 blocks it with the compiler's output on stderr.

- [ ] **Step 0: Ask the user whether to add the Stop hook**

It is persistent configuration that applies to every future session in this repo. It blocks any turn from ending while the tree has a type error, and it can't tell whose error that is: another session sharing the checkout, or the user's own half-done edit, would block a session that only answered a question. If the answer is no, skip Steps 1 to 5 and add only CI.

- [ ] **Step 1: Write the failing test `tests/structure/stop-check.test.ts`**

Each case builds a temp git repo whose folder name contains a space, with the script copied to `tools/agent/stop-check.mjs` and a `package.json` whose `typecheck` script writes a marker file, then exits 0 or prints `error TS1234` and exits 1. It commits everything, passing `-c user.name=test -c user.email=test@example.invalid` because CI has no git identity, then runs the script with `spawnSync(process.execPath, [script])`. Spawn git with `GIT_CONFIG_GLOBAL` set to an empty temp file and `GIT_CONFIG_NOSYSTEM=1`, so a machine's `commit.gpgsign` or `core.hooksPath` can't break or hang the fixture.

```ts
it('lets a turn with no source change end without running typecheck')   // status 0, no marker
it('ignores changes outside the source')                                // edit README.md: status 0, no marker
it('does not trap a checkout with no tsc')                              // edit src/a.ts, no node_modules/.bin/tsc: status 0, stderr names tsc, no marker
it('runs typecheck after a source change and passes when it passes')    // edit src/a.ts, stub tsc: status 0, marker
it('blocks with the compiler output when typecheck fails')              // same, failing script: status 2, stderr contains 'error TS1234'
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/structure/stop-check.test.ts`
Expected: FAIL, script not found.

- [ ] **Step 3: Implement `tools/agent/stop-check.mjs`**

Take the repo root from the script's own location, not the working directory. Run `git status --porcelain -- src tests package.json tsconfig.json tsconfig.node.json tsconfig.web.json`; on empty output or a git failure, exit 0. Look for `node_modules/.bin/tsc` in the root and up to 3 levels above it (a `.claude/worktrees/<name>` checkout finds its parent's, and an unrelated folder further up can't satisfy it); if there is none, note it on stderr and exit 0. Otherwise run `npm run typecheck --silent` with `shell: true` in the root. On failure, write its stdout and stderr to stderr and exit 2.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run tests/structure/stop-check.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the hook in `.claude/settings.json`**

```json
{
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/tools/agent/stop-check.mjs\"" }] }]
  }
}
```

Run it the way the harness would: `CLAUDE_PROJECT_DIR="$PWD" bash -c 'node "$CLAUDE_PROJECT_DIR/tools/agent/stop-check.mjs"'; echo $?`
Expected: `0` on a clean tree. This proves the command, not the wiring. Say so when reporting: the wiring is only proven by a later session ending a turn with a type error.

- [ ] **Step 6: Add `.github/workflows/check.yml`**

```yaml
name: check
on:
  pull_request:
  push:
    branches: [main]
jobs:
  check:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run check
```

Windows is the only platform these tests are known to pass on. End-to-end tests stay out for now because they open real windows. This file can't be proven locally: its first real run is on the PR, and any failure there is part of this task.

- [ ] **Step 7: Run everything**

Run: `npm run check && npm run test:e2e`
Expected: both exit 0. Keep the output to quote as evidence.

- [ ] **Step 8: Commit**

```bash
git add tools/agent tests/structure .claude/settings.json .github/workflows/check.yml
git commit -m "chore: block a turn on a type error, and run the checks in CI"
```

If the user declined the hook, stage only the workflow and use `chore: run the checks in CI`.

- [ ] **Step 9: Finish the branch**

Use superpowers:finishing-a-development-branch. Pushing and opening the PR need the user's yes. The PR's base is `main` if Task 1's PR has merged, otherwise `chore/integrate-main`, with a note to retarget it to `main` once that merges, which is the mistake this plan started by fixing.

---

### Task 9: Local housekeeping (only with the user's explicit yes)

This changes nothing in the repo's history. It removes local state, so ask first and show the list below.

**Files:** none tracked.

**Interfaces:** none.

- [ ] **Step 1: Ask, showing exactly what would go**

Stale worktrees, each clean and each fully on a branch that stays:
- `.claude/worktrees/sheet-check` (in `origin/main`). Its ignored `.superpowers/` run files, `node_modules/`, `out/` and `test-results/` go with it.
- `.claude/worktrees/sheet-check-pr` (in `origin/main`)
- `.claude/worktrees/world-building-06ed60` (`a79a1e2`, kept by `feat/world-designs`)

Local branches already in `origin/main`: `claude/world-building-06ed60`, `feat/endpoint-timeout`, `feat/item-maker`, `feat/manhwa-bubbles`, `feat/sheet-check`, `feat/webtoon-harness`, `feat/webtoon-ui`, `fix/local-bridge-panel-references`, `fix/local-smoke-exit`.

After Task 1's PR merges, also: `feat/episode-export`, `feat/panel-shapes`, `feat/panel-sketch`.

Keep `feat/world-designs` (an unmerged spec and plan). Leave `E:/claude/manhwa-benchmark/harness-2c864a1` alone: it belongs to another project. Remote branches are a separate question for the user.

- [ ] **Step 2: Re-verify, then remove what was approved**

Run for each worktree: `git -C ".claude/worktrees/<name>" status --short`
Expected: no output. If there is any, skip it and report it.

Run: `git worktree remove --force ".claude/worktrees/<name>"`. On "Permission denied", check that no shell or app is inside it, delete the folder, then run `git worktree prune`.

Run for each branch, from a branch that contains `origin/main` and after the worktrees are gone: `git branch -d <name>`. Use `-d`, never `-D`: it refuses a branch that isn't merged. A refusal means stop and report.

- [ ] **Step 3: Verify**

Run: `git worktree list && git branch`
Expected: only what the user chose to keep. Glob for `**/panel-service.ts` now returns one result.
