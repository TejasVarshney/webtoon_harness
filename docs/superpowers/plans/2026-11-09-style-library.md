# Style Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user choose, add and edit art styles, and let the in-app LLM set one up while a project has no art.

**Architecture:** `ProjectMeta.stylePreset` stays the text every prompt uses. A new library (built-in constants plus `<userData>/styles.json`) is a catalog that the picker and the agent copy text from. The agent's `set_style` is refused once the project has art; the user's picker warns instead.

**Tech Stack:** Electron, React, TypeScript, zod, zustand, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-09-style-library-design.md`

## Global Constraints

- Work on branch `feat/style-library`, cut from `origin/main`. PRs target `main`.
- No change to `src/main/domain/prompts.ts` or `resources/agent-docs/reference/prompt-templates.md`.
- Write `styles.json` with `writeJsonAtomic`.
- New IPC channels go in `IpcContract` and `channelSet`, handlers in `src/main/ipc/handlers/`, input checked with `parseInput`.
- `src/shared/ipc.ts` keeps type-only imports, because zod must not enter the preload.
- User-visible text is asserted verbatim in tests.
- The agent gets no delete tool.
- Styles name no artist and no franchise.

## Review Focus

- `styles.json` is corrupt at startup: the app opens, the unedited built-ins list, and saves fail with a plain message. Pinned in Task 2.
- A style is renamed with only a case change: it is not reported as clashing with itself. Pinned in Task 2.
- An image is still generating when the agent calls `set_style`: the project counts as locked. Pinned in Task 3.
- The style a project uses is edited or deleted: the project's text is untouched. Pinned in Task 3.
- `styles:list` fails: the chat header and New Project dialog still work. Pinned in Task 5.

---

### Task 1: Style text rules and built-in presets

**Files:**
- Create: `src/main/domain/style-text.ts`, `src/main/domain/style-presets.ts`
- Modify: `src/shared/schemas.ts:66` (export the constant), `src/shared/ids.ts:4` (add `'sty'`), `src/shared/ipc.ts` (types only)
- Test: `src/main/domain/style-text.test.ts`, `src/main/domain/style-presets.test.ts`

**Interfaces:**
- Produces, in `@shared/ipc`: `type StyleEntry = { id: string; name: string; text: string; builtin: boolean; edited: boolean }` and `type StyleUsage = { sheets: number; panels: number }`
- Produces, in `style-text.ts`: `class StyleRejectedError extends Error`, `normalizeStyleText(raw: string): string`, `normalizeStyleName(raw: string): string`
- Produces, in `style-presets.ts`: `BUILTIN_STYLES: { id: string; name: string; text: string }[]`

- [ ] **Step 1: Write the failing tests**

```ts
// style-text.test.ts
it('collapses whitespace and strips trailing periods', () => expect(normalizeStyleText('  Ink wash,\n  bold lines.. ')).toBe('Ink wash, bold lines'))
it('rejects text under 3 or over 400 characters', () => {
  expect(() => normalizeStyleText(' a. ')).toThrow('A style description needs 3 to 400 characters.')
  expect(() => normalizeStyleText('x'.repeat(401))).toThrow('A style description needs 3 to 400 characters.')
  expect(normalizeStyleText('x'.repeat(400))).toHaveLength(400)
})
it.each(['speech bubbles', 'hand LETTERING', 'with captions', 'a watermark', 'artist signature'])('rejects %s', (bad) =>
  expect(() => normalizeStyleText(`Clean art, ${bad}`)).toThrow(
    'A style describes how the art looks. Take out the words about lettering, speech bubbles, captions, watermarks or signatures: every image prompt already forbids them.'
  ))
it('rejects names outside 1 to 40 characters', () => {
  expect(() => normalizeStyleName('   ')).toThrow('A style name needs 1 to 40 characters.')
  expect(() => normalizeStyleName('x'.repeat(41))).toThrow('A style name needs 1 to 40 characters.')
})

// style-presets.test.ts
it('has the ten built-ins in order', () => expect(BUILTIN_STYLES.map((s) => s.id)).toEqual(['korean-webtoon', 'soft-romance', 'action-manhwa', 'dark-fantasy', 'ink-noir', 'screentone-manga', 'watercolor', 'flat-slice-of-life', 'retro-comic', 'semi-realistic']))
it('korean-webtoon is the project default, character for character', () => expect(BUILTIN_STYLES[0].text).toBe(ProjectMetaSchema.parse({ id: 'prj_0000000000', title: 'T', createdAt: T, updatedAt: T }).stylePreset))
it('every built-in passes the text rules unchanged', () => { for (const s of BUILTIN_STYLES) expect(normalizeStyleText(s.text)).toBe(s.text) })
it('names are unique', () => expect(new Set(BUILTIN_STYLES.map((s) => s.name.toLowerCase())).size).toBe(10))
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/main/domain/style-text.test.ts src/main/domain/style-presets.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`normalizeStyleText`: replace `/\s+/g` with one space, trim, strip `/[.\s]+$/`, check length, then test `/speech bubble|lettering|caption|watermark|signature/i`. Copy names and texts from the spec's table. `korean-webtoon` uses the exported `DEFAULT_STYLE_PRESET`. Add the two types to `src/shared/ipc.ts` beside `WorkflowDocEntry`.

- [ ] **Step 4: Run them and see them pass**

Run: same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/domain/style-text.ts src/main/domain/style-text.test.ts src/main/domain/style-presets.ts src/main/domain/style-presets.test.ts src/shared/schemas.ts src/shared/ids.ts src/shared/ipc.ts
git commit -m "feat: style text rules and ten built-in styles"
```

---

### Task 2: StyleLibrary

**Files:**
- Create: `src/main/domain/style-library.ts`
- Modify: `src/main/services.ts`
- Test: `src/main/domain/style-library.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:

```ts
class StyleLibrary {
  constructor(file: string)
  load(): Promise<void>
  loadError(): string | null
  list(): StyleEntry[]                // built-ins in order (overrides applied), then custom in creation order
  get(id: string): StyleEntry | undefined
  create(input: { name: string; text: string }): Promise<StyleEntry>
  update(id: string, patch: { name?: string; text?: string }): Promise<StyleEntry>
  reset(id: string): Promise<StyleEntry>
  delete(id: string): Promise<void>
}
```

`Services.styleLibrary: StyleLibrary`, built with `join(opts.userDataDir, 'styles.json')` and loaded in `createServices`.

- [ ] **Step 1: Write the failing tests**

Each test builds a library on a temp folder whose parent directory does not exist yet. Names and assertions:

```ts
it('lists the built-ins when there is no file', ...)            // list().length === 10, every builtin true, edited false, loadError() null
it('creates a custom style after the built-ins, normalized', ...) // create({name:' Mine ', text:'Ink wash.'}) → id matches /^sty_/, name 'Mine', text 'Ink wash', builtin false; list().at(-1) is it
it('persists across a reload', ...)                             // new StyleLibrary(file).load() lists the custom style
it('rejects a name clash, ignoring case, including built-ins', ...) // create({name:'WATERCOLOR',...}) throws 'There is already a style named WATERCOLOR.'
it('allows renaming a style with only a case change', ...)       // update(id,{name:'MINE'}) resolves, name 'MINE'
it('edits a custom style in place', ...)                        // update(id,{text:'New look'}) keeps id and name
it('overrides a built-in and marks it edited', ...)             // update('watercolor',{text:'Wet wash'}) → text 'Wet wash', name 'Watercolor', builtin true, edited true
it('reset restores a built-in', ...)                            // reset('watercolor') → original text, edited false; file overrides empty
it('refuses to reset a custom style', ...)                      // throws 'Only a built-in style can be reset.'
it('refuses to delete a built-in', ...)                         // throws 'A built-in style cannot be deleted.'
it('deletes a custom style', ...)                               // list() no longer has it
it('reports an unknown id', ...)                                // update('nope',{name:'X'}) and delete('nope') throw 'Unknown style: nope'
it('a corrupt file leaves the built-ins and refuses saves without overwriting', ...)
// write '{"custom": oops'; load() resolves; loadError() not null; list().length === 10, none edited;
// create(...) throws 'styles.json is unreadable and was left untouched, so nothing was saved. Repair or remove it.'; file bytes unchanged
it('runs simultaneous creates without losing one', ...)          // Promise.all of 5 creates → all 5 listed after reload
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/main/domain/style-library.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Follow `PluginManager.load` for corrupt and missing files. File schema, local to this module: `{ custom: {id,name,text}[] default [], overrides: Record<string,{name,text}> default {} }`. Every save runs under one `KeyedMutex` key (`src/main/storage/mutex.ts`), builds a draft, creates the parent folder with `fs.promises.mkdir(dirname, { recursive: true })`, calls `writeJsonAtomic`, then adopts the draft. All rejections are `StyleRejectedError`. Override entries for ids that are not built in are kept and ignored. New ids use `newId('sty')`.

- [ ] **Step 4: Run them and see them pass**

Run: same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/domain/style-library.ts src/main/domain/style-library.test.ts src/main/services.ts
git commit -m "feat: a style library saved in user data"
```

---

### Task 3: StyleService and IPC

**Files:**
- Create: `src/main/domain/style-service.ts`, `src/main/ipc/handlers/styles.ts`
- Modify: `src/main/services.ts`, `src/shared/ipc.ts`, `src/main/ipc/register.ts`, `src/main/ipc/handlers/projects.ts`
- Test: `src/main/domain/style-service.test.ts`, `src/main/ipc/handlers/styles.test.ts`, `src/main/ipc/handlers/projects.test.ts` (create if absent)

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces:

```ts
class StyleService {
  constructor(deps: {
    projects: Pick<ProjectStore, 'updateMeta'>
    characters: Pick<CharacterService, 'list'>
    items: Pick<ItemService, 'list'>
    locations: Pick<LocationService, 'list'>
    episodes: Pick<EpisodeService, 'list'>
    panels: Pick<PanelService, 'list'>
  })
  usage(ctx: ProjectContext): Promise<StyleUsage>
  apply(ctx: ProjectContext, text: string): Promise<ProjectMeta>   // normalizes, then updateMeta({ stylePreset })
}
```

`Services.styles: StyleService`. Channels:

| Channel | req | res |
|---|---|---|
| `styles:list` | `Record<string, never>` | `{ styles: StyleEntry[]; loadError: string \| null }` |
| `styles:create` | `{ name: string; text: string }` | `StyleEntry` |
| `styles:update` | `{ id: string; patch: { name?: string; text?: string } }` | `StyleEntry` |
| `styles:reset` | `{ id: string }` | `StyleEntry` |
| `styles:delete` | `{ id: string }` | `void` |
| `styles:usage` | `{ projectId: string }` | `StyleUsage` |
| `styles:apply` | `{ projectId: string; styleId: string }` | `ProjectMeta` |

- [ ] **Step 1: Write the failing tests**

`style-service.test.ts` passes fake deps built with `makeCharacter`, `makeVariation`, `makeItem`, `makeItemUsage`, `makeLocation`, `makeLocationState`, `makeEpisode`, `makePanel`:

```ts
it('is zero for an empty project', ...)                     // { sheets: 0, panels: 0 }
it('counts ready and pending sheets of each kind', ...)      // one ready variation, one pending item usage, one ready location state → sheets 3
it('ignores failed sheets and failed panel versions', ...)   // all status 'failed' → { sheets: 0, panels: 0 }
it('counts a panel once however many versions it has', ...)  // versions ready, ready → panels 1
it('counts a panel with a pending version', ...)             // panels 1
it('counts archived characters', ...)                        // asserts list was called with { includeArchived: true }; same for items and locations
it('counts panels across all episodes', ...)                 // two episodes, one panel each → panels 2
```

`styles.test.ts` uses `testServices`, following `story.test.ts`:

```ts
it('lists, creates, updates, resets and deletes', ...)
it('rejects a non-string name', ...)                          // styles:create { name: 3 } rejects
it('applies a library style to a project', ...)               // styles:apply {styleId:'watercolor'} → meta.stylePreset equals the built-in text
it('applying an unknown style fails and leaves the project', ...) // rejects 'Unknown style: nope'; getMeta unchanged
it('editing the style a project uses leaves the project text', ...)
it('deleting the style a project uses leaves the project text', ...)
it('applies even when the project has art', ...)              // vi.spyOn(services.styles,'usage') → {sheets:1,panels:0}; apply succeeds
it('reports usage', ...)                                      // { sheets: 0, panels: 0 } on a new project
```

`projects.test.ts`:

```ts
it('create normalizes a given style', ...)      // stylePreset 'Ink wash.' stored as 'Ink wash'
it('create rejects a style asking for lettering', ...)
it('create without a style gets the default', ...)
it('update normalizes a style patch', ...)
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/main/domain/style-service.test.ts src/main/ipc/handlers/styles.test.ts src/main/ipc/handlers/projects.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`usage` reads the lists with `{ includeArchived: true }`, and panels through `episodes.list` then `panels.list(ctx, episode.id)`. Register `stylesHandlers(services)` in `register.ts`. In `projects.ts`, pass `stylePreset` through `normalizeStyleText` on `projects:create` and `projects:update` when it is given.

- [ ] **Step 4: Run them and see them pass**

Run: same command, then `npx vitest run src/main/ipc/register.test.ts` (every channel has a handler). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/domain/style-service.ts src/main/domain/style-service.test.ts src/main/ipc/handlers/styles.ts src/main/ipc/handlers/styles.test.ts src/main/ipc/handlers/projects.ts src/main/ipc/handlers/projects.test.ts src/main/ipc/register.ts src/main/services.ts src/shared/ipc.ts
git commit -m "feat: style usage counts and the styles IPC channels"
```

---

### Task 4: Agent tools and docs

**Files:**
- Create: `src/main/agent/tools/style-tools.ts`, `resources/agent-docs/workflows/style-setup.md`
- Modify: `src/main/agent/tools/index.ts`, `resources/agent-docs/AGENTS.md:55,78,193,216-225`, `src/main/agent/workflow-docs.lint.test.ts:19-31`, `src/main/agent/tools/doc-tools.test.ts:19-30`, `src/main/ipc/handlers/docs.test.ts:43`
- Test: `src/main/agent/tools/style-tools.test.ts`

**Interfaces:**
- Consumes: `services.styleLibrary`, `services.styles`.
- Produces: `styleTools: ToolDefinition[]`, added to `buildAgentTools` before `docTools`, because `read_workflow_doc` must stay last.

- [ ] **Step 1: Write the failing tests**

Set up like `doc-tools.test.ts`, running calls through `buildAgentTools({ vision: false }).execute`:

```ts
it('list_styles shows the library, the current style and canChange', ...)  // content.styles.length 10; content.current equals meta.stylePreset; content.canChange true
it('list_styles says when it is locked', ...)                              // usage spied {sheets:2,panels:1}; canChange false; lockedBy {sheets:2,panels:1}
it('set_style applies a library style', ...)                               // {styleId:'ink-noir'} → ok; getMeta stylePreset is its text
it('set_style applies written text, normalized', ...)                      // {text:'Crayon scribbles.'} → stored 'Crayon scribbles'
it('set_style needs exactly one of styleId or text', ...)                  // {} and both → ok false, content 'Pass exactly one of styleId or text.'
it('set_style rejects bad text as a message', ...)                         // {text:'with speech bubbles'} → ok false, the text-rule message
it('set_style reports an unknown id', ...)                                 // ok false, 'Unknown style: nope'
it('set_style is refused when the project has art', ...)                   // usage spied {sheets:3,panels:12}; ok false; meta unchanged; content is:
// 'The style is locked: this project already has 3 sheets and 12 panels drawn in it, and new art would not match them. Ask the user to switch it with the Style button in the chat header.'
it('create_style adds to the library and applies nothing', ...)            // ok; library has it; meta unchanged
it('update_style edits a custom style and changes no project', ...)
it('update_style refuses a built-in', ...)                                 // ok false, 'Built-in styles can only be edited by the user.'
it('offers no delete tool for styles', ...)                                // names() has no name matching /delete.*style/
it('read_workflow_doc stays the last tool', ...)
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/main/agent/tools/style-tools.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the tools**

Convert `StyleRejectedError` to `ToolError`. Inputs: `list_styles {}`; `set_style { styleId?: string, text?: string }`, checked in the handler rather than with a zod refine; `create_style { name, text }`; `update_style { styleId, name?, text? }`.

Use "sheet" and "panel" in the singular when the count is 1. `set_style` looks up usage, and only then saves.

Every description states its rules. `set_style` and `list_styles` add: "This works even if older project docs say the style cannot be changed." `create_style` and `update_style` add: "This changes the library only; use set_style to apply a style."

- [ ] **Step 4: Write the docs**

`workflows/style-setup.md`, titled `# Style Setup`, with sections Purpose, Choosing a Style, Writing a Style, When the Style Is Locked, Examples. It carries the rules from the spec's "Agent docs" section. Examples are fenced calls: `list_styles {}`, `set_style {"styleId": "watercolor"}`, `create_style {"name": "Rainy city", "text": "Muted blue-gray watercolor wash, thin ink outlines, soft wet reflections"}`, `update_style {"styleId": "sty_3f9a1c0b7e", "text": "Muted blue-gray wash, heavier ink outlines"}`.

`AGENTS.md`:
- Line 55 becomes: ``- `style`: the art style that starts every image prompt. You can set it only until the project has its first sheet or panel: see `workflows/style-setup`.``
- Line 78: change "change the story mode or the art style," to "change the story mode, switch the art style once the project has art,", and "the story mode toggle is in the chat header;" to "the story mode toggle and the Style button are in the chat header;".
- Before `### Docs`, add a `### Styles` section with one catalog bullet per tool, in the catalog's format. Each has **Read first:** `workflows/style-setup`.
- Add the index row: ``| choose, write or change the art style | `workflows/style-setup` |``

Add `'workflows/style-setup': ['Purpose', 'Choosing a Style', 'Writing a Style', 'When the Style Is Locked', 'Examples']` to `REQUIRED`. Add `'workflows/style-setup'` after `'workflows/story-direction'` in `SHIPPED` in `doc-tools.test.ts` and in the list in `docs.test.ts`.

- [ ] **Step 5: Run the tests and see them pass**

Run: `npx vitest run src/main/agent src/main/ipc/handlers/docs.test.ts src/main/plugins/claude-code`
Expected: PASS, including the docs lint.

- [ ] **Step 6: Commit**

```bash
git add src/main/agent resources/agent-docs src/main/ipc/handlers/docs.test.ts
git commit -m "feat: agent tools to list, set, add and edit styles"
```

---

### Task 5: Style picker and New Project dropdown

**Files:**
- Create: `src/renderer/src/components/styles/StyleButton.tsx`, `StyleDialog.tsx`, `StyleForm.tsx`, `style-name.ts` in the same folder
- Modify: `src/renderer/src/components/chat/ChatHeader.tsx:21`, `src/renderer/src/stores/app-store.ts`, `src/renderer/src/components/sessions/NewProjectDialog.tsx`, `src/renderer/src/components/sessions/SessionSidebar.tsx:230-231`, `src/renderer/src/styles.css`
- Test: `src/renderer/src/components/styles/StyleDialog.test.tsx`, `src/renderer/src/components/sessions/NewProjectDialog.test.tsx`

**Interfaces:**
- Consumes: the Task 3 channels.
- Produces:
  - `styleNameFor(styles: StyleEntry[], stylePreset: string): string`, the entry's name or `'Custom'`
  - app store `applyStyle(styleId: string): Promise<void>`, modeled on `setStoryMode`
  - app store `createProject(title: string, stylePreset?: string): Promise<void>`
  - `NewProjectDialogProps.onCreate(title: string, stylePreset?: string)`

- [ ] **Step 1: Write the failing tests**

Use `installFakeApi`, with a helper returning two built-ins (`Korean webtoon`, one edited `Watercolor`) and one custom (`Mine`). `meta.stylePreset` is the Korean webtoon text.

```ts
// StyleDialog.test.tsx, rendering <StyleButton /> with an open project
it('shows the current style name on the button', ...)      // 'Style: Korean webtoon'
it('shows Custom when no style matches', ...)              // stylePreset 'Something else' → 'Style: Custom'
it('stays usable when the list fails', ...)                // styles:list rejects → 'Style: Custom', no thrown error
it('marks the current style and lists the others', ...)    // dialog named 'Art style'; three rows; current row reads 'Current'
it('switches at once when the project has no art', ...)    // Use on Watercolor → styles:usage then styles:apply {projectId, styleId:'watercolor'}; button updates; dialog closes
it('warns before switching when the project has art', ...) // usage {sheets:3,panels:12}; exact text:
// '3 sheets and 12 panels were drawn in the current style. New images will use the new style, and references drawn in the old one may not match. Nothing is redrawn automatically.'
// no styles:apply until 'Switch style'
it('uses the singular for one', ...)                       // usage {sheets:1,panels:1} → '1 sheet and 1 panel were drawn...'
it('cancelling the warning changes nothing', ...)          // no styles:apply
it('adds a style', ...)                                    // Add style, fill Name and Description, Save style → styles:create; row appears
it('shows a rejected style inline and keeps what was typed', ...) // styles:create rejects → alert with the message; fields still filled
it('edits a built-in and offers reset once edited', ...)   // Edit on Watercolor → styles:update; Reset to default only on the edited row
it('resets an edited built-in', ...)                       // styles:reset {id:'watercolor'}
it('only custom styles can be deleted, after confirming', ...) // Delete only on Mine; first click shows 'Confirm delete'; second calls styles:delete
it('shows a library load error', ...)                      // loadError set → role alert shows it

// NewProjectDialog.test.tsx
it('offers the styles and preselects the first', ...)      // select labeled 'Style', value is the first style
it('passes the chosen style text', ...)                    // choose Watercolor → onCreate('Moon', <its current text>)
it('still creates when the list fails', ...)               // no select; onCreate('Moon', undefined)
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/renderer/src/components/styles src/renderer/src/components/sessions/NewProjectDialog.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `StyleButton` has `data-testid="style-button"` and label `Style: {name}`. It renders nothing without an open project. It calls `styles:list` when the project id or `stylePreset` changes and when the dialog closes; a failure means an empty list.
- `StyleDialog` is a `.modal` with `role="dialog"` and `aria-label="Art style"`. Rows have `data-testid="style-row"` and show name, text and, per the tests, `Current` or `Use`, `Edit`, `Delete`, `Reset to default`. The list loads when it opens.
- `StyleForm` has fields labeled `Name` and `Description` (a textarea), and buttons `Save style` and `Cancel`.
- Mount `<StyleButton />` before `<StoryModeToggle />` in `ChatHeader`.
- Style rows with existing tokens in `styles.css`, and let the list scroll inside the modal.

- [ ] **Step 4: Run them and see them pass**

Run: same command, then `npx vitest run src/renderer`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src
git commit -m "feat: a style picker and a style choice for new projects"
```

---

### Task 6: End-to-end, README, full check

**Files:**
- Create: `tests/e2e/styles.spec.ts`
- Modify: `tests/e2e/docs.spec.ts:20`, `README.md`

- [ ] **Step 1: Write the end-to-end test**

```ts
test('a chosen style reaches the panel prompt', async () => {
  // launchApp with a script whose turn calls create_panel { episodeId: {$episode:'current'}, description, setting, shot:'wide', characters: [], dialogue: [] }, then text 'Drew it.'
  // createProjectAndSession; click style-button; in the 'watercolor' row click Use; expect style-button 'Style: Watercolor'
  // sendChat('Draw', 'Drew it.')
  // read the panel as panels.spec.ts:52-53 does
  // expect(panel.versions[0].prompt).toContain('[STYLE] Soft watercolor illustration style')
})
test('the agent sets a style while the project has no art, and is refused after', async () => {
  // script: set_style {styleId:'ink-noir'}, text 'Set.', then create_panel, text 'Drew.', then set_style {styleId:'watercolor'}, text 'Tried.'
  // after the first chat, expect style-button 'Style: Ink noir'
  // after the last chat, expect style-button still 'Style: Ink noir'
})
test('a style the user adds is kept after a restart', async () => {
  // add a style through the dialog, close the app, launchApp with the same userDataDir and projectsRoot, open the dialog, expect the row
})
```

Change `toHaveCount(10)` to `toHaveCount(12)` in `tests/e2e/docs.spec.ts`.

- [ ] **Step 2: Add the README section**

Add `## Art styles` after `## Story modes`, covering the Style button, built-ins, adding and editing, `styles.json` in user data, and the LLM's limit. Add `workflows/style-setup` wherever the README lists workflow docs.

- [ ] **Step 3: Build and run the end-to-end specs**

Run: `npm run build`, then `npx playwright test tests/e2e/styles.spec.ts tests/e2e/docs.spec.ts`
Expected: PASS.

- [ ] **Step 4: Run the full check**

Run: `npm run check`
Expected: PASS: typecheck, dead code, unit and structure tests.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/styles.spec.ts tests/e2e/docs.spec.ts README.md
git commit -m "test: styles end to end, and document them"
```
