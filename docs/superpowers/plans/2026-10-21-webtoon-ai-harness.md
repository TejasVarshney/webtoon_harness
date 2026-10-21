# Webtoon AI Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Electron desktop app for making webtoons with AI. It has Claude Code-style sessions on the left, an agent chat in the middle (with a per-panel side chat), and a webtoon visualizer, Characters and Story tabs on the right. Character consistency is enforced in code and governed by editable workflow `.md` docs, and users can configure any endpoints and models.

**Architecture:** The main process owns all state and I/O: project folders of JSON/JSONL/PNG/MD files, a model registry with encrypted keys, provider adapters, and a provider-agnostic tool-calling agent loop. The renderer is a React view. It talks over one typed IPC contract and re-fetches on broadcast events. UI actions and agent tools call the same domain services, so manual and AI work get identical validation and prompt composition.

**Tech Stack:** Electron + electron-vite, React 19, TypeScript (strict), Zustand 5, zod 4, react-resizable-panels, react-markdown, `@anthropic-ai/sdk`, `openai`, Vitest (+ Testing Library, jsdom), Playwright (`_electron`).

**Spec:** `docs/superpowers/specs/2026-10-21-webtoon-ai-harness-design.md`. Read it first. Section numbers below (§N) refer to it.

## Global Constraints

- Node ≥ 22 (dev machine has 24.15). Install the latest stable versions of every dependency and commit `package-lock.json`. No native Node modules (nothing that needs `electron-rebuild`).
- TypeScript `strict: true`. No `any` in exported signatures. Path alias `@shared/*` → `src/shared/*` in electron-vite (main, preload, renderer), tsconfigs, and Vitest.
- `BrowserWindow` webPreferences: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Window title and product name: `Webtoon AI Harness`.
- API keys never cross IPC. Every network and model call runs in the main process.
- Every project-file write goes through `writeFileAtomic`/`writeJsonAtomic` inside `ctx.mutex.run(absPath, …)`. Paths stored in JSON are project-relative POSIX paths.
- IDs are `<prefix>_<10 lowercase hex>` (§5).
- The default Anthropic model is `claude-opus-5-5`; never use date-suffixed ids. Never send a forced `tool_choice`.
- Generated images contain no text. Dialogue is data, rendered as HTML.
- User deletions go to the OS trash through an injected `trash(absPath)` (Electron `shell.trashItem`). The agent has no delete tools.
- Env overrides: `WEBTOON_USER_DATA`, `WEBTOON_PROJECTS_ROOT`, `WEBTOON_MOCK_SCRIPT`.
- `data-testid` values used by tests: `pane-sessions pane-chat pane-visualizer new-project project-select new-session session-item composer-input composer-send composer-stop message-user message-assistant tool-card tool-image mock-banner settings-open tab-webtoon tab-characters tab-story character-card variation-card variation-form panel-card panel-editor panel-status add-panel panel-side-chat panel-version-label version-prev version-next story-mode-toggle continue-story`.
- Commands: `npm run typecheck`, `npm test` (vitest run, both projects), `npm run test:e2e` (builds, then Playwright). **Every milestone ends with all three green.**

## Review Focus

1. **Cancelling a run mid-tool (Stop button or app close).** Every persisted `tool_use` must have a matching result, or the next Anthropic request fails with a 400 and the session is bricked. Covered by a test in Task 11.
2. **An image call that fails, times out, or is interrupted by quitting.** The variation or version must end `failed` with a message and a Retry, never stuck `pending`. A previously good panel image must stay current. Covered by tests in Tasks 15 and 18.
3. **Removing an endpoint or model that is assigned to a role.** Roles are cleared and the UI says which. The next chat run shows "No model assigned to role 'agent'. Open Settings → Models." rather than crashing. Covered by tests in Tasks 7 and 12.
4. **Deleting a character that panels use, or that the agent references next turn.** Deletion is refused in favor of archive. `create_panel` rejects archived characters and existing panels keep rendering. Covered by tests in Tasks 15 and 17.
5. **A crash or antivirus lock during a write, or a hand-edited corrupt JSON file.** The original file stays intact, the corrupt file is reported as a project problem, and the project still opens. Covered by tests in Tasks 3 and 4.

## File Map

```
resources/agent-docs/            AGENTS.md, workflows/*.md, reference/*.md        (T12 stub, T24 full)
src/shared/                      ids.ts schemas.ts types.ts ipc.ts asset-url.ts prompts.ts
src/main/index.ts                bootstrap, window, protocol, IPC registration
src/main/services.ts             createServices() — wires every service
src/main/events/bus.ts
src/main/storage/                atomic.ts mutex.ts project-paths.ts jsonl.ts project-store.ts
src/main/protocol/asset-protocol.ts
src/main/sessions/session-store.ts
src/main/models/                 registry.ts secrets.ts electron-encryptor.ts
src/main/models/providers/       types.ts png.ts mock.ts factory.ts anthropic.ts openai-chat.ts openai-images.ts gemini-images.ts
src/main/domain/                 errors.ts image-ops.ts electron-image-ops.ts image-service.ts prompts.ts
                                 character-service.ts panel-validation.ts episode-service.ts panel-service.ts
                                 story-service.ts markdown-sections.ts consistency-checker.ts
src/main/agent/                  loop.ts system-prompt.ts workflow-docs.ts agent-runner.ts panel-chat.ts
src/main/agent/tools/            registry.ts index.ts character-tools.ts panel-tools.ts story-tools.ts doc-tools.ts panel-chat-tools.ts
src/main/ipc/                    register.ts handlers/{projects,sessions,models,agent,uploads,characters,panels,panel-chat,story,docs}.ts
src/main/test/                   factories.ts temp-project.ts
src/preload/index.ts
src/renderer/src/                api.ts events.ts App.tsx stores/*.ts test/{setup,fake-api}.ts
src/renderer/src/components/     layout/ sessions/ chat/ panel-chat/ visualizer/ characters/ story/ settings/
tests/e2e/                       helpers.ts *.spec.ts
tests/fixtures/                  provider response fixtures
```

Unit tests sit next to their source as `*.test.ts(x)`.

---

# Milestone 1 — Shell, storage, sessions, models, agent chat

### Task 1: Scaffold the Electron app with a three-pane shell

**Files:**
- Create: `package.json`, `.gitignore`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `vitest.config.ts`, `playwright.config.ts`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`, `src/renderer/src/components/layout/ThreePaneLayout.tsx`, `src/renderer/src/test/setup.ts`
- Test: `src/renderer/src/components/layout/ThreePaneLayout.test.tsx`, `tests/e2e/helpers.ts`, `tests/e2e/smoke.spec.ts`

**Interfaces:**
- Produces: `ThreePaneLayout(props: { left: ReactNode; middle: ReactNode; right: ReactNode })`. It uses react-resizable-panels with default sizes 18/47/35 % and minimums 12/30/22 %, and the testids `pane-sessions`, `pane-chat` and `pane-visualizer`.
- Produces: `launchApp(opts?: { script?: unknown; userDataDir?: string; projectsRoot?: string }): Promise<{ app: ElectronApplication; page: Page; userDataDir: string; projectsRoot: string }>`. It creates temp dirs when they aren't given, writes `script` to a temp JSON file, and launches Electron with `args: ['.']` and `cwd` set to the repo root, so that `app.getAppPath()` is the repo root and `package.json` `main` selects `out/main/index.js`. It passes the three `WEBTOON_*` env vars and waits for the first window.
- `src/main/index.ts` calls `app.setPath('userData', process.env.WEBTOON_USER_DATA)` before `ready` when that variable is set.

- [ ] **Step 1:** Run `git init`, then `npm init -y`. Install runtime deps: `react react-dom zustand zod react-resizable-panels react-markdown @anthropic-ai/sdk openai`. Install dev deps: `electron electron-vite vite @vitejs/plugin-react typescript @types/node @types/react @types/react-dom vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom @playwright/test`. Add `"main": "out/main/index.js"`, and leave out `"type": "module"` (sandboxed preloads must build as CommonJS). Add these scripts: `dev` = `electron-vite dev`, `build` = `electron-vite build`, `typecheck` = `tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json`, `test` = `vitest run`, `test:e2e` = `npm run build && playwright test`. `.gitignore` lists `node_modules out dist test-results playwright-report`.
- [ ] **Step 2:** Write the configs. electron-vite uses default entries (`src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`) and the `@shared` alias. The **preload build must bundle everything it imports**: don't externalize its dependencies, because a sandboxed preload cannot `require` npm packages and fails with a blank window. Vitest defines two `projects`: `main` (environment `node`, includes `src/main/**/*.test.ts` and `src/shared/**/*.test.ts`) and `renderer` (environment `jsdom`, includes `src/renderer/**/*.test.tsx`, uses the React plugin and the setup file `src/renderer/src/test/setup.ts`, which imports `@testing-library/jest-dom/vitest`). Playwright has `testDir: tests/e2e`, `workers: 1` and a 60 s timeout. The CSP meta tag in `index.html` is `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: webtoon-asset:`.
- [ ] **Step 3: Write the failing test**

```tsx
it('renders the three panes', () => {
  render(<ThreePaneLayout left={<div>L</div>} middle={<div>M</div>} right={<div>R</div>} />)
  expect(screen.getByTestId('pane-sessions')).toHaveTextContent('L')
  expect(screen.getByTestId('pane-chat')).toHaveTextContent('M')
  expect(screen.getByTestId('pane-visualizer')).toHaveTextContent('R')
})
```

- [ ] **Step 4:** Run `npx vitest run src/renderer/src/components/layout`. Expected: FAIL (module not found).
- [ ] **Step 5:** Implement `ThreePaneLayout`, an `App` that renders it with placeholder text, a `main.tsx` that mounts `App`, and `src/main/index.ts`. The main file creates a 1440×900 window with the webPreferences from Global Constraints, the preload `../preload/index.js` and the title `Webtoon AI Harness`. `src/preload/index.ts` is empty for now.
- [ ] **Step 6:** Run `npx vitest run` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 7:** Write `tests/e2e/helpers.ts` and `tests/e2e/smoke.spec.ts`. The smoke test asserts the title `Webtoon AI Harness` and that all three pane testids are visible. Run `npm run test:e2e`. Expected: 1 passed.
- [ ] **Step 8:** Commit: `git add -A && git commit -m "chore: scaffold electron app with three-pane shell"`

### Task 2: Shared ids, schemas and types

**Files:**
- Create: `src/shared/ids.ts`, `src/shared/schemas.ts`, `src/shared/types.ts`, `src/main/test/factories.ts`
- Test: `src/shared/ids.test.ts`, `src/shared/schemas.test.ts`

**Interfaces:**
- Produces: `newId(prefix: IdPrefix): string`, where `IdPrefix = 'prj'|'ses'|'chr'|'var'|'epi'|'pnl'|'ver'|'msg'|'run'|'end'|'mdl'|'bt'|'dlg'|'upl'`. Use `crypto.randomUUID()` with dashes stripped, first 10 chars.
- Produces the zod schemas in `schemas.ts`, with exactly the fields and defaults in §6: `ProjectMetaSchema, CharacterSchema, VariationSchema, EpisodeSchema, PanelSchema, PanelCharacterSchema, DialogueLineSchema, PanelVersionSchema, CheckResultSchema, BeatSchema, OutlineSchema, ChatMessageSchema, ToolCallSchema, ToolResultSchema, EndpointConfigSchema, ModelConfigSchema, RoleAssignmentsSchema, ModelsFileSchema`. It also exports these input schemas:
  - `PanelDraftSchema = { episodeId; afterPanelId?: string|null; description; setting; shot; aspect?; characters: PanelCharacter[]; dialogue: {speakerId: string|null; kind; text}[]; continuityNotes?; offPanelMentions? }`
  - `PanelPatchSchema` = PanelDraft without `episodeId`/`afterPanelId`, all fields optional
  - `CharacterInputSchema = { name; role; aliases?; characterization?; appearance?; appearanceLock }`
  - `CharacterPatchSchema` = CharacterInput, all fields optional
  - `VariationInputSchema = { name; kind: Exclude<VariationKind,'base'>; delta }`
- Produces in `types.ts`: `z.infer` types for all of the above (`ProjectMeta, Character, Variation, Episode, Panel, PanelCharacter, DialogueLine, PanelVersion, CheckResult, Beat, ChatMessage, UserMessage, AssistantMessage, ToolMessage, ToolCall, ToolResult, EndpointConfig, ModelConfig, RoleAssignments, PanelDraft, PanelPatch, CharacterInput, CharacterPatch, VariationInput, PanelAspect, ShotType, StoryMode`), plus:
  - `Role = 'agent'|'panelChat'|'vision'|'image'|'imageEdit'`, `Capability`, `EndpointKind`
  - `SessionSummary { id; title; createdAt; updatedAt; messageCount }`
  - `ProjectProblem { path: string; message: string }`
  - `ModelRegistryView { endpoints: (EndpointConfig & { hasKey: boolean })[]; models: ModelConfig[]; roles: RoleAssignments; effectiveRoles: Record<Role, string|null> }`
  - `LoopOutcome = 'end'|'max_steps'|'cancelled'|'error'|'refusal'|'max_tokens'`
  - `AgentEvent`, a union of `{kind:'run-started'; runId}`, `{kind:'text-delta'; runId; text}`, `{kind:'message'; runId; message: ChatMessage}`, `{kind:'tool-started'; runId; toolCall: ToolCall}` and `{kind:'run-finished'; runId; outcome: LoopOutcome; error: string|null}`
  - `AppEvent`, a union of `project.changed{projectId}`, `session.changed{projectId,sessionId}`, `character.changed{projectId,characterId}`, `episode.changed{projectId,episodeId}`, `panel.changed{projectId,panelId}`, `story.changed{projectId}`, `models.changed{}` and `agent.event{projectId, threadKey, event: AgentEvent}`. `threadKey` is a session id or `panel:<panelId>`.
- Produces in `src/main/test/factories.ts`: `makeCharacter(o?)`, `makeVariation(o?)`, `makePanel(o?)`, `makeEpisode(o?)`, `makeMeta(o?)`. Each returns a schema-valid object with deterministic ids.

- [ ] **Step 1: Write the failing tests**

```ts
it('formats ids', () => {
  expect(newId('chr')).toMatch(/^chr_[0-9a-f]{10}$/)
  expect(new Set(Array.from({ length: 1000 }, () => newId('pnl'))).size).toBe(1000)
})
it('fills panel defaults', () => {
  const p = PanelSchema.parse(minimalPanel)       // only required fields
  expect(p.versions).toEqual([]); expect(p.currentVersionId).toBeNull()
  expect(p.offPanelMentions).toEqual([]); expect(p.continuityNotes).toBe('')
  expect(p.characters).toEqual([])
})
it('rejects unknown shot', () => expect(() => PanelSchema.parse({ ...minimalPanel, shot: 'dutch' })).toThrow())
it('defaults character fields', () => {
  const c = CharacterSchema.parse(minimalCharacter)
  expect(c.archived).toBe(false); expect(c.aliases).toEqual([]); expect(c.appearance.palette).toBe('')
})
it('defaults model config', () => {
  const m = ModelConfigSchema.parse({ id: 'mdl_0000000001', endpointId: 'end_0000000001', modelId: 'x', label: 'x', capabilities: ['text'] })
  expect(m.params).toEqual({}); expect(m.maxReferenceImages).toBe(4)
})
it('parses every chat message role', () => {
  for (const m of [userMsg, assistantMsg, toolMsg]) expect(ChatMessageSchema.parse(m).role).toBe(m.role)
})
it('project meta defaults', () => {
  const m = ProjectMetaSchema.parse({ id: 'prj_0000000001', title: 'T', createdAt: T, updatedAt: T })
  expect(m).toMatchObject({ storyMode: 'user', defaultAspect: '2:3', autopilotPanels: 4, consistencyRetries: 1, logline: '' })
  expect(m.stylePreset).toContain('Korean webtoon style')
})
```

- [ ] **Step 2:** Run `npx vitest run src/shared`. Expected: FAIL.
- [ ] **Step 3:** Implement `ids.ts`, `schemas.ts`, `types.ts` and `factories.ts`.
- [ ] **Step 4:** Run `npx vitest run src/shared` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat: shared domain schemas and ids"`

### Task 3: Storage primitives — atomic writes, keyed mutex, project paths, JSONL

**Files:**
- Create: `src/main/storage/atomic.ts`, `src/main/storage/mutex.ts`, `src/main/storage/project-paths.ts`, `src/main/storage/jsonl.ts`, `src/main/domain/errors.ts`
- Test: matching `*.test.ts` files next to each

**Interfaces:**
- Produces: `writeFileAtomic(absPath: string, data: string | Uint8Array, fsImpl?: Pick<typeof fs.promises,'writeFile'|'rename'|'rm'|'mkdir'>): Promise<void>`. It writes to `<path>.tmp-<rand>`, renames over the target, retries `rename` on `EPERM`/`EBUSY` up to 5 times with 25 ms backoff, removes the temp file on failure and creates the parent dir.
- Produces: `writeJsonAtomic(absPath, value: unknown): Promise<void>`, which writes 2-space JSON plus a newline.
- Produces: `readJson<T>(absPath, schema: z.ZodType<T>): Promise<T>`. It lets ENOENT propagate and throws `CorruptFileError { path }` on bad JSON or a schema mismatch.
- Produces: `class KeyedMutex { run<T>(key: string, fn: () => Promise<T>): Promise<T> }`.
- Produces: `class ProjectPaths`, constructed with `root: string`. Methods: `projectFile()`, `storyBible()`, `storyOutline()`, `characterFile(id)`, `characterDir(id)`, `episodeFile(id)`, `episodesDir()`, `charactersDir()`, `panelsDir()`, `panelFile(id)`, `panelDir(id)`, `panelChatFile(id)`, `sessionsDir()`, `sessionFile(id)`, `uploadsDir()`, `agentDocsDir()`, `resolveAsset(relPath): string` (throws `PathEscapeError` when the path leaves the root) and `toRelative(absPath): string` (POSIX separators).
- Produces: `appendJsonl(absPath, records: unknown[]): Promise<void>` (an `fs.appendFile` of one line per record) and `readJsonl<T>(absPath, schema): Promise<{ records: T[]; skipped: number }>`.
- Produces in `errors.ts`: `EntityNotFoundError(kind: string, id: string)`, whose message is `Unknown <kind>: <id>` (later tools and tests rely on this wording), plus `CorruptFileError` and `PathEscapeError`.

- [ ] **Step 1: Write the failing tests**

```ts
it('round-trips JSON with schema', async () => { await writeJsonAtomic(p, { a: 1 }); expect(await readJson(p, z.object({ a: z.number() }))).toEqual({ a: 1 }) })
it('keeps the original when rename fails', async () => {
  await writeJsonAtomic(p, { v: 1 })
  const failing = { ...fs.promises, rename: vi.fn().mockRejectedValue(Object.assign(new Error('x'), { code: 'EIO' })) }
  await expect(writeFileAtomic(p, '{"v":2}', failing)).rejects.toThrow()
  expect(JSON.parse(await fs.promises.readFile(p, 'utf8'))).toEqual({ v: 1 })
  expect((await fs.promises.readdir(dir)).filter(f => f.includes('.tmp-'))).toEqual([])
})
it('retries rename on EPERM', async () => { /* rename rejects EPERM twice then succeeds → resolves; rename called 3 times */ })
it('throws CorruptFileError on bad JSON', async () => { await fs.promises.writeFile(p, '{oops'); await expect(readJson(p, z.any())).rejects.toBeInstanceOf(CorruptFileError) })
it('serializes same key, parallelizes different keys', async () => { /* record start/end order: same-key runs never overlap; two keys overlap */ })
it('guards traversal and handles spaces', () => {
  const paths = new ProjectPaths('C:/x/My Projects/prj_0000000001')
  expect(() => paths.resolveAsset('../other/file.png')).toThrow(PathEscapeError)
  expect(paths.toRelative(paths.resolveAsset('panels/pnl_1/ver 1.png'))).toBe('panels/pnl_1/ver 1.png')
})
it('skips an unparsable trailing JSONL line', async () => {
  await appendJsonl(f, [{ n: 1 }, { n: 2 }]); await fs.promises.appendFile(f, '{"n":3')
  expect(await readJsonl(f, z.object({ n: z.number() }))).toEqual({ records: [{ n: 1 }, { n: 2 }], skipped: 1 })
})
```

- [ ] **Step 2:** Run `npx vitest run src/main/storage`. Expected: FAIL.
- [ ] **Step 3:** Implement the four modules and `errors.ts` to the signatures above.
- [ ] **Step 4:** Run `npx vitest run src/main/storage`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat: atomic storage primitives"`

### Task 4: ProjectStore, event bus, asset URLs

**Files:**
- Create: `src/main/events/bus.ts`, `src/main/storage/project-store.ts`, `src/shared/asset-url.ts`, `src/main/protocol/asset-protocol.ts`, `src/main/test/temp-project.ts`
- Modify: `src/main/index.ts` (register the scheme before ready, then the handler)
- Test: `src/main/storage/project-store.test.ts`, `src/shared/asset-url.test.ts`

**Interfaces:**
- Produces: `class EventBus { emit(e: AppEvent): void; subscribe(fn: (e: AppEvent) => void): () => void }`.
- Produces: `interface ProjectContext { id: string; paths: ProjectPaths; mutex: KeyedMutex; problems: ProjectProblem[] }`.
- Produces: `class ProjectStore`, constructed with `{ projectsRoot: string; bus: EventBus }`. Methods:
  - `addHooks(h: { onCreate?: (ctx) => Promise<void>; onOpen?: (ctx) => Promise<void> }): void`
  - `list(): Promise<{ projects: ProjectMeta[]; problems: ProjectProblem[] }>`, sorted by `updatedAt` descending; corrupt `project.json` files go to `problems`
  - `create(input: { title: string; logline?: string; stylePreset?: string }): Promise<ProjectContext>`. It creates the dirs `story characters episodes panels sessions uploads agent`, runs the `onCreate` hooks and emits `project.changed`.
  - `open(projectId): Promise<ProjectContext>`. It caches the context per id, runs the `onOpen` hooks once per id per instance, and throws `EntityNotFoundError('project', id)` for an unknown id.
  - `getMeta(ctx): Promise<ProjectMeta>`
  - `updateMeta(ctx, patch: Partial<Pick<ProjectMeta,'title'|'logline'|'stylePreset'|'storyMode'|'defaultAspect'|'autopilotPanels'|'consistencyRetries'>>): Promise<ProjectMeta>`, which bumps `updatedAt` and emits.
- Produces: `assetUrl(projectId, relPath): string` (`webtoon-asset://<projectId>/<encodeURI(relPath)>`) and `parseAssetUrl(url): { projectId: string; relPath: string }`.
- Produces: `registerAssetScheme(): void`, which registers `webtoon-asset` as privileged (`standard`, `secure`, `supportFetchAPI`). Also `handleAssetProtocol(store: ProjectStore): void`, which is `protocol.handle` → `parseAssetUrl` → `ctx.paths.resolveAsset` → `net.fetch(pathToFileURL(abs))`. A traversal attempt gets a 403 response.
- Produces: `tempProject(): Promise<{ store: ProjectStore; ctx: ProjectContext; bus: EventBus; events: AppEvent[]; root: string; cleanup(): Promise<void> }>`, used by later main-process tests. The temp root contains a space.

- [ ] **Step 1: Write the failing tests**

```ts
it('creates a project with defaults, dirs, hook and event', async () => {
  const onCreate = vi.fn(); store.addHooks({ onCreate })
  const ctx = await store.create({ title: 'Moon Diary' })
  const meta = await store.getMeta(ctx)
  expect(meta).toMatchObject({ title: 'Moon Diary', storyMode: 'user' })
  for (const d of ['story', 'characters', 'episodes', 'panels', 'sessions', 'uploads', 'agent']) expect(fs.existsSync(join(ctx.paths.projectFile(), '..', d))).toBe(true)
  expect(onCreate).toHaveBeenCalledWith(ctx); expect(events).toContainEqual({ type: 'project.changed', projectId: ctx.id })
})
it('lists newest first and reports corrupt projects', async () => { /* create a, b; corrupt c/project.json → projects [b,a], problems[0].path endsWith 'project.json' */ })
it('open runs onOpen once and rejects unknown ids', async () => { /* open twice → hook called once; open('prj_ffffffffff') rejects EntityNotFoundError */ })
it('round-trips asset urls with spaces', () => {
  const url = assetUrl('prj_00000000aa', 'panels/pnl_1/ver 1.png')
  expect(parseAssetUrl(url)).toEqual({ projectId: 'prj_00000000aa', relPath: 'panels/pnl_1/ver 1.png' })
})
```

- [ ] **Step 2:** Run `npx vitest run src/main/storage/project-store src/shared/asset-url`. Expected: FAIL.
- [ ] **Step 3:** Implement the bus, store, asset-url, protocol module and temp-project helper. In `src/main/index.ts`, call `registerAssetScheme()` at module top level and `handleAssetProtocol(store)` after `ready`. (Main wiring moves into `createServices` in Task 6.)
- [ ] **Step 4:** Run the tests above and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat: project store, event bus, asset protocol"`

### Task 5: SessionStore (JSONL transcripts)

**Files:**
- Create: `src/main/sessions/session-store.ts`
- Test: `src/main/sessions/session-store.test.ts`

**Interfaces:**
- Consumes: `appendJsonl`/`readJsonl` (Task 3), `ProjectContext` and `EventBus` (Task 4), `ChatMessageSchema` (Task 2).
- Produces: `class SessionStore`, constructed with `bus: EventBus` and `trash: (absPath: string) => Promise<void>`. Methods:
  - `list(ctx): Promise<SessionSummary[]>`, sorted by `updatedAt` descending
  - `create(ctx): Promise<SessionSummary>`, with title `New session`
  - `load(ctx, sessionId): Promise<ChatMessage[]>`
  - `append(ctx, sessionId, messages: ChatMessage[]): Promise<void>`
  - `rename(ctx, sessionId, title: string): Promise<void>`
  - `delete(ctx, sessionId): Promise<void>`
- A file holds JSONL records `{type:'meta', id, title, createdAt}`, `{type:'title', title, at}` and `{type:'message', message}`. On `append`, if the current title is still `New session`, the first user message's text is collapsed to one line, trimmed and cut to 60 chars, then written as a `title` record. All mutations run under the file's mutex and emit `session.changed`.

- [ ] **Step 1: Write the failing tests**

```ts
it('creates, auto-titles, lists newest first', async () => {
  const a = await sessions.create(ctx); const b = await sessions.create(ctx)
  await sessions.append(ctx, a.id, [userMsg('Create a cyberpunk heroine named Mina with silver hair\nand a red jacket please')])
  const list = await sessions.list(ctx)
  expect(list[0].id).toBe(a.id)
  expect(list[0].title).toBe('Create a cyberpunk heroine named Mina with silver hair and a')
  expect(list[0].messageCount).toBe(1); expect(list[1].title).toBe('New session')
})
it('loads messages in order and survives a truncated last line', async () => { /* append 2 msgs, append partial line → load returns 2 */ })
it('rename persists for a new store instance', async () => { /* rename → new SessionStore(...).list() shows new title */ })
it('delete sends the file to trash and emits', async () => { /* trash called with ctx.paths.sessionFile(id); event session.changed */ })
```

- [ ] **Step 2:** Run `npx vitest run src/main/sessions`. Expected: FAIL.
- [ ] **Step 3:** Implement `SessionStore`.
- [ ] **Step 4:** Run `npx vitest run src/main/sessions`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat: JSONL session store"`

### Task 6: Typed IPC, preload bridge, services wiring, sessions sidebar

**Files:**
- Create: `src/shared/ipc.ts`, `src/main/services.ts`, `src/main/ipc/register.ts`, `src/main/ipc/handlers/projects.ts`, `src/main/ipc/handlers/sessions.ts`, `src/renderer/src/api.ts`, `src/renderer/src/global.d.ts`, `src/renderer/src/stores/app-store.ts`, `src/renderer/src/events.ts`, `src/renderer/src/test/fake-api.ts`, `src/renderer/src/components/sessions/SessionSidebar.tsx`, `src/renderer/src/components/sessions/NewProjectDialog.tsx`, `src/main/test/test-services.ts`
- Modify: `src/preload/index.ts`, `src/main/index.ts`, `src/renderer/src/App.tsx`
- Test: `src/shared/ipc.test.ts`, `src/main/ipc/register.test.ts`, `src/renderer/src/api.test.ts`, `src/renderer/src/components/sessions/SessionSidebar.test.tsx`, `tests/e2e/sessions.spec.ts`

**Interfaces:**
- Produces in `ipc.ts`:
  - `interface IpcContract { [channel]: { req: …; res: … } }`
  - `type IpcChannel = keyof IpcContract`
  - `const IPC_CHANNELS: IpcChannel[]`, derived from `const channelSet: Record<IpcChannel, true>` so the compiler forces completeness
  - `EVENT_CHANNEL = 'app:event'`
- Channels added in this task:
  - `projects:list` → `{ projects: ProjectMeta[]; problems: ProjectProblem[] }`
  - `projects:create {title, logline?, stylePreset?}` → `ProjectMeta`
  - `projects:open {projectId}` → `{ meta: ProjectMeta; problems: ProjectProblem[] }`
  - `projects:update {projectId, patch}` → `ProjectMeta`
  - `sessions:list {projectId}` → `SessionSummary[]`
  - `sessions:create {projectId}` → `SessionSummary`
  - `sessions:rename {projectId, sessionId, title}` → `void`
  - `sessions:delete {projectId, sessionId}` → `void`
  - `sessions:load {projectId, sessionId}` → `ChatMessage[]`
- Produces in `services.ts`: `createServices(opts: ServicesOptions): Promise<Services>`, where `ServicesOptions = { projectsRoot: string; userDataDir: string; trash: (p: string) => Promise<void>; bus?: EventBus }` and `Services = { bus; projects: ProjectStore; sessions: SessionStore }`. Later tasks add fields to both types.
- Produces: `testServices(overrides?: Partial<ServicesOptions>): Promise<Services>` in `src/main/test/test-services.ts`. It builds real services on temp dirs whose paths contain a space, with test doubles for every Electron-backed option: `trash` records its paths; the fake `Encryptor` (Task 7) reverses strings; `identityImageOps` (Task 12) records calls; `templatesDir` points at the real `resources/agent-docs`. Any task that adds a `ServicesOptions` field also gives it a default here.
- Produces: `registerIpc(ipc: { handle(channel: string, fn: (e: unknown, req: unknown) => unknown): void }, services: Services): void`. It merges handler maps from `handlers/*.ts`. Each handler file exports `<domain>Handlers(s: Services): { [C in IpcChannel]?: (req: IpcContract[C]['req']) => Promise<IpcContract[C]['res']> }`.
- The preload exposes `window.api = { invoke(channel, req), onEvent(fn) → unsubscribe }`. `invoke` rejects any channel that is not in `IPC_CHANNELS`. The preload's only runtime imports are `electron` and `IPC_CHANNELS`/`EVENT_CHANNEL` from `@shared/ipc`; everything else uses `import type`. `src/shared/ipc.ts` itself has no runtime imports, only `import type` from schemas and types, so zod never enters the preload bundle.
- The renderer `api.ts` exports `api.invoke<C extends IpcChannel>(c: C, req: IpcContract[C]['req']): Promise<IpcContract[C]['res']>` and `api.onEvent`. It also exports `cleanIpcError(e: unknown): Error`, which strips Electron's `Error invoking remote method '<ch>': Error: ` prefix.
- Produces `useAppStore` (Zustand).
  - State: `projects`, `projectId`, `problems`, `sessions`, `sessionId`, `selectedPanelId`, `activeEpisodeId`, `rightTab: 'webtoon'|'characters'|'story'` and `runningThreads: Record<string, string>` (thread key to run id).
  - Actions: `loadProjects`, `createProject(title)`, `openProject(id)`, `loadSessions`, `newSession`, `selectSession`, `renameSession`, `deleteSession`, `selectPanel(id|null)`, `setRightTab`.
  - The last project id is kept in `localStorage`, wrapped in try/catch.
- Produces `startEventSync(): () => void`, which subscribes to `api.onEvent` and refreshes `sessions` on `session.changed`. Later tasks add more cases.
- Produces `installFakeApi(handlers: Partial<Record<IpcChannel, (req) => unknown>>): { calls: { channel; req }[]; emit(e: AppEvent): void }`.
- `src/main/index.ts` builds the services (`projectsRoot` defaults to `join(app.getPath('documents'), 'Webtoon AI Harness', 'projects')`, `trash` is `shell.trashItem`), calls `registerIpc(ipcMain, services)` and forwards every bus event to every window over `EVENT_CHANNEL`.

- [ ] **Step 1: Write the failing tests**

```ts
// ipc.test.ts
it('has unique channels', () => expect(new Set(IPC_CHANNELS).size).toBe(IPC_CHANNELS.length))
// register.test.ts — this test enforces that every later channel gets a handler
it('registers a handler for every channel', async () => {
  const handled: string[] = []; registerIpc({ handle: (c) => handled.push(c) }, await testServices())
  expect(handled.sort()).toEqual([...IPC_CHANNELS].sort())
})
// api.test.ts
it('cleans electron error prefixes', () =>
  expect(cleanIpcError(new Error("Error invoking remote method 'sessions:load': Error: Session not found")).message).toBe('Session not found'))
// SessionSidebar.test.tsx
it('creates and selects a new session', async () => { /* fake sessions:create → click new-session → store.sessionId === new id, item rendered */ })
it('renames on double-click + Enter', async () => { /* calls sessions:rename with typed title */ })
it('deletes after confirm', async () => { /* context menu Delete → confirm → sessions:delete called */ })
it('shows running dot for running sessions', () => { /* runningThreads[sessionId] set → item has data-running="true" */ })
it('creates a project from the empty state', async () => { /* no projects → new-project → title → projects:create, then openProject */ })
```

```ts
// tests/e2e/sessions.spec.ts
test('sessions persist across relaunch', async () => {
  const first = await launchApp()
  await first.page.getByTestId('new-project').click(); await first.page.getByLabel('Title').fill('Moon Diary'); await first.page.getByRole('button', { name: 'Create' }).click()
  await first.page.getByTestId('new-session').click()
  await expect(first.page.getByTestId('session-item')).toHaveCount(1); await first.app.close()
  const second = await launchApp({ userDataDir: first.userDataDir, projectsRoot: first.projectsRoot })
  await expect(second.page.getByTestId('session-item')).toHaveCount(1); await second.app.close()
})
```

- [ ] **Step 2:** Run `npx vitest run src/shared/ipc src/main/ipc src/renderer`. Expected: FAIL.
- [ ] **Step 3:** Implement the contract, services, register, handlers, preload, api, store, event sync, sidebar and dialog. The sidebar holds the project select (`project-select`), the `new-project` button, the `new-session` button (also bound to Ctrl+N) and `session-item` rows showing the title and relative time. Clicking a row selects it. Double-click renames inline. The context menu offers Rename and Delete. The sidebar ends with a `settings-open` button that does nothing until Task 13. `NewProjectDialog` has an input labelled `Title` and a `Create` button.
- [ ] **Step 4:** Run `npm test`, `npm run typecheck` and `npm run test:e2e`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat: typed IPC bridge and sessions sidebar"`

### Task 7: Model registry and encrypted secrets

**Files:**
- Create: `src/main/models/secrets.ts`, `src/main/models/electron-encryptor.ts`, `src/main/models/registry.ts`, `src/main/ipc/handlers/models.ts`
- Modify: `src/shared/ipc.ts`, `src/main/services.ts` (adds `registry`; `ServicesOptions` gains `encryptor: Encryptor`), `src/main/index.ts`
- Test: `src/main/models/registry.test.ts`, `src/main/models/secrets.test.ts`

**Interfaces:**
- Produces: `interface Encryptor { isAvailable(): boolean; encrypt(plain: string): Buffer; decrypt(cipher: Buffer): string }`. `electronEncryptor` wraps `safeStorage`.
- Produces: `class SecretStore`, constructed with `file: string` and `enc: Encryptor`. Methods: `load()`, `get(endpointId): string|null` and `set(endpointId, key: string|null): Promise<void>`. The file holds base64 ciphertexts. `set` throws `SecretsUnavailableError` when `!enc.isAvailable()`.
- Produces: `class ModelRegistry`, constructed with `{ file: string; secrets: SecretStore; bus: EventBus }`. Methods:
  - `load()`
  - `view(): ModelRegistryView`
  - `addEndpoint({name, kind, baseUrl, options?})`, `updateEndpoint(id, patch)`
  - `removeEndpoint(id): Promise<{ clearedRoles: Role[] }>`, which cascades to the endpoint's models and its secret
  - `setApiKey(endpointId, key|null)`
  - `addModel({endpointId, modelId, label, capabilities, params?, maxReferenceImages?})`, `updateModel(id, patch)`
  - `removeModel(id): Promise<{ clearedRoles: Role[] }>`
  - `assignRole(role, modelId|null)`
  - `resolve(role): ResolvedModel`, which throws `NoModelForRoleError` with the message `No model assigned to role '<role>'. Open Settings → Models.`
  - `resolveOptional(role): ResolvedModel|null`
- `ResolvedModel = { endpoint: EndpointConfig; model: ModelConfig; apiKey: string|null }`.
- Role rules from §7:
  - Required capabilities: `agent`/`panelChat` need `text`, `vision` needs `vision`, `image` needs `image-gen`, `imageEdit` needs `image-edit`.
  - Fallbacks: `panelChat` falls back to `agent`, and `imageEdit` falls back to `image`.
  - Kind/capability compatibility: `anthropic` allows `text`/`vision`, `gemini` allows image capabilities only, `openai` and `mock` allow everything.
  - Violations throw `CapabilityError`.
- First `load()` with no file seeds endpoint `end_0000000000` "Mock (offline)" of kind `mock` (baseUrl `mock://local`). It also seeds models `mdl_000000000a` (`mock-text`, `text`+`vision`) and `mdl_000000000b` (`mock-image`, `image-gen`+`image-edit`), with roles `agent` → `mdl_000000000a` and `image` → `mdl_000000000b`. `vision` is left unassigned.
- Every mutation persists atomically and emits `models.changed`.
- New IPC channels: `models:get` → `ModelRegistryView`; `models:addEndpoint`, `models:updateEndpoint`, `models:removeEndpoint` → `{clearedRoles}`; `models:setApiKey {endpointId, key}`; `models:addModel`, `models:updateModel`, `models:removeModel` → `{clearedRoles}`; `models:assignRole {role, modelId}`.

- [ ] **Step 1: Write the failing tests**

```ts
it('seeds the mock endpoint on first load', async () => {
  const v = registry.view()
  expect(v.endpoints.map(e => e.kind)).toEqual(['mock'])
  expect(v.effectiveRoles).toEqual({ agent: 'mdl_000000000a', panelChat: 'mdl_000000000a', vision: null, image: 'mdl_000000000b', imageEdit: 'mdl_000000000b' })
})
it('persists across instances', async () => { /* addEndpoint+addModel → new ModelRegistry(same file).load() → same view */ })
it('never exposes or stores the plaintext key', async () => {
  const e = await registry.addEndpoint({ name: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com' })
  await registry.setApiKey(e.id, 'sk-ant-SECRET')
  expect(JSON.stringify(registry.view())).not.toContain('SECRET')
  expect(await fs.promises.readFile(secretsFile, 'utf8')).not.toContain('SECRET')
  expect(registry.view().endpoints.find(x => x.id === e.id)!.hasKey).toBe(true)
  expect(registry.resolve('agent').apiKey).toBeNull() // agent still on mock
})
it('rejects role/capability mismatches', async () => { /* assign 'image' to a text-only model → CapabilityError; add image-gen model to anthropic endpoint → CapabilityError */ })
it('clears roles when a model is removed (Review Focus 3)', async () => {
  const { clearedRoles } = await registry.removeModel('mdl_000000000a')
  expect(clearedRoles).toEqual(['agent'])
  expect(() => registry.resolve('agent')).toThrow("No model assigned to role 'agent'. Open Settings → Models.")
})
it('removing an endpoint cascades models, roles and secret', async () => { /* removeEndpoint(mock) → models [], clearedRoles ['agent','image'], secrets.get → null */ })
it('refuses keys when encryption is unavailable', async () => { /* enc.isAvailable=false → setApiKey rejects SecretsUnavailableError */ })
```

Use a fake `Encryptor` in tests: `encrypt` reverses the string into a Buffer.

- [ ] **Step 2:** Run `npx vitest run src/main/models`. Expected: FAIL.
- [ ] **Step 3:** Implement the secrets, encryptor, registry and model IPC handlers. Wire them in services and main. `models.json` and `secrets.json` live in `userDataDir`.
- [ ] **Step 4:** Run `npm test` (which includes the IPC completeness test) and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat: model registry with encrypted keys and role assignment"`

### Task 8: Provider contracts, mock providers, factory

**Files:**
- Create: `src/main/models/providers/types.ts`, `src/main/models/providers/png.ts`, `src/main/models/providers/mock.ts`, `src/main/models/providers/factory.ts`
- Test: `src/main/models/providers/mock.test.ts`, `src/main/models/providers/png.test.ts`, `src/main/models/providers/factory.test.ts`

**Interfaces:**
- Produces in `types.ts`:
  - `ToolSpec { name; description; inputSchema: Record<string, unknown> }`
  - `ImageLoader = (relPath: string) => Promise<{ mime: string; base64: string }>`
  - `TextTurnRequest { system; messages: ChatMessage[]; tools: ToolSpec[]; loadImage: ImageLoader; signal: AbortSignal; onTextDelta?: (t: string) => void }`
  - `TextTurnResult { text; toolCalls: ToolCall[]; stopReason: 'end'|'tool_use'|'max_tokens'|'refusal'; raw: { provider: 'anthropic'; content: unknown[] } | null }`
  - `TextProvider { runTurn(req: TextTurnRequest): Promise<TextTurnResult> }`
  - `ImageRef { mime: string; data: Buffer; label: string }`
  - `ImageRequest { prompt; references: ImageRef[]; aspect: PanelAspect; signal: AbortSignal }`
  - `ImageEditRequest extends ImageRequest { source: ImageRef }`
  - `ImageResult { mime: 'image/png'|'image/jpeg'|'image/webp'; data: Buffer }`
  - `ImageProvider { generate(req: ImageRequest): Promise<ImageResult>; edit(req: ImageEditRequest): Promise<ImageResult> }`
  - `class ProviderError extends Error { kind: 'auth'|'rate_limit'|'bad_request'|'network'|'timeout'|'unknown' }`
- Produces: `encodeSolidPng(width: number, height: number, rgb: [number, number, number]): Buffer`. It builds a valid PNG with `node:zlib` `deflateSync` and `crc32`.
- Produces:
  - `MockScript = { turns: { text?: string; toolCalls?: { name: string; input: unknown }[] }[] }`
  - `loadMockScript(path: string): MockScript`
  - `class MockTextProvider`, constructed with `scriptPath: string|null`. It uses one module-level cursor per script path, so all runs in the app share it. Tool call ids are `mock_call_<n>`. `stopReason` is `tool_use` when the turn has tool calls, else `end`. When there is no script or the script is exhausted, it replies `(mock) <last user message text>`. Turn text goes through `onTextDelta` once.
  - `class MockImageProvider`. It returns a PNG sized from the aspect ratio at 128 px per unit (2:3 → 256×384), with a color hashed from the prompt, the reference count and `edit`/`generate`.
- Produces: `createTextProvider(r: ResolvedModel): TextProvider` and `createImageProvider(r: ResolvedModel): ImageProvider`. Only `mock` is implemented for now; other kinds throw `UnsupportedCapabilityError` until Tasks 9, 10 and 14 add them. `gemini` text and `anthropic` image always throw.

- [ ] **Step 1: Write the failing tests**

```ts
it('encodes a decodable PNG', () => {
  const png = encodeSolidPng(4, 6, [255, 0, 0])
  expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  expect(png.readUInt32BE(16)).toBe(4); expect(png.readUInt32BE(20)).toBe(6) // IHDR width/height
})
it('plays the script then echoes', async () => {
  const p = new MockTextProvider(writeScript({ turns: [{ toolCalls: [{ name: 'list_characters', input: {} }] }, { text: 'Done.' }] }))
  const r1 = await p.runTurn(req('hi')); expect(r1).toMatchObject({ stopReason: 'tool_use', toolCalls: [{ id: 'mock_call_1', name: 'list_characters', input: {} }] })
  const deltas: string[] = []; const r2 = await p.runTurn({ ...req('hi'), onTextDelta: d => deltas.push(d) })
  expect(r2).toMatchObject({ text: 'Done.', stopReason: 'end' }); expect(deltas).toEqual(['Done.'])
  expect((await p.runTurn(req('again'))).text).toBe('(mock) again')
})
it('mock image honors aspect', async () => { /* aspect '2:3' → width 256 height 384 read from IHDR */ })
it('factory picks mock and rejects unsupported combos', () => { /* mock → instances; gemini text → UnsupportedCapabilityError */ })
```

- [ ] **Step 2:** Run `npx vitest run src/main/models/providers`. Expected: FAIL.
- [ ] **Step 3:** Implement the four modules. The factory reads the script path from `process.env.WEBTOON_MOCK_SCRIPT ?? null`.
- [ ] **Step 4:** Run `npx vitest run src/main/models/providers`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat: provider contracts and offline mock providers"`

### Task 9: Anthropic text adapter

**Files:**
- Create: `src/main/models/providers/anthropic.ts`
- Modify: `src/main/models/providers/factory.ts`
- Test: `src/main/models/providers/anthropic.test.ts`

**Interfaces:**
- Consumes: the Task 8 types; `ResolvedModel` (Task 7).
- Produces: `class AnthropicTextProvider implements TextProvider`, constructed with `r: ResolvedModel` and an optional `client?: AnthropicClientLike`. The default client is `new Anthropic({ apiKey: r.apiKey ?? undefined, baseURL: r.endpoint.baseUrl })`. `AnthropicClientLike` has `messages.stream(params, opts)` and `beta.messages.stream(params, opts)`, each returning `{ on(ev: 'text', cb): this; finalMessage(): Promise<Message> }`.
- Produces these pure exports:
  - `toAnthropicMessages(messages: ChatMessage[], loadImage: ImageLoader): Promise<MessageParam[]>`
  - `replayableContent(content: unknown[]): unknown[]`
  - `executableToolUses(content: unknown[]): ToolUseBlock[]`
  - `shouldUseServerFallback(r: ResolvedModel): boolean`
- Request rules (§7) to implement:
  - `model: r.model.modelId`, `max_tokens: r.model.params.max_tokens ?? 64000`, `system`, `messages`. The adapter reads only the params `effort` and `max_tokens`; any other key is ignored, because current Claude models reject sampling params.
  - tools as `{name, description, input_schema, eager_input_streaming: true}`; no `tool_choice`; no `thinking`
  - `output_config: { effort: r.model.params.effort ?? 'high' }`, `cache_control: { type: 'ephemeral' }`
  - when `shouldUseServerFallback`, use `client.beta.messages.stream` with `betas: ['server-side-fallback-2026-07-01']` and `fallbacks: 'default'`; otherwise use `client.messages.stream`
  - `stream.on('text', onTextDelta)` and `await stream.finalMessage()`
  - pass `signal` in the request options
  - If the installed SDK types lack `fallbacks` or `output_config`, extend the params type locally rather than casting to `any`.
- `shouldUseServerFallback` is true when the endpoint's `options.serverSideFallback !== false`, the `baseUrl` is `https://api.anthropic.com` (trailing slash optional) and `modelId` starts with `claude-opus-5`, `claude-sonnet-5` or `claude-fable-5`.
- Message mapping:
  - A user message becomes `[text(stateSnapshot)?, text(text), image blocks for imagePaths]`.
  - An assistant message with `raw` becomes `raw.content` unchanged. Without `raw`, it becomes a text block plus `tool_use` blocks.
  - A tool message becomes a user message of `tool_result` blocks (`is_error: !ok`). Each block's content is the text plus base64 image blocks for `images`.
  - An assistant message that would map to zero content blocks (for example a refusal with no text) is left out of the request, because the API rejects empty assistant content.
- Result mapping:
  - `text` is the joined text blocks.
  - `toolCalls` come from `executableToolUses` and are empty when `stop_reason` is `refusal` or `max_tokens`.
  - `stopReason` maps `end_turn`/`stop_sequence`/`pause_turn` → `end`, `tool_use` → `tool_use`, `max_tokens` → `max_tokens`, `refusal` → `refusal`.
  - `raw = { provider: 'anthropic', content: replayableContent(message.content) }`.
- Fallback handling: when the content has a `fallback` block, `replayableContent` and `executableToolUses` drop the `thinking`, `redacted_thinking` and `tool_use` blocks that come before the **last** `fallback` block.
- SDK error classes map to `ProviderError.kind`: `AuthenticationError`/`PermissionDeniedError` → `auth`, `RateLimitError` → `rate_limit`, `BadRequestError` → `bad_request`, `APIConnectionError` → `network`, otherwise `unknown`.

- [ ] **Step 1: Write the failing tests** (use a fake client that records params and returns a canned `Message`)

```ts
it('builds the request', async () => {
  await provider('claude-opus-5-5').runTurn(req({ tools: [spec('list_characters')] }))
  const [params, opts] = fake.beta.messages.stream.mock.calls[0]
  expect(params).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 64000, output_config: { effort: 'high' }, cache_control: { type: 'ephemeral' }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
  expect(params.tools[0]).toMatchObject({ name: 'list_characters', eager_input_streaming: true }); expect(params.tool_choice).toBeUndefined(); expect(params.thinking).toBeUndefined()
  expect(opts.signal).toBeInstanceOf(AbortSignal)
})
it('skips fallbacks for haiku, proxies and when disabled', () => {
  expect(shouldUseServerFallback(resolved({ modelId: 'claude-haiku-5-5' }))).toBe(false)
  expect(shouldUseServerFallback(resolved({ baseUrl: 'https://proxy.example.com' }))).toBe(false)
  expect(shouldUseServerFallback(resolved({ options: { serverSideFallback: false } }))).toBe(false)
})
it('replays raw assistant content unchanged', async () => { /* raw content with a thinking block → identical object in mapped messages */ })
it('maps tool results with images and errors', async () => { /* ok:false → is_error true; images → image block inside tool_result content */ })
it('puts the state snapshot before the user text', async () => { /* content[0].text startsWith '<project_state>' */ })
it('never executes tools on refusal or max_tokens', async () => { /* stop_reason refusal with tool_use block → toolCalls [] stopReason 'refusal' */ })
it('drops pre-fallback tool_use and thinking', () => {
  const c = [{ type: 'thinking', thinking: '' }, { type: 'tool_use', id: 'a', name: 'x', input: {} }, { type: 'fallback', from: {}, to: {} }, { type: 'text', text: 'hi' }, { type: 'tool_use', id: 'b', name: 'y', input: {} }]
  expect(executableToolUses(c).map(t => t.id)).toEqual(['b'])
  expect(replayableContent(c).map((b: any) => b.type)).toEqual(['fallback', 'text', 'tool_use'])
})
it('forwards text deltas', async () => { /* fake stream emits 'He','llo' → onTextDelta called twice */ })
it('omits empty assistant turns and ignores sampling params', async () => { /* assistant {text:'', toolCalls:[], raw:null} absent from params.messages; params {temperature:0.2} → params.temperature undefined */ })
it('maps auth errors', async () => { /* finalMessage rejects new Anthropic.AuthenticationError(...) → ProviderError kind 'auth' */ })
```

- [ ] **Step 2:** Run `npx vitest run src/main/models/providers/anthropic`. Expected: FAIL.
- [ ] **Step 3:** Implement the adapter and register `anthropic` text in the factory.
- [ ] **Step 4:** Run `npx vitest run src/main/models/providers` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat: anthropic text adapter with tool use and refusal fallback"`

### Task 10: OpenAI-compatible chat adapter

**Files:**
- Create: `src/main/models/providers/openai-chat.ts`
- Modify: `src/main/models/providers/factory.ts`
- Test: `src/main/models/providers/openai-chat.test.ts`

**Interfaces:**
- Produces: `class OpenAIChatProvider implements TextProvider`, constructed with `r: ResolvedModel` and an optional `client?: { chat: { completions: { create; stream } } }`. The default client is `new OpenAI({ apiKey: r.apiKey ?? 'not-needed', baseURL: r.endpoint.baseUrl })`.
- Produces: `toOpenAIMessages(system: string, messages: ChatMessage[], loadImage: ImageLoader, vision: boolean): Promise<ChatCompletionMessageParam[]>`.
- Mapping:
  - `system` comes first.
  - A user message becomes text (snapshot, then text) plus `image_url` data URLs when `vision`; otherwise each image becomes the text `[image omitted: model has no vision capability]`.
  - An assistant message becomes `content` plus `tool_calls` (`{id, type:'function', function:{name, arguments: JSON.stringify(input)}}`).
  - Each tool result becomes `{role:'tool', tool_call_id, content}`. Results that carry images are followed by one user message holding those images (when `vision`).
- Tools are sent as `{type:'function', function:{name, description, parameters}}`.
- Request: `{ model, messages, tools, ...params }` with `params.stream` removed.
  - When `params.stream === false`, call `create` (non-streaming).
  - Otherwise use `client.chat.completions.stream(...)`: forward content deltas through the stream's content-delta event (`content.delta` in current SDK versions; confirm against the installed `ChatCompletionStream` event types) and resolve with `finalChatCompletion()`.
- Parse tool-call arguments with `JSON.parse`. When parsing fails, keep the raw string as `input`; the tool registry then rejects it as invalid input.
- `finish_reason` maps `stop` → `end`, `tool_calls` → `tool_use`, `length` → `max_tokens`, `content_filter` → `refusal`. `raw` is always `null`. Error mapping uses the OpenAI SDK error classes, mirroring Task 9.

- [ ] **Step 1: Write the failing tests**

```ts
it('maps tools and assistant tool calls', async () => { /* assert function tool shape and tool_calls arguments JSON string */ })
it('sends tool results as role tool and images as a follow-up user message', async () => { /* vision true → messages[n].role 'tool', messages[n+1].content[0].type 'image_url' */ })
it('omits images for non-vision models', async () => { /* contains '[image omitted: model has no vision capability]' */ })
it('parses tool call arguments and keeps invalid JSON raw', async () => { /* '{"a":1}' → {a:1}; '{oops' → '{oops' */ })
it('maps finish reasons', async () => { /* length → max_tokens; tool_calls → tool_use */ })
it('merges params and honors stream:false', async () => { /* params {temperature:0.4, stream:false} → create called with temperature 0.4, no stream key */ })
```

- [ ] **Step 2:** Run `npx vitest run src/main/models/providers/openai-chat`. Expected: FAIL.
- [ ] **Step 3:** Implement the adapter and register `openai` text in the factory.
- [ ] **Step 4:** Run `npx vitest run src/main/models/providers`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat: openai-compatible chat adapter"`

### Task 11: Tool registry and the agent loop

**Files:**
- Create: `src/main/agent/tools/registry.ts`, `src/main/agent/loop.ts`
- Test: `src/main/agent/tools/registry.test.ts`, `src/main/agent/loop.test.ts`

**Interfaces:**
- Produces:
  - `interface ToolContext { project: ProjectContext; services: Services; signal: AbortSignal; threadKey: string }`
  - `interface ToolOutput { content: string | Record<string, unknown>; images?: string[] }`
  - `defineTool<S extends z.ZodType>(def: { name: string; description: string; input: S; handler(input: z.infer<S>, ctx: ToolContext): Promise<ToolOutput> })`
  - `class ToolError extends Error`, for user-facing handler failures
  - `class ToolRegistry`, constructed with `defs`. Methods: `names(): string[]`, `specs(): ToolSpec[]` (`inputSchema` via `z.toJSONSchema`), and `execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult>`. `execute` never throws:
    - for an unknown tool it returns `ok:false` with `Unknown tool: <name>`
    - for invalid input it returns `ok:false` with `Invalid input for <name>: <zod issues, path: message>`
    - when the handler throws it returns `ok:false` with the error message
    - object content is JSON-stringified
- Produces: `runAgentLoop(opts): Promise<{ outcome: LoopOutcome; error: string|null }>`.
  - `opts = { runId; provider: TextProvider; system; history: ChatMessage[]; tools: ToolRegistry; toolCtx: Omit<ToolContext,'signal'>; model: { endpointId; modelId }; loadImage: ImageLoader; signal: AbortSignal; maxSteps?: number /* 24 */; persist(msgs: ChatMessage[]): Promise<void>; emit(e: AgentEvent): void }`
  - `history` already ends with the new user message.
  - Each step: `runTurn` → persist and emit the assistant message.
    - `refusal` returns `refusal` with the error `The model declined this request.`
    - `max_tokens` returns `max_tokens`.
    - No tool calls returns `end`.
    - Otherwise each call runs sequentially, emitting `tool-started` first, and then one tool message is persisted and emitted.
  - When the abort signal fires, every not-yet-executed call gets `{ ok: false, content: 'Cancelled by user' }`, the tool message is still persisted, and the loop returns `cancelled`.
  - A `ProviderError` returns `error` with its message.
  - Exceeding `maxSteps` returns `max_steps`.
  - It always emits `run-finished`.

- [ ] **Step 1: Write the failing tests**

```ts
it('validates input and never throws', async () => {
  const reg = new ToolRegistry([defineTool({ name: 'echo', description: 'e', input: z.object({ s: z.string() }), handler: async ({ s }) => ({ content: s }) })])
  expect(await reg.execute({ id: '1', name: 'echo', input: { s: 1 } }, ctx)).toMatchObject({ ok: false, content: expect.stringContaining('Invalid input for echo') })
  expect(await reg.execute({ id: '2', name: 'nope', input: {} }, ctx)).toMatchObject({ ok: false, content: 'Unknown tool: nope' })
  expect(reg.specs()[0].inputSchema).toMatchObject({ type: 'object', properties: { s: { type: 'string' } } })
})
it('runs tool then finishes', async () => { /* mock script [toolCalls echo, text 'done'] → persisted roles ['assistant','tool','assistant'], outcome 'end' */ })
it('stops at maxSteps', async () => { /* script of 3 tool turns, maxSteps 2 → 'max_steps' */ })
it('cancel during tool execution leaves a result for every tool call (Review Focus 1)', async () => {
  // assistant turn has 3 calls; the first handler aborts the controller
  const { outcome } = await runAgentLoop({ ...opts, signal: ctrl.signal })
  const tool = persisted.find(m => m.role === 'tool')!
  expect(outcome).toBe('cancelled')
  expect(tool.results.map(r => r.toolCallId)).toEqual(['mock_call_1', 'mock_call_2', 'mock_call_3'])
  expect(tool.results.slice(1).every(r => !r.ok && r.content === 'Cancelled by user')).toBe(true)
})
it('reports provider errors and refusals', async () => { /* provider throws ProviderError('rate limited','rate_limit') → outcome 'error', error 'rate limited'; refusal → 'refusal' */ })
```

- [ ] **Step 2:** Run `npx vitest run src/main/agent`. Expected: FAIL.
- [ ] **Step 3:** Implement the registry and loop.
- [ ] **Step 4:** Run `npx vitest run src/main/agent`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat: tool registry and provider-agnostic agent loop"`

### Task 12: Workflow docs loader, system prompt, image loading, AgentRunner

**Files:**
- Create: `resources/agent-docs/AGENTS.md` (stub: `# Webtoon Agent`, `## Mission` with one paragraph, and `## Hard Rules` with R1–R12 copied from §11), `src/main/agent/workflow-docs.ts`, `src/main/agent/system-prompt.ts`, `src/main/domain/image-ops.ts`, `src/main/domain/electron-image-ops.ts`, `src/main/agent/agent-runner.ts`, `src/main/agent/tools/index.ts`, `src/main/ipc/handlers/agent.ts`
- Modify: `src/main/models/providers/mock.ts` (adds `resolveMockRefs`), `src/shared/ipc.ts`, `src/main/services.ts` (adds `docs`, `imageOps` and `agent`; `ServicesOptions` gains `templatesDir: string` and `imageOps: ImageOps`, and the services install the docs through `projects.addHooks({ onCreate })`), `src/main/index.ts` (sets `templatesDir = join(app.getAppPath(), 'resources', 'agent-docs')`)
- Test: `src/main/agent/workflow-docs.test.ts`, `src/main/agent/system-prompt.test.ts`, `src/main/agent/agent-runner.test.ts`, `src/main/domain/image-ops.test.ts`

**Interfaces:**
- Produces:
  - `interface ImageOps { downscale(data: Buffer, maxEdge: number): Promise<{ mime: string; data: Buffer }>; size(data: Buffer): { width: number; height: number } }`
  - `MAX_TEXT_MODEL_IMAGE_EDGE = 1568`, `MAX_REFERENCE_IMAGE_EDGE = 1536`
  - `identityImageOps`, a test double that records calls
  - `electronImageOps`, built on `nativeImage`: resize when the long edge exceeds the limit, then `toPNG()`
  - `loadImageForTextModel(ctx: ProjectContext, imageOps: ImageOps, relPath: string): Promise<{ mime; base64 }>`
- Produces: `class WorkflowDocs`, constructed with `templatesDir: string`. Methods:
  - `install(ctx)`, which copies only missing files
  - `reset(ctx)`, which overwrites all files
  - `list(ctx): Promise<{ name: string; title: string }[]>`. `name` is the path relative to `agent/` without `.md` and with POSIX slashes, `AGENTS` excluded; `title` is the first `# ` heading.
  - `read(ctx, name): Promise<string>`, which throws `EntityNotFoundError('doc', name)` and blocks traversal
  - `agentsMd(ctx): Promise<string>`
- Produces in `system-prompt.ts`:
  - `buildAgentSystemPrompt(agentsMd: string, index: { name: string; title: string }[]): string`. This is the AGENTS.md text, then `## Available workflow docs` with lines `- <name>: <title>` and the sentence `Read a doc with read_workflow_doc before the task it governs.`
  - `buildStateSnapshot(s: { meta: ProjectMeta; characters: Character[]; episode: Episode | null; recentPanels: Panel[] }): string`. Its exact line shape:

```
<project_state>
title: Moon Diary
story_mode: user
style: <stylePreset>
current_episode: epi_… "Episode 1" (3 panels)
characters:
- chr_… Mina [protagonist] variations: var_… Base (ready), var_… Outfit: School uniform (pending)
recent_panels:
- pnl_… [medium] cast: Mina (var_…) | <description, first 160 chars> | dialogue: Mina: "…"
</project_state>
```

  Empty lists render as `characters: none` and `recent_panels: none`. With no episode, the line is `current_episode: none`. Archived characters are omitted.
  - `extractSection(markdown: string, heading: string): string`, which returns that `## ` section's body
- Produces `buildAgentTools(opts: { vision: boolean }): ToolRegistry` in `tools/index.ts`. It is empty for now; later tasks add tool groups. `AgentRunner` builds it per run with `vision: agentModel.capabilities.includes('vision')`.
- Produces: `resolveMockRefs(input: unknown, snapshot: string | null): unknown`, which `MockTextProvider` applies to every scripted tool-call input. It reads the latest user message's `stateSnapshot` (the format above) and recursively replaces three placeholders:
  - `{"$character": "<name>"}` becomes that character's id.
  - `{"$variation": ["<character name>", "<variation name>"]}` becomes that variation's id.
  - `{"$episode": "current"}` becomes the `current_episode` id.
  
  An unresolvable placeholder stays as it is, so the tool returns a visible validation error. End-to-end scripts use this because ids are random. Characters must therefore be created in an earlier user turn than the panels that cast them.
- Produces: `class AgentRunner`, constructed with `{ services: Services; createTextProvider?: (r: ResolvedModel) => TextProvider }`. Methods:
  - `start(input: { projectId; sessionId; text; imagePaths: string[]; activeEpisodeId: string | null }): Promise<{ runId: string }>`
  - `cancel(runId): void`
  - `isRunning(threadKey): boolean`
  - a protected `gatherState(ctx, activeEpisodeId): Promise<Parameters<typeof buildStateSnapshot>[0]>`. It returns meta only for now; Tasks 16 and 19 extend it.
- `start` behavior:
  - It throws `SessionBusyError` when the session is already running.
  - It resolves the `agent` role. On `NoModelForRoleError` it persists the user message, emits `run-finished` with outcome `error` and that message, and returns the run id.
  - It persists the user message with its `stateSnapshot`, emits `run-started`, then runs `runAgentLoop` in the background with `threadKey = sessionId`.
  - Every `AgentEvent` goes on the bus as `agent.event`.
- New IPC channels: `agent:send {projectId, sessionId, text, imagePaths, activeEpisodeId}` → `{ runId }`, and `agent:cancel {runId}` → `void`.

- [ ] **Step 1: Write the failing tests**

```ts
it('installs missing docs only and lists them', async () => { /* templates AGENTS.md + workflows/a.md('# A') ; pre-edit project AGENTS.md → install keeps edit; list → [{name:'workflows/a', title:'A'}]; read('../x') rejects */ })
it('builds a stable system prompt', () => {
  const s = buildAgentSystemPrompt('# Webtoon Agent\n...', [{ name: 'workflows/panel-generation', title: 'Panel Generation' }])
  expect(s).toContain('# Webtoon Agent'); expect(s).toContain('- workflows/panel-generation: Panel Generation')
})
it('renders the state snapshot', () => {
  const s = buildStateSnapshot({ meta: makeMeta({ title: 'Moon Diary' }), characters: [], episode: null, recentPanels: [] })
  expect(s.split('\n')[0]).toBe('<project_state>'); expect(s).toContain('story_mode: user'); expect(s).toContain('characters: none'); expect(s.trim().endsWith('</project_state>')).toBe(true)
})
it('downscales oversized attachments for text models', async () => { /* identityImageOps sees downscale(…, 1568) */ })
it('mock resolves name refs from the snapshot', () => {
  const snap = '<project_state>\ncurrent_episode: epi_00000000e1 "Episode 1" (0 panels)\ncharacters:\n- chr_00000000c1 Mina [protagonist] variations: var_00000000v1 Base (ready), var_00000000v2 Outfit: School uniform, red tie (ready)\nrecent_panels: none\n</project_state>'
  expect(resolveMockRefs({ e: { $episode: 'current' }, c: [{ characterId: { $character: 'Mina' }, variationId: { $variation: ['Mina', 'Outfit: School uniform, red tie'] } }] }, snap))
    .toEqual({ e: 'epi_00000000e1', c: [{ characterId: 'chr_00000000c1', variationId: 'var_00000000v2' }] })
})
it('persists the user message with snapshot and replies', async () => { /* mock script [{text:'Hello from mock'}] → session has user(stateSnapshot startsWith '<project_state>') + assistant('Hello from mock'); events include run-started, message, run-finished(end) */ })
it('rejects a second run on a busy session', async () => { /* start twice without awaiting completion → second rejects SessionBusyError */ })
it('reports a missing agent model (Review Focus 3)', async () => { /* removeModel(agent) → start resolves; run-finished outcome 'error', error "No model assigned to role 'agent'. Open Settings → Models." */ })
```

- [ ] **Step 2:** Run `npx vitest run src/main/agent src/main/domain/image-ops`. Expected: FAIL.
- [ ] **Step 3:** Implement the stub doc, image ops, docs, prompts, runner and IPC, and wire the services. If `templatesDir` doesn't contain `AGENTS.md`, `createServices` throws `Workflow doc templates not found at <path>` at startup, which is better than failing later during project creation. `AgentRunner` passes `loadImage = rel => loadImageForTextModel(ctx, services.imageOps, rel)` to the loop.
- [ ] **Step 4:** Run `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat: agent runner, system prompt and workflow docs loader"`

### Task 13: Chat UI and model settings UI

**Files:**
- Create: `src/renderer/src/stores/chat-store.ts`, `src/renderer/src/stores/models-store.ts`, `src/renderer/src/components/chat/{ChatPane,ChatHeader,MessageList,AssistantMessage,ToolCallCard,Composer,ModelPicker}.tsx`, `src/renderer/src/components/settings/{SettingsDialog,ModelsTab,EndpointForm,ModelForm,RoleAssignments}.tsx`, `src/renderer/src/components/settings/presets.ts`, `src/main/ipc/handlers/uploads.ts`
- Modify: `src/shared/ipc.ts`, `src/main/ipc/handlers/models.ts` (adds `models:test`), `src/renderer/src/events.ts`, `src/renderer/src/App.tsx`
- Test: `src/renderer/src/components/chat/Composer.test.tsx`, `src/renderer/src/components/chat/MessageList.test.tsx`, `src/renderer/src/components/settings/ModelsTab.test.tsx`, `tests/e2e/chat.spec.ts`

**Interfaces:**
- Produces: `useChatStore` with `messages: Record<threadKey, ChatMessage[]>`, `streaming: Record<threadKey, string>`, `load(threadKey, loader)` and `applyAgentEvent(threadKey, e: AgentEvent)`. A `text-delta` appends to `streaming`; a `message` appends the message and clears `streaming`; a `run-finished` with an error appends a local error notice.
- Produces: `useModelsStore` with `view: ModelRegistryView | null` and actions mirroring the `models:*` channels.
- Produces: `MessageList({ threadKey })`, which is reused by the panel side chat in Task 22.
  - User messages show their text only, never the snapshot.
  - Assistant messages render as markdown.
  - Tool calls render as a collapsible `tool-card` showing the name, a one-line input summary, and ok/error.
  - Result images render as `tool-image` thumbnails through `assetUrl`. Clicking one calls `selectPanel(panelId)` when the path starts with `panels/<pnlId>/`.
- Produces: `Composer({ onSend(text, imagePaths), running, onStop })`. Enter sends, Shift+Enter adds a newline, the attach button calls `uploads:pickImages`, and `composer-stop` is shown while running.
- Produces: `ChatHeader`, containing `ModelPicker` (a select of `text`-capable models that calls `models:assignRole('agent', id)`) and the `mock-banner` text `You're using the offline mock model. Add a real endpoint in Settings → Models.`, shown when the effective agent model is on a `mock` endpoint.
- Produces: `presets` (§7 list: `{ label; kind; baseUrl; suggestedModels: { modelId; capabilities }[] }`).
- New IPC channels:
  - `uploads:pickImages {projectId}` → `{ paths: string[] }`. It opens `dialog.showOpenDialog` filtered to png/jpg/webp and copies the files to `uploads/upl_<id>.<ext>`.
  - `models:test {modelId}` → `{ ok: boolean; message: string }`. For text models it runs a single turn, "Reply with the single word OK.", with a 30 s timeout. Image models return `{ ok: true, message: 'Key present' | 'No key set' }` without spending.
- `events.ts`: `agent.event` routes to `chatStore.applyAgentEvent(threadKey, event)` and updates `appStore.runningThreads`. `models.changed` reloads `useModelsStore`.

- [ ] **Step 1: Write the failing tests**

```tsx
it('Enter sends, Shift+Enter inserts newline, Stop while running', async () => { /* type 'hi{Enter}' → onSend('hi', []) ; running → composer-stop click → onStop */ })
it('streams deltas into the in-progress bubble', () => { /* applyAgentEvent text-delta 'Hel','lo' → screen shows 'Hello' in message-assistant */ })
it('panel thumbnails select the panel', async () => { /* tool result images ['panels/pnl_0000000001/ver_0000000001.png'] → click tool-image → appStore.selectedPanelId 'pnl_0000000001' */ })
it('hides the state snapshot', () => { /* user message with stateSnapshot → '<project_state>' not in document */ })
it('adds an endpoint from a preset and stores key write-only', async () => { /* choose 'Anthropic' preset → baseUrl field 'https://api.anthropic.com'; key input type=password; save → models:addEndpoint then models:setApiKey */ })
it('role selects only offer capable models', () => { /* image role select options exclude text-only model */ })
it('shows which roles were cleared on removal', async () => { /* models:removeModel returns {clearedRoles:['agent']} → text 'Unassigned roles: agent' */ })
```

```ts
// tests/e2e/chat.spec.ts — M1 checkpoint
test('chat with the mock agent', async () => {
  const { app, page } = await launchApp({ script: { turns: [{ text: 'Hello from mock' }] } })
  await createProjectAndSession(page, 'Moon Diary')   // new helper in helpers.ts (see Step 3)
  await expect(page.getByTestId('mock-banner')).toBeVisible()
  await page.getByTestId('composer-input').fill('Hi'); await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText('Hello from mock'); await app.close()
})
```

- [ ] **Step 2:** Run `npx vitest run src/renderer`. Expected: FAIL.
- [ ] **Step 3:** Implement the stores, components, settings dialog (opened by `settings-open`), upload and test handlers, and event routing. Add two helpers to `tests/e2e/helpers.ts`, which later end-to-end tests reuse:
  - `createProjectAndSession(page, title)`: runs the new-project dialog, then `new-session`.
  - `sendChat(page, text, expectedReply)`: uses the **first** `composer-input`/`composer-send`/`message-assistant` set on the page. That is the main chat, which precedes the panel side chat in the DOM. It fills the input, clicks send, and waits until the last assistant message contains `expectedReply`.
- [ ] **Step 4:** Run `npm run typecheck`, `npm test` and `npm run test:e2e`. Expected: PASS. **This is the Milestone 1 checkpoint.**
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat: chat pane and model settings"`

---

# Milestone 2 — Characters and variations

### Task 14: Image adapters (OpenAI Images, Gemini Interactions) and ImageService

**Files:**
- Create: `src/main/models/providers/openai-images.ts`, `src/main/models/providers/gemini-images.ts`, `src/main/domain/image-service.ts`, `tests/fixtures/gemini-interaction-image.json`, `tests/fixtures/gemini-interaction-text-only.json`
- Modify: `src/main/models/providers/factory.ts`, `src/main/services.ts` (adds `images`)
- Test: `src/main/models/providers/openai-images.test.ts`, `src/main/models/providers/gemini-images.test.ts`, `src/main/domain/image-service.test.ts`

**Interfaces:**
- Produces: `class OpenAIImageProvider implements ImageProvider`, constructed with `r` and an optional `client?: { images: { generate; edit } }`.
  - `generate` without references calls `images.generate({ model, prompt, size, n: 1, ...params })`.
  - `generate` with references calls `images.edit({ model, prompt, size, image: [...refs as toFile(...)], ...params })`.
  - `edit` calls `images.edit` with `image: [source, ...refs]`.
  - It reads `data[0].b64_json`, and the mime comes from `params.output_format`, defaulting to png.
  - It drops references beyond 16.
- Produces: `aspectToOpenAISize(aspect: PanelAspect): '1024x1024'|'1024x1536'|'1536x1024'`. `1:1` maps to `1024x1024`; `2:3`, `3:4` and `9:16` map to `1024x1536`; `4:3` and `16:9` map to `1536x1024`.
- Produces: `class GeminiImageProvider implements ImageProvider`, constructed with `r` and an optional `fetchImpl?: typeof fetch`.
  - It sends `POST ${baseUrl}/v1beta/interactions` with the headers `x-goog-api-key: <key>` and `content-type: application/json`.
  - The body is `{ model, input: [{type:'text', text: prompt}, ...images.map(i => ({type:'image', mime_type, data: base64}))], response_format: { type:'image', mime_type:'image/png', aspect_ratio: aspect }, ...params }`.
  - For `edit`, the source image is the first image block and the prompt is the edit prompt.
- Produces: `parseInteractionImage(json: unknown): ImageResult`. It uses `output_image.data` when present; otherwise the last `{type:'image', data}` block in `steps[].content[]`. Its mime is `mime_type ?? 'image/png'`. When there is no image it throws `ProviderError('The image model returned no image', 'bad_request')`. HTTP 401/403 map to `auth`, 429 to `rate_limit`, other ≥400 to `bad_request` with the response text.
- Produces: `class ImageService`, constructed with `{ registry: ModelRegistry; imageOps: ImageOps; createImageProvider?: typeof createImageProvider }`. Methods:
  - `generate(ctx, req: { prompt; references: { relPath: string; label: string }[]; aspect; signal?: AbortSignal }): Promise<{ data: Buffer; ext: 'png'|'jpg'|'webp' }>`
  - `edit(ctx, req & { sourceRelPath: string })`
  - `maxReferences(role: 'image'|'imageEdit'): number`, the resolved model's `maxReferenceImages`
- `ImageService` loads each reference from disk and downscales it to `MAX_REFERENCE_IMAGE_EDGE`. It uses the `image` role for `generate` and `imageEdit` for `edit`, and combines the caller's signal with a 180 s timeout via `AbortSignal.any`. A timeout surfaces as `ProviderError('Image generation timed out after 180s', 'timeout')`.

- [ ] **Step 1:** Fetch `https://ai.google.dev/gemini-api/docs/image-generation` and confirm the Interactions request and response shapes above. Write `gemini-interaction-image.json` from the documented response shape: one `model_output` step whose `content` holds a text block and an image block with a tiny base64 PNG. If the docs differ from this plan, follow the docs and note the difference in the commit message.
- [ ] **Step 2: Write the failing tests**

```ts
it('openai: generate without refs, edit with refs', async () => {
  await p.generate({ prompt: 'x', references: [], aspect: '2:3', signal })
  expect(client.images.generate).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-image-2', size: '1024x1536', n: 1 }), expect.anything())
  await p.generate({ prompt: 'x', references: [ref('a'), ref('b')], aspect: '16:9', signal })
  expect(client.images.edit.mock.calls[0][0].image).toHaveLength(2); expect(client.images.edit.mock.calls[0][0].size).toBe('1536x1024')
})
it('openai: edit puts source first and merges params', async () => { /* params {quality:'high'} present; image[0] is source file */ })
it('gemini: request shape', async () => {
  await g.generate({ prompt: 'p', references: [ref('a')], aspect: '9:16', signal })
  const [url, init] = fetchImpl.mock.calls[0]
  expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions'); expect(init.headers['x-goog-api-key']).toBe('k')
  expect(JSON.parse(init.body)).toMatchObject({ model: 'gemini-3.1-flash-image', input: [{ type: 'text', text: 'p' }, { type: 'image', mime_type: 'image/png' }], response_format: { type: 'image', aspect_ratio: '9:16' } })
})
it('gemini: parses fixture, errors on text-only and 401', async () => { /* fixture → Buffer png; text-only → 'The image model returned no image'; 401 → kind auth */ })
it('image service: role, downscale, timeout', async () => {
  await svc.generate(ctx, { prompt: 'p', references: [{ relPath: 'characters/c/a.png', label: 'Mina' }], aspect: '2:3' })
  expect(imageOps.calls).toContainEqual(['downscale', 1536]); expect(lastProviderReq.references[0].label).toBe('Mina')
  // provider that never resolves + fake timers past 180s → ProviderError kind 'timeout'
})
```

- [ ] **Step 3:** Run `npx vitest run src/main/models/providers src/main/domain/image-service`. Expected: FAIL.
- [ ] **Step 4:** Implement the providers, factory registration (`openai` and `gemini` images) and `ImageService`.
- [ ] **Step 5:** Run the tests above and `npm run typecheck`. Expected: PASS.
- [ ] **Step 6:** Commit: `git add -A && git commit -m "feat: openai and gemini image adapters, image service"`

### Task 15: CharacterService and character prompts

**Files:**
- Create: `src/main/domain/prompts.ts` (character part), `src/main/domain/character-service.ts`
- Modify: `src/main/services.ts` (adds `characters`, and registers `characters.recoverInterrupted` as an `onOpen` hook)
- Test: `src/main/domain/prompts.test.ts`, `src/main/domain/character-service.test.ts`

**Interfaces:**
- Produces:
  - `baseReferencePrompt(c: Character, stylePreset: string): string`, exactly `Character reference sheet. ${stylePreset}. Full body, front view, neutral expression, standing straight, plain light-gray background, even studio lighting, no text. ${c.appearanceLock}`
  - `variationPrompt(c: Character, v: Variation, stylePreset: string): string`, exactly `Character reference sheet. ${stylePreset}. Full body, front view, plain light-gray background, no text. ${c.appearanceLock} Variation: ${v.name} — ${v.delta}. Keep face, hair, body and colors identical to the reference image except for the variation.`
- Produces: `interface PanelUsageLookup { panelsUsingCharacter(ctx, characterId): Promise<string[]>; panelsUsingVariation(ctx, variationId): Promise<string[]> }`.
- Produces: `class CharacterService`, constructed with `{ bus; images: ImageService; projects: ProjectStore; usage: PanelUsageLookup }`. For now the usage lookup is a stub returning `[]`; Task 18 replaces it. Methods:
  - `list(ctx, opts?: { includeArchived?: boolean }): Promise<Character[]>`. Corrupt files go to `ctx.problems`.
  - `get(ctx, id): Promise<Character>`
  - `create(ctx, input: CharacterInput, createdBy: 'user'|'ai'): Promise<Character>`. It adds a `base` variation named `Base` with status `pending` and `imagePath: null`. A case-insensitive name clash among non-archived characters throws `DuplicateCharacterError`.
  - `update(ctx, id, patch: CharacterPatch): Promise<{ character: Character; appearanceLockChanged: boolean }>`
  - `archive(ctx, id)`, `unarchive(ctx, id)`
  - `delete(ctx, id): Promise<void>`. It throws `CharacterInUseError(panelIds)` if any panel uses the character; otherwise it trashes the JSON and the image dir.
  - `addVariation(ctx, characterId, input: VariationInput, createdBy): Promise<Variation>`, with status `pending`
  - `generateVariationImage(ctx, characterId, variationId, opts?: { signal?: AbortSignal }): Promise<Variation>`. It never throws for generation failures; instead it returns the variation with status `failed` and an `error`.
    - The base variation uses `baseReferencePrompt` with no references.
    - Other variations use `variationPrompt` with the base image as the reference labelled `base reference`. If the base isn't `ready`, the result is `failed` with `Base reference image is not ready`.
    - Reference sheets are always generated at aspect `2:3`.
    - Images are saved to `characters/<chrId>/<varId>_<6 hex>.<ext>`.
  - `uploadVariationImage(ctx, characterId, variationId, data: Buffer, ext): Promise<Variation>`
  - `deleteVariation(ctx, characterId, variationId)`. It throws for the base variation, and throws `CharacterInUseError` when panels use the variation.
  - `recoverInterrupted(ctx): Promise<void>`. It turns every `pending` into `failed` with `Interrupted: the app closed during generation`.
- Every mutation emits `character.changed`.

- [ ] **Step 1: Write the failing tests**

```ts
it('pins the base reference prompt', () => expect(baseReferencePrompt(makeCharacter({ appearanceLock: 'LOCK' }), 'STYLE')).toBe('Character reference sheet. STYLE. Full body, front view, neutral expression, standing straight, plain light-gray background, even studio lighting, no text. LOCK'))
it('creates with a pending base variation and rejects duplicates', async () => { /* create 'Mina' → variations [{kind:'base', name:'Base', status:'pending', imagePath:null}]; create 'mina' → DuplicateCharacterError; event character.changed */ })
it('generates the base image', async () => { /* mock image → status ready, imagePath matches /^characters\/chr_[0-9a-f]{10}\/var_[0-9a-f]{10}_[0-9a-f]{6}\.png$/, file exists, provider got 0 references */ })
it('variation uses the base as reference', async () => { /* after base ready → addVariation outfit → generate → provider references[0].label 'base reference', prompt contains 'Variation: Outfit: School uniform — ' */ })
it('variation fails cleanly without a ready base', async () => { /* status failed, error 'Base reference image is not ready' */ })
it('generation errors mark failed without throwing (Review Focus 2)', async () => { /* provider rejects ProviderError('boom') → resolves variation status failed error 'boom' */ })
it('recovers interrupted generations', async () => { /* write pending variation → recoverInterrupted → failed with 'Interrupted: the app closed during generation' */ })
it('refuses to delete a used character but archives (Review Focus 4)', async () => { /* usage returns ['pnl_1'] → delete rejects CharacterInUseError; archive → list() excludes it, list({includeArchived:true}) includes */ })
it('flags appearance lock changes', async () => { /* update appearanceLock → appearanceLockChanged true */ })
it('skips and reports a corrupt character file (Review Focus 5)', async () => { /* write '{oops' to characters/chr_ffffffffff.json → list() returns the valid ones; ctx.problems has that path */ })
```

- [ ] **Step 2:** Run `npx vitest run src/main/domain`. Expected: FAIL.
- [ ] **Step 3:** Implement the prompts and `CharacterService`, and wire them in services.
- [ ] **Step 4:** Run `npx vitest run src/main/domain`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat: character service with variations and reference images"`

### Task 16: Character agent tools, IPC and the Characters tab

**Files:**
- Create: `src/main/agent/tools/character-tools.ts`, `src/main/ipc/handlers/characters.ts`, `src/renderer/src/stores/characters-store.ts`, `src/renderer/src/components/characters/{CharacterStudio,CharacterCard,CharacterForm,VariationGrid,VariationForm}.tsx`, `src/renderer/src/components/layout/RightPane.tsx`
- Modify: `src/main/agent/tools/index.ts`, `src/main/agent/agent-runner.ts` (`gatherState` now includes `characters`), `src/shared/ipc.ts`, `src/renderer/src/events.ts`, `src/renderer/src/App.tsx`
- Test: `src/main/agent/tools/character-tools.test.ts`, `src/renderer/src/components/characters/CharacterStudio.test.tsx`, `tests/e2e/characters.spec.ts`

**Interfaces:**
- Produces the tools below (zod inputs; outputs are JSON objects):
  - `list_characters {}` → `{ characters: [{ id, name, role, aliases, variations: [{ id, name, kind, status }] }] }`
  - `get_character {characterId}` → the full character
  - `create_character { name, role, aliases?, characterization?, appearance?, appearanceLock, generateBaseImage = true }`. It creates the character and **awaits** the base generation, returning `{ characterId, baseVariationId, baseStatus, baseError, imagePath }` with `images: [imagePath]` when ready.
  - `update_character { characterId, patch }`. When the appearance lock changes, the result includes the warning `appearanceLock changed: regenerate the base and variations so new panels stay consistent.`
  - `create_variation { characterId, name, kind, delta, generateImage = true }` → `{ variationId, status, error, imagePath }`, with images
  - `regenerate_variation { characterId, variationId }`
  - Unknown ids raise `ToolError('Unknown character: <id>')` or `ToolError('Unknown variation: <id>')`.
- Produces `characterTools: ToolDef[]`, which is added in `buildAgentTools`.
- New IPC channels:
  - `characters:list {projectId, includeArchived?}`, `characters:get`, `characters:create {projectId, input, generateBase}`, `characters:update`, `characters:archive`, `characters:unarchive`, `characters:delete`, `characters:addVariation {…, generate}`, `characters:generateVariation`, `characters:deleteVariation`, `characters:uploadVariationImage {projectId, characterId, variationId}` (opens a file dialog in main)
  - The create, add and generate handlers start generation **without awaiting** it and return immediately. The UI follows progress through `character.changed`.
- Produces `RightPane` with the tabs `tab-webtoon`, `tab-characters` and `tab-story`. Webtoon and Story are placeholders until Tasks 20 and 23.
- Produces `CharacterStudio`.
  - It shows a grid of `character-card`s with the base image, name and role, plus a "New character" button.
  - The detail view holds `CharacterForm`: name, role, aliases, the characterization fields, the appearance fields and an appearance-lock textarea with a word count (hint 40–90).
  - A "Draft with AI" button fills the main composer with `Help me design the character "<name or 'a new character'>": interview me briefly if needed, then fill characterization, appearance and appearanceLock, create the character and generate its base reference image.`
  - The detail view also has a `VariationGrid` of `variation-card`s with an image or status badge, Retry when failed, Upload and Delete (not shown for the base). The grid has an `Add variation` button that opens `VariationForm` (testid `variation-form`), which has inputs labelled `Name`, `Kind` and `Delta` and a `Create variation` button.
  - Archive and Unarchive actions are included.
- `events.ts` reloads the characters store on `character.changed`.

- [ ] **Step 1: Write the failing tests**

```ts
it('create_character awaits the base image', async () => {
  const r = await tools.execute(call('create_character', { name: 'Mina', role: 'protagonist', appearanceLock: 'LOCK' }), toolCtx)
  expect(r.ok).toBe(true); expect(JSON.parse(r.content)).toMatchObject({ baseStatus: 'ready' }); expect(r.images).toHaveLength(1)
})
it('create_character reports image failure but keeps the character', async () => { /* image role unassigned → ok true, baseStatus 'failed', baseError contains "No model assigned to role 'image'" */ })
it('create_variation rejects unknown characters', async () => { /* ok false, 'Unknown character: chr_ffffffffff' */ })
it('update_character warns on appearance lock change', async () => { /* content contains 'appearanceLock changed' */ })
```

```tsx
it('shows AI-created variations live', async () => {
  const api = installFakeApi({ 'characters:list': () => current })
  render(<CharacterStudio />); await screen.findByText('Mina')
  current = [withVariation(mina, 'Outfit: School uniform')]; api.emit({ type: 'character.changed', projectId, characterId: mina.id })
  await userEvent.click(screen.getByText('Mina')); expect(await screen.findAllByTestId('variation-card')).toHaveLength(2)
})
it('Draft with AI prefills the composer', async () => { /* click → chat composer draft equals pinned text */ })
```

```ts
// tests/e2e/characters.spec.ts — M2 checkpoint
test('agent creates a character and a variation that appear in the Characters tab', async () => {
  const { app, page } = await launchApp({ script: { turns: [
    { toolCalls: [{ name: 'create_character', input: { name: 'Mina', role: 'protagonist', appearanceLock: 'Teenage girl, slim build, silver bob haircut, amber eyes, red bomber jacket.' } }] },
    { text: 'Created Mina.' } ] } })
  await createProjectAndSession(page, 'Moon Diary')
  await page.getByTestId('composer-input').fill('Create Mina'); await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('message-assistant').last()).toContainText('Created Mina.')
  await page.getByTestId('tab-characters').click(); await page.getByTestId('character-card').filter({ hasText: 'Mina' }).click()
  await page.getByRole('button', { name: 'Add variation' }).click()
  const form = page.getByTestId('variation-form')
  await form.getByLabel('Name').fill('Outfit: School uniform'); await form.getByLabel('Delta').fill('navy blazer, pleated skirt'); await form.getByRole('button', { name: 'Create variation' }).click()
  await expect(page.getByTestId('variation-card').locator('img')).toHaveCount(2); await app.close()
})
```

- [ ] **Step 2:** Run `npx vitest run src/main/agent/tools src/renderer/src/components/characters`. Expected: FAIL.
- [ ] **Step 3:** Implement the tools, handlers, store, components and event wiring. Extend `gatherState` with `characters.list(ctx)`.
- [ ] **Step 4:** Run `npm run typecheck`, `npm test` and `npm run test:e2e`. Expected: PASS. **This is the Milestone 2 checkpoint.**
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat: character tools and character studio"`

---

# Milestone 3 — Panels and the visualizer

### Task 17: Panel prompt composition and draft validation (pure)

**Files:**
- Modify: `src/main/domain/prompts.ts` (adds the panel templates)
- Create: `src/main/domain/panel-validation.ts`
- Test: `src/main/domain/prompts.test.ts`, `src/main/domain/panel-validation.test.ts`

**Interfaces:**
- Produces: `composePanelPrompt(input: { stylePreset: string; panel: Pick<Panel,'description'|'setting'|'shot'|'aspect'|'characters'|'continuityNotes'>; roster: Map<string, Character>; previous: { panelId: string; imagePath: string } | null; maxReferences: number }): { prompt: string; references: { relPath: string; label: string }[] }`.
  - It uses the exact template in §9, with lines joined by `\n`.
  - References are added in cast order and labelled with the character name, then the previous panel labelled `previous panel`. A `(reference image N)` is 1-based.
  - Over the cap, the previous panel is dropped first, then cast members from the end. A dropped character's line reads `- Name (no reference image): …`, and a dropped previous panel's continuity line reads `Continues directly from the previous panel (no reference image).`
  - When `previous` is null there is no `[CONTINUITY]` line.
- Produces: `editPanelPrompt(instruction: string, cast: { name: string; appearanceLock: string }[]): string`, exactly `Edit the first image: ${instruction}. Keep everything else unchanged — composition, framing, lighting, art style — and keep these characters on-model: ${cast.map(c => `${c.name}: ${c.appearanceLock}`).join(' ')} No text, no speech bubbles.`
- Produces: `validatePanelDraft(draft: Pick<PanelDraft,'description'|'characters'|'dialogue'|'offPanelMentions'>, roster: Character[], opts: { strictMentions: boolean }): { errors: string[]; warnings: string[] }`. The rules from §9 produce these exact messages:
  - `Unknown character: <id>`
  - `Character <name> is archived`
  - `Variation <vid> does not belong to <name>`
  - `Variation "<vname>" of <name> has no ready reference image`
  - `<name> is cast twice`
  - `Unknown speaker: <id>`
  - `Mentioned but not attached: <names>. Attach them to characters or list them in offPanelMentions.` — an error when `strictMentions`, otherwise a warning
- Produces: `findUnattachedMentions(text: string, roster: Character[], attachedIds: Set<string>, declared: string[]): string[]`. It does whole-word, case-insensitive matching on names and aliases, ignores archived characters, and treats `declared` case-insensitively.

- [ ] **Step 1: Write the failing tests**

```ts
it('composes the panel prompt with references in order', () => {
  const { prompt, references } = composePanelPrompt({ stylePreset: 'STYLE', panel: p({ characters: [cast(mina, 'var_m1', 'waves', 'smiling')] }), roster, previous: { panelId: 'pnl_prev', imagePath: 'panels/pnl_prev/ver_1.png' }, maxReferences: 4 })
  expect(prompt.split('\n')[0]).toBe('[STYLE] STYLE. Vertical-scroll webtoon panel, 2:3 aspect ratio, medium shot. No text, no speech bubbles, no captions, no watermark.')
  expect(prompt).toContain('- Mina (reference image 1): MINA_LOCK Look: Outfit: School uniform — navy blazer. Action: waves. Expression: smiling. Position: center.')
  expect(prompt).toContain('[CONTINUITY] Continues directly from the previous panel (reference image 2).')
  expect(references).toEqual([{ relPath: mina.variations[1].imagePath, label: 'Mina' }, { relPath: 'panels/pnl_prev/ver_1.png', label: 'previous panel' }])
})
it('drops previous panel first, then trailing cast, when over the cap', () => { /* maxReferences 1, cast Mina+Jin, previous → references [Mina]; 'Jin (no reference image)'; 'previous panel (no reference image)' */ })
it('never puts dialogue in the prompt', () => { /* dialogue text 'SECRET LINE' absent */ })
it('validates cast and speakers', () => { /* each error message above, one case each */ })
it('mention guard is whole-word and strict only for the agent', () => {
  const draft = d({ description: 'Mina looks at the poster of Jinx.' })      // roster has Mina (not attached) and Jin
  expect(validatePanelDraft(draft, roster, { strictMentions: true }).errors).toEqual(['Mentioned but not attached: Mina. Attach them to characters or list them in offPanelMentions.'])
  expect(validatePanelDraft(draft, roster, { strictMentions: false }).warnings).toHaveLength(1)
  expect(validatePanelDraft({ ...draft, offPanelMentions: ['mina'] }, roster, { strictMentions: true }).errors).toEqual([])
})
it('rejects archived characters (Review Focus 4)', () => { /* errors ['Character Old Man is archived'] */ })
```

- [ ] **Step 2:** Run `npx vitest run src/main/domain/prompts src/main/domain/panel-validation`. Expected: FAIL.
- [ ] **Step 3:** Implement `composePanelPrompt`, `editPanelPrompt`, `validatePanelDraft` and `findUnattachedMentions`.
- [ ] **Step 4:** Run the same tests. Expected: PASS.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat: panel prompt composition and consistency validation"`

### Task 18: EpisodeService and PanelService (with versions)

**Files:**
- Create: `src/main/domain/episode-service.ts`, `src/main/domain/panel-service.ts`
- Modify: `src/main/services.ts` (adds `episodes` and `panels`, replaces the `characters` usage stub with `panels`, and registers `panels.recoverInterrupted` in `onOpen`)
- Test: `src/main/domain/episode-service.test.ts`, `src/main/domain/panel-service.test.ts`

**Interfaces:**
- Produces: `class EpisodeService`, constructed with `{ bus }`. Methods:
  - `list(ctx): Promise<Episode[]>`, ordered by `number`; it creates `Episode 1` when none exists
  - `get(ctx, id)`
  - `create(ctx, { title, synopsis? })`, which takes the next number
  - `update(ctx, id, patch: { title?; synopsis? })`
  - `insertPanel(ctx, episodeId, panelId, afterPanelId: string|null|undefined)`. `undefined` appends, `null` inserts at the start, and an id inserts after that panel.
  - `removePanel(ctx, episodeId, panelId)`
  - `movePanel(ctx, episodeId, panelId, toIndex)`
- Every mutation emits `episode.changed`.
- Produces: `class PanelService implements PanelUsageLookup`, constructed with `{ bus; projects; episodes: EpisodeService; characters: CharacterService; images: ImageService; trash }`. Methods:
  - `list(ctx, episodeId): Promise<Panel[]>`, in episode order
  - `get(ctx, id)`
  - `previousPanel(ctx, panelId): Promise<Panel|null>`
  - `create(ctx, draft: PanelDraft, opts: { createdBy; strictMentions: boolean }): Promise<{ panel: Panel; warnings: string[] }>`. It throws `PanelValidationError { issues: string[] }`, whose message is `issues.join('\n')`. `aspect` defaults to `meta.defaultAspect`. Dialogue lines get `dlg_` ids.
  - `update(ctx, id, patch: PanelPatch, opts: { strictMentions }): Promise<{ panel; warnings }>`
  - `generate(ctx, id, opts?: { signal?; extraInstruction?: string }): Promise<PanelVersion>`. It appends a pending version and composes the prompt with `previous` set to the previous panel's current **ready** version and `maxReferences: images.maxReferences('image')`. The image is saved to `panels/<pnl>/<ver>.<ext>`, after which the version is marked `ready` and becomes current. On failure the version is marked `failed` and `currentVersionId` doesn't change. It never throws for generation failures.
  - `editImage(ctx, id, instruction, opts?: { signal? }): Promise<PanelVersion>`. It edits the current ready image with `editPanelPrompt`, passing the cast references, `source:'edit'` and `parentVersionId`. It uses the `imageEdit` role.
  - `uploadImage(ctx, id, data, ext): Promise<PanelVersion>`, with `source:'upload'`
  - `revert(ctx, id, versionId): Promise<Panel>`. It throws `EntityNotFoundError('version', …)` for an unknown version and for a version that isn't `ready`.
  - `delete(ctx, id)`, which removes the panel from its episode and trashes the JSON and image dir
  - `move(ctx, id, toIndex)`
  - `panelsUsingCharacter(ctx, chrId)` and `panelsUsingVariation(ctx, varId)`
  - `recoverInterrupted(ctx)`
- `extraInstruction` is appended to the prompt as `\n[FIX] ${extraInstruction}`; Task 25 uses it. Every mutation emits `panel.changed`.

- [ ] **Step 1: Write the failing tests**

```ts
it('auto-creates Episode 1 and inserts panels in order', async () => { /* list → 1 episode; create p1, p2, then p3 afterPanelId p1 → order [p1,p3,p2]; afterPanelId null → first */ })
it('rejects invalid drafts with all issues', async () => { /* unknown character → PanelValidationError issues ['Unknown character: chr_ffffffffff'] */ })
it('generate uses the previous ready panel as a reference', async () => {
  const v1 = await panels.generate(ctx, p1.id); const v2 = await panels.generate(ctx, p2.id)
  expect(v2.referenceImagePaths).toContain(v1.imagePath); expect(v2.prompt).toContain('[CONTINUITY]')
  expect((await panels.get(ctx, p2.id)).currentVersionId).toBe(v2.id)
})
it('a failed generation keeps the previous good version current (Review Focus 2)', async () => { /* v1 ready; provider rejects → v2 failed with error; currentVersionId still v1 */ })
it('editImage creates a child version from the current image', async () => { /* source 'edit', parentVersionId v1, provider edit called with source = v1 file, role imageEdit */ })
it('revert switches current without deleting versions', async () => { /* versions length unchanged */ })
it('delete trashes files and removes from the episode', async () => { /* trash called for panelFile & panelDir; episode.panelIds excludes id */ })
it('concurrent updates do not lose fields', async () => { /* Promise.all([update desc, update setting]) → both present */ })
it('reports usage for character deletion (Review Focus 4)', async () => { /* characters.delete(chr used in p1) → CharacterInUseError(['pnl_…']) */ })
it('recovers interrupted versions', async () => { /* pending → failed 'Interrupted: the app closed during generation' */ })
```

- [ ] **Step 2:** Run `npx vitest run src/main/domain/episode-service src/main/domain/panel-service`. Expected: FAIL.
- [ ] **Step 3:** Implement both services and wire them in services.
- [ ] **Step 4:** Run `npx vitest run src/main` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat: episode and panel services with version history"`

### Task 19: Panel agent tools and panel IPC

**Files:**
- Create: `src/main/agent/tools/panel-tools.ts`, `src/main/ipc/handlers/panels.ts`
- Modify: `src/main/agent/tools/index.ts`, `src/main/agent/agent-runner.ts` (`gatherState` adds the active episode, defaulting to the first from `episodes.list`, and its last 3 panels), `src/shared/ipc.ts`
- Test: `src/main/agent/tools/panel-tools.test.ts`

**Interfaces:**
- Produces these tools:
  - `list_episodes {}`
  - `create_episode { title, synopsis? }`
  - `list_panels { episodeId, last = 5 }` → `{ panels: [{ id, index, shot, aspect, cast: [{ name, characterId, variationId }], description, dialogue, currentVersion: { id, status, imagePath } | null }] }`
  - `get_panel { panelId }`
  - `view_panel_image { panelId }`, only when `vision`; it returns `images: [currentImagePath]`
  - `create_panel { episodeId, afterPanelId?, description, setting, shot, aspect?, characters, dialogue, continuityNotes?, offPanelMentions? }`. It runs with `strictMentions: true`, **awaits** `generate`, and returns `{ panelId, versionId, status, error, imagePath, warnings, check }` with `images: [imagePath]` when ready.
  - `update_panel { panelId, patch, regenerate = false }`
  - `regenerate_panel { panelId }`
  - `edit_panel_image { panelId, instruction }`
  - A `PanelValidationError` becomes `ToolError` with the issues joined by newlines.
- `buildAgentTools({vision})` now returns `[...characterTools, ...panelTools]`, with `view_panel_image` filtered out when `!vision`.
- New IPC channels:
  - `episodes:list`, `episodes:create`, `episodes:update`
  - `panels:list {projectId, episodeId}`, `panels:get`, `panels:create {projectId, draft, generate: boolean}` → `{ panel, warnings }` (`strictMentions: false`; generation not awaited)
  - `panels:update {projectId, panelId, patch}` → `{ panel, warnings }`
  - `panels:generate {projectId, panelId}` (not awaited), `panels:delete`, `panels:move {projectId, panelId, toIndex}`, `panels:revert {projectId, panelId, versionId}`, `panels:uploadImage {projectId, panelId}` (file dialog in main)

- [ ] **Step 1: Write the failing tests**

```ts
it('create_panel returns the image and continuity', async () => { /* seeded Mina with ready base; 2 create_panel calls → second result content.status 'ready', images length 1; panel JSON version.referenceImagePaths includes first panel's image */ })
it('create_panel enforces the mention guard', async () => { /* description mentions Jin (in roster, not cast) → ok false, content contains 'Mentioned but not attached: Jin' */ })
it('list_panels returns the last N in order', async () => { /* 7 panels, last 5 → indices 2..6 */ })
it('tool set depends on vision', () => {
  expect(buildAgentTools({ vision: false }).names()).not.toContain('view_panel_image')
  expect(buildAgentTools({ vision: true }).names()).toEqual(expect.arrayContaining(['list_characters', 'get_character', 'create_character', 'update_character', 'create_variation', 'regenerate_variation', 'list_episodes', 'create_episode', 'list_panels', 'get_panel', 'view_panel_image', 'create_panel', 'update_panel', 'regenerate_panel', 'edit_panel_image']))
})
```

- [ ] **Step 2:** Run `npx vitest run src/main/agent/tools`. Expected: FAIL.
- [ ] **Step 3:** Implement the tools, handlers and `gatherState` extension.
- [ ] **Step 4:** Run `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat: panel tools and panel IPC"`

### Task 20: Webtoon visualizer and manual panel editor

**Files:**
- Create: `src/renderer/src/stores/panels-store.ts`, `src/renderer/src/components/visualizer/{WebtoonPane,EpisodeBar,WebtoonStrip,PanelCard,DialogueOverlay,InsertPanelButton,PanelEditorDialog,CastPicker,DialogueEditor}.tsx`
- Modify: `src/renderer/src/components/layout/RightPane.tsx`, `src/renderer/src/events.ts`, `tests/e2e/helpers.ts` (adds `readProjectJson(projectsRoot, relPath): Promise<any>`, which resolves `relPath` inside the single `prj_*` folder under `projectsRoot` and returns the parsed JSON, or an array of the parsed `*.json` files when `relPath` is a directory)
- Test: `src/renderer/src/components/visualizer/PanelCard.test.tsx`, `src/renderer/src/components/visualizer/PanelEditorDialog.test.tsx`, `tests/e2e/panels.spec.ts`

**Interfaces:**
- Produces: `usePanelsStore`, holding `episodes`, `panelsByEpisode` and `load(episodeId)`, plus actions mirroring the `panels:*` and `episodes:*` channels. `activeEpisodeId` lives in `useAppStore` and is sent with `agent:send`.
- Produces: `PanelCard({ panel, selected })`.
  - It renders an `<img src={assetUrl(projectId, currentVersion.imagePath)}>`.
  - `panel-status` shows `Generating…` while the latest version is pending, and `Failed: <error>` with a Retry button (`panels:generate`) when it failed.
  - `DialogueOverlay` draws the bubbles: speech is a rounded bubble with the speaker name, thought is a cloud style, narration is a rectangular caption box, and sfx is bold slanted text. Lines stack in order over the top of the image.
  - Clicking calls `selectPanel(panel.id)`. The selected card gets an outline.
  - The hover toolbar has Edit (opens the editor), Regenerate, Move up, Move down and Delete (with a confirm).
- Produces: `InsertPanelButton` (`add-panel`), shown between panels and at the end. It opens `PanelEditorDialog` with `afterPanelId`.
- Produces: `PanelEditorDialog({ mode: 'create'|'edit', episodeId, afterPanelId?, panel? })`, testid `panel-editor`.
  - Fields (with the labels `Description`, `Setting`, `Shot`, `Aspect`): description, setting, shot select, aspect select, a `CastPicker` (an `Add character` button adds a row; each row has selects labelled `Character` (non-archived characters only) and `Variation` (ready variations only, defaulting to the base), plus action, expression and position) and a `DialogueEditor` (speaker select including `Narration`, kind, text).
  - Buttons: "Create & generate", "Create without image" and "Upload image…".
  - Warnings returned by the service are shown inline.
- `events.ts` reloads the episode's panels on `panel.changed` and `episode.changed`.

- [ ] **Step 1: Write the failing tests**

```tsx
it('renders the current version through the asset protocol', () => { /* img src 'webtoon-asset://prj_…/panels/pnl_…/ver_….png' */ })
it('shows pending and failed states with retry', async () => { /* pending → 'Generating…'; failed → 'Failed: boom' + Retry → panels:generate called */ })
it('renders dialogue as overlay, not image text', () => { /* speech 'Mina' + text; narration caption; sfx */ })
it('click selects the panel', async () => { /* useAppStore.selectedPanelId */ })
it('cast picker lists only active characters and ready variations', async () => { /* archived hidden; pending variation option absent */ })
it('submits a draft and shows warnings', async () => { /* panels:create returns warnings ['Mentioned but not attached: Jin. …'] → text visible, dialog stays open with Close */ })
```

```ts
// tests/e2e/panels.spec.ts — M3 checkpoint
test('user creates a panel manually, agent continues from it', async () => {
  const mina = { $character: 'Mina' }, minaBase = { $variation: ['Mina', 'Base'] }
  const { app, page, projectsRoot } = await launchApp({ script: { turns: [
    { toolCalls: [{ name: 'create_character', input: { name: 'Mina', role: 'protagonist', appearanceLock: 'Teenage girl, silver bob haircut, amber eyes, red bomber jacket.' } }] },
    { text: 'Created Mina.' },
    // second user message: refs resolve from its <project_state>
    { toolCalls: [{ name: 'create_panel', input: { episodeId: { $episode: 'current' }, description: 'She turns toward the door.', setting: 'Rooftop at dusk', shot: 'medium', characters: [{ characterId: mina, variationId: minaBase, action: 'turning', expression: 'curious' }], dialogue: [] } }] },
    { text: 'Drew panel 2.' } ] } })
  await createProjectAndSession(page, 'Moon Diary'); await sendChat(page, 'Create Mina', 'Created Mina.')
  await page.getByTestId('tab-webtoon').click(); await page.getByTestId('add-panel').last().click()
  const editor = page.getByTestId('panel-editor')
  await editor.getByLabel('Description').fill('Mina stands on the rooftop.'); await editor.getByLabel('Setting').fill('Rooftop at dusk')
  await editor.getByRole('button', { name: 'Add character' }).click(); await editor.getByLabel('Character').selectOption({ label: 'Mina' })
  await editor.getByRole('button', { name: 'Create & generate' }).click()
  await expect(page.getByTestId('panel-card').locator('img')).toHaveCount(1)
  await sendChat(page, 'Draw the next panel', 'Drew panel 2.')
  await expect(page.getByTestId('panel-card').locator('img')).toHaveCount(2)
  const episode = (await readProjectJson(projectsRoot, 'episodes')).find(Boolean)   // helper returns parsed files when relPath is a dir
  const [first, second] = await Promise.all(episode.panelIds.map((id: string) => readProjectJson(projectsRoot, `panels/${id}.json`)))
  expect(second.versions[0].referenceImagePaths).toContain(first.versions[0].imagePath); await app.close()
})
```

- [ ] **Step 2:** Run `npx vitest run src/renderer/src/components/visualizer`. Expected: FAIL.
- [ ] **Step 3:** Implement the store and components, and replace the Webtoon tab placeholder.
- [ ] **Step 4:** Run `npm run typecheck`, `npm test` and `npm run test:e2e`. Expected: PASS. **This is the Milestone 3 checkpoint.**
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat: webtoon visualizer and manual panel editor"`

---

# Milestone 4 — Panel side chat

### Task 21: PanelChatRunner and panel-scoped tools

**Files:**
- Create: `src/main/agent/panel-chat.ts`, `src/main/agent/tools/panel-chat-tools.ts`, `src/main/ipc/handlers/panel-chat.ts`
- Modify: `src/main/agent/system-prompt.ts` (adds `buildPanelChatSystemPrompt` and `buildPanelContext`), `src/main/services.ts` (adds `panelChat`), `src/shared/ipc.ts`
- Test: `src/main/agent/panel-chat.test.ts`, `src/main/agent/tools/panel-chat-tools.test.ts`

**Interfaces:**
- Produces: `buildPanelChatTools(panelId: string, opts: { vision: boolean }): ToolRegistry`. Inputs never contain a panel id; every tool closes over `panelId`. The tools:
  - `get_panel_context {}` → panel fields, version list (`{id, label:'vN', status, source}`), cast with variation names, and previous/next panel summaries
  - `view_current_image {}` (vision only)
  - `update_panel_fields { description?, setting?, shot?, aspect?, characters?, dialogue?, continuityNotes?, offPanelMentions? }`, with `strictMentions: true`
  - `regenerate_image {}`
  - `edit_image { instruction }`
  - `revert_to_version { versionId }`
  - The image tools return `{ versionId, label, status, error, imagePath }` with images.
- Produces: `buildPanelContext(panel: Panel, roster: Character[], prev: Panel|null, next: Panel|null): string`. It is wrapped in `<panel_context>` and `</panel_context>` and contains `panel: <id>`, `version: v<n> of <m>`, `shot`, `aspect`, `setting`, `description`, `cast: Name (Variation name), …`, `dialogue: …`, `previous: <summary|none>` and `next: <summary|none>`.
- Produces: `buildPanelChatSystemPrompt(agentsMd: string, panelEditingDoc: string): string`. It is the intro line `You are editing a single webtoon panel. Every tool acts on this panel only.`, then `extractSection(agentsMd, 'Hard Rules')`, then `panelEditingDoc`. If `workflows/panel-editing` doesn't exist yet, it falls back to an empty string.
- Produces: `class PanelChatRunner`, constructed with `{ services; createTextProvider? }`. Methods:
  - `load(ctx, panelId): Promise<ChatMessage[]>`, from `panels/<id>.chat.jsonl`
  - `start({ projectId, panelId, text }): Promise<{ runId }>`. It uses `threadKey = 'panel:' + panelId` and the `panelChat` role, stores the user message with `stateSnapshot = buildPanelContext(...)`, rejects with `SessionBusyError` while the same panel is running, and otherwise behaves like `AgentRunner`.
  - `cancel(runId)`
- New IPC channels: `panelChat:load {projectId, panelId}` → `ChatMessage[]`, `panelChat:send {projectId, panelId, text}` → `{ runId }`, `panelChat:cancel {runId}`.

- [ ] **Step 1: Write the failing tests**

```ts
it('edit_image acts only on the bound panel', async () => {
  const reg = buildPanelChatTools(p2.id, { vision: false })
  const r = await reg.execute(call('edit_image', { instruction: 'make her smile' }), toolCtx)
  expect(JSON.parse(r.content)).toMatchObject({ label: 'v2', status: 'ready' })
  expect((await panels.get(ctx, p2.id)).versions).toHaveLength(2); expect((await panels.get(ctx, p1.id)).versions).toHaveLength(1)
  expect(reg.specs().find(s => s.name === 'edit_image')!.inputSchema).not.toHaveProperty('properties.panelId')
})
it('revert_to_version rejects unknown versions', async () => { /* ok false, contains 'Unknown version' */ })
it('stores the thread per panel with a panel_context snapshot', async () => { /* start → panels/<id>.chat.jsonl has user message whose stateSnapshot starts '<panel_context>' and contains 'version: v1 of 1' */ })
it('locks per panel, not globally', async () => { /* two panels start concurrently OK; same panel twice → SessionBusyError */ })
```

- [ ] **Step 2:** Run `npx vitest run src/main/agent/panel-chat src/main/agent/tools/panel-chat-tools`. Expected: FAIL.
- [ ] **Step 3:** Implement the runner, tools, prompt builders and IPC.
- [ ] **Step 4:** Run `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat: panel-scoped side chat runner"`

### Task 22: Panel side chat UI with version switcher

**Files:**
- Create: `src/renderer/src/components/panel-chat/{PanelSideChat,VersionSwitcher}.tsx`
- Modify: `src/renderer/src/components/chat/ChatPane.tsx` (splits horizontally when `selectedPanelId` is set, defaulting to 55/45), `src/renderer/src/events.ts`
- Test: `src/renderer/src/components/panel-chat/PanelSideChat.test.tsx`, `tests/e2e/panel-chat.spec.ts`

**Interfaces:**
- Consumes: `MessageList({ threadKey })` and `Composer` (Task 13), plus the `panelChat:*` and `panels:revert` channels.
- Produces: `PanelSideChat({ panelId })`, testid `panel-side-chat`.
  - The header has the current image thumbnail, the title `Panel <index+1>`, a `VersionSwitcher` and a close button.
  - Below are `MessageList threadKey={'panel:'+panelId}` and a `Composer` that sends `panelChat:send`.
  - Escape or the close button calls `selectPanel(null)`.
- Produces: `VersionSwitcher({ panel })`. It shows `panel-version-label` as `v{index of current among ready versions + 1} / {ready count}`, and the `version-prev`/`version-next` buttons call `panels:revert` with the neighboring ready version. The buttons are disabled at the ends.

- [ ] **Step 1: Write the failing tests**

```tsx
it('opens for the selected panel and closes on Escape', async () => { /* selectPanel(id) → panel-side-chat visible; Escape → hidden, selectedPanelId null */ })
it('version switcher reverts to the previous ready version', async () => { /* versions [v1 ready, v2 failed, v3 ready], current v3 → label 'v2 / 2'; prev → panels:revert {versionId: v1.id} */ })
it('sends through panelChat and shows streamed replies', async () => { /* type → panelChat:send {panelId}; emit agent.event threadKey 'panel:<id>' text-delta → visible */ })
```

```ts
// tests/e2e/panel-chat.spec.ts — M4 checkpoint
test('select a panel, edit it from the side chat, revert', async () => {
  const { app, page } = await launchApp({ script: { turns: [
    { toolCalls: [{ name: 'create_character', input: { name: 'Mina', role: 'protagonist', appearanceLock: 'Teenage girl, silver bob haircut, amber eyes, red bomber jacket.' } }] },
    { text: 'Created Mina.' },
    { toolCalls: [{ name: 'create_panel', input: { episodeId: { $episode: 'current' }, description: 'Mina looks up at the moon.', setting: 'Rooftop at night', shot: 'medium', characters: [{ characterId: { $character: 'Mina' }, variationId: { $variation: ['Mina', 'Base'] } }], dialogue: [] } }] },
    { text: 'Drew panel 1.' },
    { toolCalls: [{ name: 'edit_image', input: { instruction: 'make her smile' } }] },   // side chat turn
    { text: 'Updated.' } ] } })
  await createProjectAndSession(page, 'Moon Diary')
  await sendChat(page, 'Create Mina', 'Created Mina.'); await sendChat(page, 'Draw panel 1', 'Drew panel 1.')
  await page.getByTestId('tab-webtoon').click(); await page.getByTestId('panel-card').first().click()
  const side = page.getByTestId('panel-side-chat'); await expect(side).toBeVisible()
  await side.getByTestId('composer-input').fill('make her smile'); await side.getByTestId('composer-send').click()
  await expect(side.getByTestId('panel-version-label')).toHaveText('v2 / 2')
  await side.getByTestId('version-prev').click(); await expect(side.getByTestId('panel-version-label')).toHaveText('v1 / 2'); await app.close()
})
```

- [ ] **Step 2:** Run `npx vitest run src/renderer/src/components/panel-chat`. Expected: FAIL.
- [ ] **Step 3:** Implement the components and wire the split.
- [ ] **Step 4:** Run `npm run typecheck`, `npm test` and `npm run test:e2e`. Expected: PASS. **This is the Milestone 4 checkpoint.**
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat: panel side chat with version switcher"`

---

# Milestone 5 — Story direction, workflow docs, consistency check

### Task 23: StoryService, story tools, mode toggle and Story tab

**Files:**
- Create: `src/main/domain/markdown-sections.ts`, `src/main/domain/story-service.ts`, `src/main/agent/tools/story-tools.ts`, `src/main/ipc/handlers/story.ts`, `src/shared/prompts.ts`, `src/renderer/src/stores/story-store.ts`, `src/renderer/src/components/story/{StoryTab,BibleEditor,BeatList}.tsx`, `src/renderer/src/components/chat/{StoryModeToggle,ContinueStoryButton}.tsx`
- Modify: `src/main/agent/tools/index.ts`, `src/main/agent/agent-runner.ts` (the snapshot reads `storyMode` from meta, as before, so no change is needed beyond adding the tools), `src/main/services.ts` (adds `story`), `src/shared/ipc.ts`, `src/renderer/src/components/chat/ChatHeader.tsx`, `src/renderer/src/components/layout/RightPane.tsx`, `src/renderer/src/events.ts`
- Test: `src/main/domain/markdown-sections.test.ts`, `src/main/domain/story-service.test.ts`, `src/main/agent/tools/story-tools.test.ts`, `src/renderer/src/components/chat/StoryModeToggle.test.tsx`

**Interfaces:**
- Produces: `upsertMarkdownSection(md: string, heading: string, content: string): string`. It matches `## <heading>` case-insensitively, replaces the body up to the next `## `, appends the section when it is missing, and preserves everything else and the trailing newline. Also `listSections(md): string[]`.
- Produces: `class StoryService`, constructed with `{ bus; projects: ProjectStore }`. Methods:
  - `get(ctx, episodeId?: string): Promise<{ mode: StoryMode; bible: string; beats: Beat[] }>`. On first access it creates `story/bible.md` as `# Story Bible` followed by empty sections `Premise`, `World`, `Tone`, `Characters & Relationships`, `Arcs` and `Open Threads`, and creates `story/outline.json` as `{beats:[]}`.
  - `setMode(ctx, mode)`, which delegates to `projects.updateMeta`
  - `updateBibleSection(ctx, section, content)`
  - `replaceBible(ctx, markdown)`, used by the UI editor
  - `addBeats(ctx, episodeId, summaries: string[]): Promise<Beat[]>`
  - `updateBeat(ctx, beatId, patch: { summary?; status? })`
  - All mutations emit `story.changed`.
- Produces these tools:
  - `get_story { episodeId? }`
  - `update_story_bible { section, content }`
  - `add_beats { episodeId, beats: string[] }`
  - `update_beat { beatId, status?, summary? }`
  - They are added to `buildAgentTools`.
- Produces: `continueStoryPrompt(n: number): string`, which returns exactly `Continue the story (AI-led): plan the next beats and draw the next ${n} panels.`
- New IPC channels: `story:get {projectId, episodeId?}`, `story:setMode {projectId, mode}`, `story:updateBible {projectId, markdown}`, `story:updateBeat {projectId, beatId, patch}`.
- UI:
  - `StoryModeToggle` (`story-mode-toggle`) offers `User-led` and `AI-led`.
  - `ContinueStoryButton` (`continue-story`) is rendered only in AI-led mode. It sends `continueStoryPrompt(meta.autopilotPanels)` through `agent:send`.
  - `StoryTab` has `BibleEditor` (a textarea plus Save, which calls `story:updateBible`) and a `BeatList` for the active episode with status chips.

- [ ] **Step 1: Write the failing tests**

```ts
it('upserts sections without disturbing others', () => {
  const md = '# Story Bible\n\n## Premise\nold\n\n## World\nw\n'
  expect(upsertMarkdownSection(md, 'premise', 'new')).toBe('# Story Bible\n\n## Premise\nnew\n\n## World\nw\n')
  expect(upsertMarkdownSection(md, 'Arcs', 'a')).toBe('# Story Bible\n\n## Premise\nold\n\n## World\nw\n\n## Arcs\na\n')
})
it('creates the bible template and tracks beats', async () => { /* get → listSections == ['Premise','World','Tone','Characters & Relationships','Arcs','Open Threads']; addBeats 2 → planned; updateBeat drawn */ })
it('setMode persists and appears in the snapshot', async () => { /* setMode ai → meta.storyMode 'ai'; buildStateSnapshot contains 'story_mode: ai' */ })
it('story tools round-trip', async () => { /* update_story_bible Premise → get_story bible contains it */ })
```

```tsx
it('continue button only in AI-led mode and sends the pinned prompt', async () => { /* mode user → no continue-story; toggle → story:setMode 'ai'; click continue-story → agent:send text 'Continue the story (AI-led): plan the next beats and draw the next 4 panels.' */ })
```

- [ ] **Step 2:** Run `npx vitest run src/main/domain/markdown-sections src/main/domain/story-service src/main/agent/tools/story-tools src/renderer/src/components/chat`. Expected: FAIL.
- [ ] **Step 3:** Implement everything listed.
- [ ] **Step 4:** Run `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat: story bible, beats and story modes"`

### Task 24: The workflow docs (the regulating .md files) and the doc tool

**Files:**
- Create: `resources/agent-docs/workflows/story-direction.md`, `resources/agent-docs/workflows/character-creation.md`, `resources/agent-docs/workflows/panel-generation.md`, `resources/agent-docs/workflows/panel-editing.md`, `resources/agent-docs/reference/webtoon-style-guide.md`, `resources/agent-docs/reference/prompt-templates.md`, `resources/agent-docs/reference/consistency-checklist.md`, `src/main/agent/tools/doc-tools.ts`, `src/main/ipc/handlers/docs.ts`, `src/renderer/src/components/settings/WorkflowDocsTab.tsx`
- Modify: `resources/agent-docs/AGENTS.md` (the full version), `src/main/agent/tools/index.ts`, `src/shared/ipc.ts`, `src/renderer/src/components/settings/SettingsDialog.tsx`
- Test: `src/main/agent/workflow-docs.lint.test.ts`, `src/main/agent/tools/doc-tools.test.ts`

**Interfaces:**
- Produces: `read_workflow_doc { name }` → the doc's markdown. An unknown name gives `ToolError('Unknown doc: <name>. Available: <comma list>')`.
- Produces: `ALL_TOOL_NAMES: string[]` from `tools/index.ts`, which is the union of `buildAgentTools({vision:true}).names()` and `buildPanelChatTools('pnl_0000000000', {vision:true}).names()`.
- New IPC channels: `docs:list {projectId}`, `docs:open {projectId, name}` (`shell.openPath`) and `docs:reset {projectId}`. `WorkflowDocsTab` lists the docs with Open and a "Reset all to defaults" button that asks for confirmation.
- Doc content follows §11: required sections, hard rules R1–R12, the must-cover list per doc, ≥ 1,200 lines in total, and concrete examples. Every example tool call uses the real input field names from Tasks 16, 19, 21 and 23. `reference/prompt-templates.md` reproduces the templates from Tasks 15 and 17 verbatim. `reference/consistency-checklist.md` ends with the exact output contract `Respond with only one JSON object: {"passed": true|false, "issues": ["…"]}`.

- [ ] **Step 1: Write the failing lint tests**

```ts
const REQUIRED: Record<string, string[]> = {
  'AGENTS': ['Mission', 'Operating Loop', 'Story Modes', 'Hard Rules', 'Tool Catalog', 'Workflow Docs Index', 'Communication Style', 'Failure Handling'],
  'workflows/story-direction': ['Purpose', 'User-Led Mode', 'AI-Led Mode', 'Story Bible', 'Beats and Outline', 'Episode Structure', 'Vertical Pacing', 'Continuity Across Sessions', 'Conflicts and Retcons', 'Examples'],
  'workflows/character-creation': ['Purpose', 'Character Sheet', 'Writing the Appearance Lock', 'Base Reference Image', 'Variations', 'Variation Naming', 'When Not to Create a Variation', 'Automating Creation from Chat', 'Updating Characters', 'Examples'],
  'workflows/panel-generation': ['Purpose', 'Pipeline', 'Selecting the Cast', 'Choosing Variations', 'Using the Previous Panel', 'Shot and Aspect Selection', 'Writing the Description', 'Dialogue and SFX', 'Off-Panel Mentions', 'Reading the Consistency Check', 'Examples'],
  'workflows/panel-editing': ['Purpose', 'Scope', 'Edit vs Regenerate', 'Preserving Identity', 'Versions and Revert', 'Dialogue-Only Changes', 'Reporting Changes', 'Examples'],
  'reference/webtoon-style-guide': ['Format', 'Panel Aspects', 'Shot Vocabulary', 'Pacing and Gutters', 'Dialogue Conventions', 'Color and Lighting Continuity', 'Genre Notes'],
  'reference/prompt-templates': ['Panel Prompt', 'Base Reference Prompt', 'Variation Prompt', 'Panel Edit Prompt', 'Consistency Check Prompt'],
  'reference/consistency-checklist': ['Checklist', 'Output Format', 'Severity', 'Retry Guidance'],
}
it.each(Object.entries(REQUIRED))('%s has its required sections', (name, sections) => expect(listSections(read(name))).toEqual(expect.arrayContaining(sections)))
it('AGENTS.md states R1–R12', () => { for (let i = 1; i <= 12; i++) expect(read('AGENTS')).toMatch(new RegExp(`\\*\\*R${i}\\b`)) })
it('every tool is in the Tool Catalog', () => { const cat = extractSection(read('AGENTS'), 'Tool Catalog'); for (const t of ALL_TOOL_NAMES) expect(cat).toContain('`' + t + '`') })
it('docs reference only real tools', () => {
  const NON_TOOL_TOKENS = ['story_mode', 'current_episode', 'recent_panels']   // <project_state> keys
  for (const name of Object.keys(REQUIRED)) for (const [, tok] of read(name).matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)) expect([...ALL_TOOL_NAMES, ...NON_TOOL_TOKENS]).toContain(tok)
})
it('prompt templates mirror the code markers', () => { const s = extractSection(read('reference/prompt-templates'), 'Panel Prompt'); for (const m of ['[STYLE]', '[SETTING]', '[ACTION]', '[CHARACTERS]', '[CONTINUITY]']) expect(s).toContain(m) })
it('docs are substantial', () => expect(Object.keys(REQUIRED).reduce((n, k) => n + read(k).split('\n').length, 0)).toBeGreaterThanOrEqual(1200))
it('read_workflow_doc rejects unknown names', async () => { /* ok false, content starts 'Unknown doc: nope. Available: ' */ })
```

- [ ] **Step 2:** Run `npx vitest run src/main/agent/workflow-docs.lint src/main/agent/tools/doc-tools`. Expected: FAIL.
- [ ] **Step 3:** Write the full `AGENTS.md` and the seven docs to §11. In the Tool Catalog, give every tool its own bullet: name, purpose, when to use it, and the doc to read first. Implement `read_workflow_doc`, the docs IPC and the settings tab.
- [ ] **Step 4:** Run `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "docs: agent workflow docs with lint tests and doc tool"`

### Task 25: Vision consistency check with retries

**Files:**
- Create: `src/main/domain/consistency-checker.ts`
- Modify: `src/main/domain/panel-service.ts` (`generate` runs the check and retries), `src/main/services.ts` (adds `checker`, which `PanelService` takes as an optional dependency)
- Test: `src/main/domain/consistency-checker.test.ts`, plus additions to `src/main/domain/panel-service.test.ts`

**Interfaces:**
- Produces: `parseCheckResponse(text: string): CheckResult`. It takes the first `{…}` JSON object in the text, fenced or not, and requires boolean `passed` and string-array `issues`. Anything else gives `{ passed: true, issues: ['Checker response could not be parsed'], skipped: true }`.
- Produces: `class ConsistencyChecker`, constructed with `{ registry: ModelRegistry; docs: WorkflowDocs; imageOps: ImageOps; createTextProvider? }`. Method: `check(ctx, input: { imageRelPath: string; references: { relPath; label }[]; panel: Panel; roster: Character[] }): Promise<CheckResult | null>`.
  - It returns `null` when the `vision` role is unassigned.
  - Otherwise it runs one `runTurn` with no tools.
    - The system prompt is the `reference/consistency-checklist` doc.
    - The user message text lists the references in order, then the cast as `Name — appearanceLock — Look: variation name/delta`, the panel description and the shot.
    - `imagePaths` are the references followed by the generated image, all loaded through `loadImageForTextModel`, so they are downscaled to ≤1568.
  - Provider errors give `{ passed: true, issues: ['Consistency check failed to run: <msg>'], skipped: true }`.
- Change to `PanelService.generate`:
  - After a ready version, when a checker is configured, it stores `check` on the version.
  - While `!check.passed && !check.skipped && attempts <= meta.consistencyRetries`, it generates again with `extraInstruction = 'Fix these consistency issues: ' + issues.join('; ')`.
  - Every attempt stays in `versions`. `currentVersionId` is the last passing attempt, or else the last ready attempt.
  - It returns the version that became current.

- [ ] **Step 1: Write the failing tests**

```ts
it('parses fenced and bare JSON, tolerates junk', () => {
  expect(parseCheckResponse('```json\n{"passed": false, "issues": ["Mina hair is black"]}\n```')).toEqual({ passed: false, issues: ['Mina hair is black'], skipped: false })
  expect(parseCheckResponse('looks fine')).toMatchObject({ passed: true, skipped: true })
})
it('skips when no vision model is assigned', async () => expect(await checker.check(ctx, input)).toBeNull())
it('downscales every image before sending', async () => { /* identityImageOps calls all ['downscale', 1568]; count = references + 1 */ })
it('uses the checklist doc as system prompt', async () => { /* provider req.system === checklist content */ })
it('retries once with fix instructions and keeps history', async () => {
  // checker script: fail(['Mina hair is black']) then pass
  const v = await panels.generate(ctx, p.id)
  const panel = await panels.get(ctx, p.id)
  expect(panel.versions).toHaveLength(2); expect(panel.versions[1].prompt).toContain('[FIX] Fix these consistency issues: Mina hair is black')
  expect(panel.currentVersionId).toBe(v.id); expect(v.check).toMatchObject({ passed: true })
})
it('stops after consistencyRetries and keeps the last attempt', async () => { /* always fail, retries 1 → 2 versions, current = 2nd, check.passed false */ })
```

- [ ] **Step 2:** Run `npx vitest run src/main/domain/consistency-checker src/main/domain/panel-service`. Expected: FAIL.
- [ ] **Step 3:** Implement the checker and the retry loop in `generate`.
- [ ] **Step 4:** Run `npm test` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `git add -A && git commit -m "feat: vision consistency check with automatic retry"`

### Task 26: Full-flow end-to-end test and README

**Files:**
- Create: `tests/e2e/full-flow.spec.ts`, `README.md`
- Modify: `tests/e2e/helpers.ts` (adds `openTab(page, 'webtoon'|'characters'|'story')`; `createProjectAndSession` and `sendChat` come from Task 13, `readProjectJson` from Task 20)

**Interfaces:**
- Consumes everything above; this task adds no new production interfaces.

- [ ] **Step 1: Write the end-to-end test.** The mock script has these turns, grouped by the user message that triggers them. Every id is written as a `$character`, `$variation` or `$episode` placeholder (Task 12). Characters are created one message before any panel casts them.
  1. Message `Set up the story`:
     - turn A runs `update_story_bible {section:'Premise', content:'A girl who can hear the moon.'}`, `create_character` Mina and `create_character` Jin
     - turn B replies `Characters ready.`
  2. Message `Start episode 1`:
     - turn C runs `create_variation` (Mina, `Outfit: School uniform`, kind `outfit`), then `create_panel` with Mina/Base, description `Mina stares at the full moon.` and dialogue `[{speakerId:{$character:'Mina'}, kind:'speech', text:'Is anyone there?'}]`, then `create_panel` with Mina/Base and Jin/Base, description `Jin steps out of the shadows behind Mina.` and a narration line
     - turn D replies `Episode started.`
  3. Side chat on panel 2, message `make Jin frown`:
     - turn E runs `edit_image {instruction:'make Jin frown'}`
     - turn F replies `Done.`
  4. Switch to AI-led mode, then click `continue-story`:
     - turn G runs `add_beats {episodeId:{$episode:'current'}, beats:['Jin reveals the moon map']}` and `create_panel` with Jin/Base, description `Jin unrolls an old star map.`
     - turn H replies `Continued.`

  The test then asserts:
  - the Characters tab shows 2 cards, with Mina having 2 variations
  - the Webtoon tab shows 2 panels with dialogue overlays
  - the side chat edit gives `v2 / 2`
  - the Story tab shows the Premise
  - AI-led mode shows `continue-story`, and clicking it ends with 3 panels and the message `Continued.`
  - after a relaunch, the sessions, panels and characters are all still there
- [ ] **Step 2:** Run `npx playwright test tests/e2e/full-flow.spec.ts` after `npm run build`. Expected: FAIL, because `openTab` doesn't exist yet. If the test still fails once `openTab` is added, the failure is a real integration bug: fix it in the owning task's module and add a unit test there.
- [ ] **Step 3:** Add `openTab`, fix any integration bugs the test exposes, and write `README.md` covering:
  - prerequisites
  - `npm install`, `npm run dev`
  - first run on the mock models
  - adding Anthropic, OpenAI and Gemini endpoints, and which roles to assign
  - the project folder layout
  - editing the workflow docs per project
  - the test commands
  - a note that the server-side refusal fallback is on by default for supported Anthropic models, with how to turn it off per endpoint
- [ ] **Step 4:** Run `npm run typecheck`, `npm test` and `npm run test:e2e`. Expected: all PASS. **This is the Milestone 5 checkpoint.**
- [ ] **Step 5:** Commit: `git add -A && git commit -m "test: full-flow e2e and README"`
