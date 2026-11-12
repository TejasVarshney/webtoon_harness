# Free Strip Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the renderer around a home page, a free-form strip beside the AI chat, and a chat-free Generate page.

**Architecture:** Positions live on panels and are resolved by one pure function, `resolveStrip`, shared by screen and export. The strip stacks absolutely positioned panel cards with a separate bubble layer above them, so bubbles can leave their panel. The Generate page keeps its draft in a store and creates the panel in a single IPC call.

**Tech Stack:** Electron, React, TypeScript, Zustand, Zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-09-free-strip-redesign-design.md`

## Global Constraints

- Work on a new branch `feat/free-strip` cut from `feat/style-library`, which is 9 commits ahead of `origin/main` and has no PR. Open the PR as a draft stacked on it, or merge style-library first.
- Each phase ends with `npm run check` passing and its listed e2e specs passing. `docs.spec.ts` is already red on main (expects 10 docs, 11 ship); it is not a regression.
- Strip width is `STRIP_CSS_WIDTH` (440). Minimum panel width 80. Flow gaps: tight 8, normal 48, long 120. Row gap 6. Trailing canvas space below the content 1600.
- No lock across a model call. A panel's lock is never held with an episode's. Project files use `writeJsonAtomic` or `writeFileAtomic`; session JSONL appends.
- New IPC: add to `IpcContract` and `channelSet`, handler in `src/main/ipc/handlers/`, input through `parseInput`.
- A change to `src/main/domain/prompts.ts` needs the same change in `resources/agent-docs/reference/prompt-templates.md`.
- User-visible text is asserted verbatim: change the test with the text. Keep testids where the concept survives: `new-project`, `new-session`, `session-item`, `pane-chat`, `.main-chat`, `pane-visualizer`, `panel-card`, `add-panel`, `export-open`, `panel-workspace`.
- `resources/agent-docs/` is product content: edit it only where a task says so.
- Old project files must keep loading: every new field has a default, removed fields are stripped on read.

## Review Focus

1. The agent adds a panel while the user has arranged the strip: it must not land on top of their panels. (Task 6)
2. An old project opens: panels sit where they did and black gutter bands survive. (Tasks 6, 12)
3. A bubble is dragged far below the last panel, then the episode is exported: the output still stops at the last panel. (Task 14)
4. More panels are selected than the image model takes: the page says how many will not be sent. (Task 16)
5. A selected panel is deleted before drawing, or the user presses Back with a sketch drawn: drawing still works, and work is not silently lost. (Tasks 15, 17)

## Core Requirements

The user's own words, and where each is delivered and proved.

| Requirement | Task | Proved by |
|---|---|---|
| When the app starts, show the home page | 1 | `loadProjects lists projects and opens none` |
| See my previous projects | 1 | `shows a card per project, newest first` |
| Create a new one | 1 | `with no projects invites the first one`, `new-project` on the home page |
| Once I create the new project I enter the harness | 1 | `creating a project enters the harness` |
| Create or open another project from a File dropdown | 2 | `New project opens the dialog`, `lists every project and opens the one clicked` |
| Manhwa panels at the left | 2 | `puts the visualizer before the chat` |
| AI chatbot at the right | 2 | `puts the visualizer before the chat` |
| New session, previous sessions and bookmarks in the chatbot | 3 | `lists bookmarked sessions first under their own heading`, `New session and Ctrl+N make a session` |
| Remove the sessions section | 3 | `has no sessions sidebar` |
| Required editing tools in the panel view | 10, 11 | `PanelTools.test.tsx` |
| Directly edit a panel without entering editing mode | 8, 10, 11 | `a click does not open the editor, a double-click does`, `Scene opens the panel's scene fields in place`, `a bubble can be pressed on a panel that is not selected` |
| Editing mode becomes focus mode | 8, 10 | `is named Focus mode`, `Focus opens focus mode` |

## File Structure

| Path | Responsibility |
|---|---|
| `src/shared/strip-canvas.ts` | Pure placement: resolve, clamp, reading order, export bottom. Replaces `strip-layout.ts` usage on screen; `layoutStrip` stays as its flow helper. |
| `src/shared/strip-background.ts` | Pure background to CSS, legacy conversion. |
| `src/renderer/src/components/home/HomePage.tsx` | Project list and creation. |
| `src/renderer/src/components/layout/WorkspaceLayout.tsx` | Top bar, left and right panes, focus overlay. Replaces `ThreePaneLayout`. |
| `src/renderer/src/components/layout/FileMenu.tsx` | File dropdown. |
| `src/renderer/src/components/layout/StudioPane.tsx` | The tabs, renamed from `RightPane`. |
| `src/renderer/src/components/chat/ChatSessions.tsx` | New session, session dropdown, bookmarks. Replaces `SessionSidebar`. |
| `src/renderer/src/components/visualizer/StripCanvas.tsx` | The free strip, on screen and in export. Replaces `WebtoonStrip`. |
| `src/renderer/src/components/visualizer/StripBubbles.tsx` | One panel's bubble layer. |
| `src/renderer/src/components/visualizer/PanelTools.tsx` | Tools on the selected panel. |
| `src/renderer/src/components/visualizer/SelectionBar.tsx` | The Generate button for a shift selection. |
| `src/renderer/src/components/visualizer/use-strip-drag.ts` | Move, group move, resize, nudge. |
| `src/renderer/src/components/visualizer/BackgroundEditor.tsx` | Background popover. |
| `src/renderer/src/components/generate/*` | `GeneratePage`, `LibraryColumn`, `ReferenceRow`, `GenerateSketch`, `PromptColumn`, `generate-draft.ts`. |
| `src/renderer/src/stores/generate-store.ts` | The page's request and draft. |

---

## Phase 1: Shell

### Task 1: Home page and no auto-open

**Files:**
- Create: `src/renderer/src/components/home/HomePage.tsx`, `HomePage.test.tsx`
- Modify: `src/renderer/src/stores/app-store.ts:78-85`, `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`, `tests/e2e/helpers.ts`, `tests/e2e/smoke.spec.ts`
- Test: `src/renderer/src/stores/app-store.test.ts`

**Interfaces:**
- Produces: `useAppStore.closeProject(): void` (sets `projectId`, `sessions`, `sessionId`, selection and `activeEpisodeId` empty). `HomePage(): JSX.Element`. `App` renders `HomePage` while `projectId === null`. `readLastProject`/`writeLastProject` are deleted.

- [ ] **Step 1: Write the failing tests**

```ts
it('loadProjects lists projects and opens none', async () => {
  await useAppStore.getState().loadProjects()
  expect(useAppStore.getState().projects).toHaveLength(2)
  expect(useAppStore.getState().projectId).toBeNull()
  expect(invoke).not.toHaveBeenCalledWith('projects:open', expect.anything())
})
```

In `HomePage.test.tsx`: `shows a card per project, newest first` (`getAllByTestId('project-card')` text order); `clicking a card opens that project` (`projects:open` called with its id); `with no projects invites the first one` (heading `Start your first project`, button with testid `new-project`); `creating a project enters the harness` (after the dialog's Create, `projectId` is the new project's id and `App` no longer renders `HomePage`).

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run src/renderer/src/stores/app-store.test.ts src/renderer/src/components/home`
Expected: FAIL (`projects:open` called; module not found).

- [ ] **Step 3: Implement**

Heading `Your projects`. Cards use testid `project-card`, sorted by `updatedAt` descending, showing title and `relativeTime` (move it out of `SessionSidebar` to `src/renderer/src/components/sessions/relative-time.ts`). Reuse `NewProjectDialog` and `ProjectProblems`. Delete the last-project storage.

- [ ] **Step 4: Update e2e helpers**

`createProjectAndSession` still clicks `new-project` on the home page. A relaunch test that expects the last project open must click its `project-card` first.

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run src/renderer/src/stores/app-store.test.ts src/renderer/src/components/home`, then `npm run build` and `npx playwright test tests/e2e/smoke.spec.ts`
Expected: PASS.

```bash
git add src tests
git commit -m "feat: start on a home page of the user's projects"
```

### Task 2: Two-pane workspace and File menu

**Files:**
- Create: `src/renderer/src/components/layout/WorkspaceLayout.tsx` and test, `FileMenu.tsx` and test, `StudioPane.tsx`
- Delete: `ThreePaneLayout.tsx` and test, `RightPane.tsx` and test
- Modify: `App.tsx`, `chat/ChatHeader.tsx`, `src/main/index.ts:41`, `styles.css`, `tests/e2e/helpers.ts`, e2e specs using `project-select`

**Interfaces:**
- Produces: `WorkspaceLayout({ header, left, right, overlay })`. `FileMenu()`. Store key `rightTab` is renamed `studioTab`, `setRightTab` is `setStudioTab`, type `StudioTab`. `helpers.ts` gains `openProjectFromMenu(page, title)` and `openSettings(page)`.

- [ ] **Step 1: Write the failing tests**

`WorkspaceLayout.test.tsx`: `puts the visualizer before the chat` (in DOM order, `pane-visualizer` precedes `pane-chat`); `makes the panes inert under the overlay`. `FileMenu.test.tsx`: `lists every project and opens the one clicked`; `New project opens the dialog` (item testid `new-project`); `Home closes the project` (`projectId` null); `Settings opens the dialog` (item testid `settings-open`); `Ctrl+Shift+N opens the new project dialog`.

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run src/renderer/src/components/layout`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

Left panel `pane-visualizer` default 60%, min 40%; right panel `pane-chat` default 40%, min 26%. Header: `FileMenu`, project title, then `StyleButton`, `ContinueStoryButton`. `ProjectProblems` appears in the header as a warning control when there are problems. Update the `minWidth` comment in `main/index.ts`. Until Task 3, `SessionSidebar` mounts above `ChatPane` in the right pane so sessions stay reachable; remove its brand, project switcher, New project and Settings now, with their tests, since the File menu has them.

- [ ] **Step 4: Verify and commit**

Run: `npm run check`, then `npm run build` and `npx playwright test tests/e2e/smoke.spec.ts tests/e2e/problems.spec.ts`
Expected: PASS.

```bash
git add src tests
git commit -m "feat: panels on the left, chat on the right, projects in a File menu"
```

### Task 3: Sessions and bookmarks in the chat

**Files:**
- Create: `src/renderer/src/components/chat/ChatSessions.tsx` and test
- Delete: `sessions/SessionSidebar.tsx` and test
- Modify: `src/main/sessions/session-store.ts:26-50`, its test, `src/shared/types.ts:126`, `src/shared/ipc.ts`, session IPC handler, `stores/app-store.ts`, `chat/ChatPane.tsx`, `App.tsx`, `tests/e2e/helpers.ts`, `tests/e2e/sessions.spec.ts`

**Interfaces:**
- Produces: `SessionSummary.bookmarked: boolean`. `SessionStore.setBookmarked(ctx, sessionId, bookmarked: boolean): Promise<void>`. IPC `'sessions:bookmark': { req: { projectId: string; sessionId: string; bookmarked: boolean }; res: void }`. `useAppStore.bookmarkSession(id, bookmarked): Promise<void>`. `helpers.ts` gains `openSessions(page)` (clicks testid `sessions-toggle`).

- [ ] **Step 1: Write the failing tests**

```ts
it('records a bookmark without changing updatedAt', async () => {
  const before = (await store.list(ctx))[0]
  await store.setBookmarked(ctx, before.id, true)
  const after = (await store.list(ctx))[0]
  expect(after.bookmarked).toBe(true)
  expect(after.updatedAt).toBe(before.updatedAt)
})
it('the latest bookmark record wins', async () => { /* true then false reads false */ })
```

`ChatSessions.test.tsx`: `lists bookmarked sessions first under their own heading` (headings `Bookmarked`, `Previous sessions`; a bookmarked session is not repeated); `the star toggles the bookmark`; `New session and Ctrl+N make a session`; `rename and delete still work`. In `App` or `WorkspaceLayout` tests: `has no sessions sidebar` (`queryByTestId('pane-sessions')` is null, and `session-item` appears only inside `pane-chat`).

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run src/main/sessions src/renderer/src/components/chat/ChatSessions.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add `BookmarkRecord` beside `LinkRecord`, appended like `setClaudeSessionId`. Port the rename, delete-confirm and context menu from `SessionSidebar`. `ChatSessions` sits at the top of `ChatPane`: a `new-session` button and a `sessions-toggle` dropdown showing the current title.

- [ ] **Step 4: Verify and commit**

Run: `npm run check`, then `npm run build` and `npx playwright test tests/e2e/sessions.spec.ts tests/e2e/chat.spec.ts`
Expected: PASS.

```bash
git add src tests
git commit -m "feat: sessions and bookmarks live in the chat"
```

### Task 4: Remove story modes

**Files:**
- Delete: `chat/StoryModeToggle.tsx` and test
- Modify: `src/shared/schemas.ts:31,73`, `types.ts`, `ipc.ts:36,43,177,179` and `channelSet`, `prompts.ts`, `src/main/storage/project-store.ts:50`, `src/main/domain/story-service.ts`, `src/main/ipc/handlers/story.ts`, `src/main/agent/system-prompt.ts:49`, `stores/app-store.ts`, `stores/story-store.ts`, `chat/ContinueStoryButton.tsx`, `chat/ChatHeader.tsx`, `resources/agent-docs/AGENTS.md`, `workflows/{character-creation,item-creation,style-setup,story-direction,panel-generation}.md`, and the tests naming these

**Interfaces:**
- Produces: `continueStoryPrompt(n)` returns `Continue the story: plan the next beats and draw the next ${n} panels.`. `story:get` returns `{ bible, beats }`.

- [ ] **Step 1: Write the failing tests**

```ts
it('reads a project saved with a story mode and drops it', () => {
  const m = ProjectMetaSchema.parse({ id: 'prj_0000000001', title: 'T', storyMode: 'user', createdAt: T, updatedAt: T })
  expect(m).not.toHaveProperty('storyMode')
})
it('the continue prompt has no mode', () => {
  expect(continueStoryPrompt(4)).toBe('Continue the story: plan the next beats and draw the next 4 panels.')
})
```

`ContinueStoryButton`: `shows on any project with a session`. System prompt: `has no story_mode line`.

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run src/shared/schemas.test.ts src/renderer/src/components/chat src/main/agent`
Expected: FAIL.

- [ ] **Step 3: Implement the code removal**

Delete `StoryModeSchema`, `story:setMode`, `setMode`, `setStoryMode`, and `meta.storyMode !== 'ai'`. Let `tsc` find the rest.

- [ ] **Step 4: Rewrite the agent docs**

`AGENTS.md`: replace `## Story Modes` with `## Story Direction`, keeping only the AI-led rules and the new Continue prompt, and drop "story mode toggle" from the no-tools line. In the workflows, delete user-led sentences and examples, keep the AI-led branch as the only behaviour, and renumber examples. Confirm `grep -ri "user-led\|story_mode\|story mode" resources src tests` returns nothing.

- [ ] **Step 5: Verify and commit**

Run: `npm run check`, then `npm run build` and `npx playwright test tests/e2e/full-flow.spec.ts`
Expected: PASS.

```bash
git add src tests resources
git commit -m "feat: remove user-led mode; the agent always directs the story"
```

### Task 5: Episode names are fixed at creation

**Files:**
- Modify: `src/shared/ipc.ts:147`, `src/main/ipc/handlers/panels.ts` (`UpdateEpisodeSchema`), `stores/panels-store.ts:164`, `visualizer/EpisodeBar.tsx`, its test or `WebtoonPane.test.tsx`

**Interfaces:**
- Produces: `episodes:update` patch is `{ synopsis?: string }`.

- [ ] **Step 1: Write the failing test**

```ts
it('refuses a new title', async () => {
  await expect(handlers['episodes:update']({ projectId, episodeId, patch: { title: 'New' } })).rejects.toThrow()
})
```

`EpisodeBar`: `creates an episode with the typed name` and `offers no way to rename` (no element with accessible name matching `/rename/i`).

- [ ] **Step 2: Run to confirm it fails**

Run: `npx vitest run src/main/ipc/handlers/panels.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Make the patch schema `.strict()` with `synopsis` only. Remove any `title` in renderer callers.

- [ ] **Step 4: Verify and commit**

Run: `npm run check`
Expected: PASS.

```bash
git add src
git commit -m "fix: an episode keeps the name it was created with"
```

---

## Phase 2: Free strip

### Task 6: Placement model

**Files:**
- Create: `src/shared/strip-canvas.ts`, `src/shared/strip-canvas.test.ts`
- Modify: `src/shared/schemas.ts:307-369`, `src/shared/types.ts`, `src/main/test/factories.ts`, `src/renderer/src/test/panel-fixtures.ts`

**Interfaces:**
- Produces:

```ts
PanelPlacementSchema // { x: number, y: number, width: number }; Panel.placement nullable default null
export interface PlacedPanel { panel: Panel; x: number; y: number; width: number; height: number; share: number; slant?: 'left' | 'right' }
export function panelHeight(width: number, aspect: PanelAspect): number
export function resolveStrip(panels: Panel[]): PlacedPanel[]        // same order as panels
export function contentBottom(placed: PlacedPanel[]): number        // 0 when empty
export function clampPlacement(p: PanelPlacement, aspect: PanelAspect): PanelPlacement
export function clampGroupDelta(group: PlacedPanel[], dx: number, dy: number): { dx: number; dy: number }
export function readingOrder(placed: PlacedPanel[]): string[]       // by y, then x, then id
```

`share` is `width / STRIP_CSS_WIDTH`.

- [ ] **Step 1: Write the failing tests**

```ts
it('flows unplaced panels as the old strip did', () => {
  const [a, b] = resolveStrip([panel({ aspect: '1:1' }), panel({ aspect: '1:1' })])
  expect(a).toMatchObject({ x: 0, y: 0, width: 440, height: 440, share: 1 })
  expect(b).toMatchObject({ y: 488 })
})
it('shares a beside row and honours the gap', () => {
  const [a, b, c] = resolveStrip([panel({ aspect: '1:1' }), panel({ aspect: '1:1', beside: true, gapAfter: 'tight' }), panel({ aspect: '1:1' })])
  expect(a.width).toBe(217); expect(b.x).toBe(223); expect(c.y).toBe(225)
})
it('an unplaced panel in the middle pushes later placed panels down', () => {
  const [, b, c] = resolveStrip([panel({ aspect: '1:1', placement: { x: 0, y: 0, width: 200 } }), panel({ aspect: '1:1' }), panel({ aspect: '1:1', placement: { x: 0, y: 300, width: 200 } })])
  expect(b.y).toBe(248); expect(c.y).toBe(788)
})
it('clamps into the strip', () => {
  expect(clampPlacement({ x: 400, y: -5, width: 100 }, '1:1')).toEqual({ x: 340, y: 0, width: 100 })
  expect(clampPlacement({ x: 0, y: 0, width: 10 }, '1:1').width).toBe(80)
  expect(clampPlacement({ x: 0, y: 0, width: 900 }, '1:1').width).toBe(440)
})
it('keeps a group rigid at the edge', () => { /* panels at x 0 and x 100, dx -50 returns dx 0 */ })
it('reads top to bottom, then left to right', () => { /* ... */ })
it('a panel saved before placements resolves as flow', () => {
  expect(PanelSchema.parse(legacyPanelJson).placement).toBeNull()
})
```

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run src/shared/strip-canvas.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Build on `layoutStrip` for row grouping and slants. Keep `rowShares` semantics. Walk rows in order holding a `cursor` (lowest bottom so far plus the previous row's gap) and a `shift` (sum of unplaced row heights plus gaps), added to every later placed panel. A row's flow widths are `rowShares * (440 - 6 * (n - 1))`.

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run src/shared/strip-canvas.test.ts`, then `npm run check`
Expected: PASS.

```bash
git add src
git commit -m "feat: panels can hold a place on the strip"
```

### Task 7: Saving placements

**Files:**
- Modify: `src/main/domain/panel-service.ts:371-375`, `src/main/domain/episode-service.ts`, `src/shared/ipc.ts`, `src/main/ipc/handlers/panels.ts`, `stores/panels-store.ts`, tests beside each

**Interfaces:**
- Consumes: `resolveStrip`, `clampPlacement`, `readingOrder`.
- Produces: `PanelService.place(ctx, episodeId, moves: { panelId: string; placement: PanelPlacement }[]): Promise<void>`. `EpisodeService.setPanelOrder(ctx, episodeId, ids: string[]): Promise<Episode>`. IPC `'panels:place': { req: { projectId: string; episodeId: string; moves: {...}[] }; res: void }`. `usePanelsStore.placePanels(episodeId, moves): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

`first move freezes every unplaced panel`: three flow panels, move one; all three have non-null placement and the unmoved two keep their resolved rectangles. `a move keeps a pushed-down panel where it was drawn`: placed A, an unplaced B inserted after it, placed C pushed down by B; then move A sideways, and assert that C's stored `y` is its resolved 788 and that no two resolved rectangles intersect. `rewrites episode order to reading order`. `clamps what it stores`. `throws EntityNotFoundError for a panel outside the episode`. `setPanelOrder keeps a panel added meanwhile at the end`.

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run src/main/domain/panel-service.test.ts src/main/domain/episode-service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Resolve the episode first. Every panel whose resolved rectangle differs from its stored placement is written with the resolved one, not only the unplaced ones, and the moves are applied on top. Each panel is re-read and written under its own lock, one at a time. Then `setPanelOrder` runs under the episode lock with no panel lock held. Emit `panel.changed` per written panel.

- [ ] **Step 4: Verify and commit**

Run: `npm run check`
Expected: PASS.

```bash
git add src
git commit -m "feat: save where panels sit and read them in that order"
```

### Task 8: The strip canvas and selection

**Files:**
- Create: `visualizer/StripCanvas.tsx` and test, `SelectionBar.tsx` and test
- Delete: `InsertPanelButton.tsx` and test
- Modify: `visualizer/WebtoonStrip.tsx` and test (export drawing only until Task 14: remove its `+` and selection), `visualizer/PanelCard.tsx`, `PanelArt.tsx`, `WebtoonPane.tsx`, `stores/app-store.ts:174`, `stores/panels-store.ts:153,189`, `App.tsx`, `panel-editor/PanelWorkspace.tsx:26-30,124`, `styles.css:2254,2310-2340`

**Interfaces:**
- Consumes: `resolveStrip`, `contentBottom`.
- Produces: `StripCanvas({ episodeId, panels, mode?: 'edit' | 'export', lettering?, background? })`. AppData adds `selectedPanelIds: string[]`, `shiftSelecting: boolean`, `focusedPanelId: string | null`; `selectedPanelId` remains the last selected. Actions: `selectPanel(id | null)`, `togglePanelSelection(id)`, `focusPanel(id | null)`. `App` passes `PanelWorkspace` as the overlay when `focusedPanelId` is set. `PanelArt`'s `lettering={false}` hides dialogue in both modes.

- [ ] **Step 1: Write the failing tests**

```ts
it('a plain click replaces the selection', () => { /* selectPanel('a'), selectPanel('b'): ids ['b'], shiftSelecting false */ })
it('shift adds the selected panel and the clicked one', () => {
  s.selectPanel('a'); s.togglePanelSelection('b')
  expect(state().selectedPanelIds).toEqual(['a', 'b']); expect(state().shiftSelecting).toBe(true)
})
it('shift on a selected panel takes it out', () => { /* ... */ })
```

`StripCanvas.test.tsx`: `places each card at its resolved position` (`style.left`, `style.top`, `style.width`); `its height runs 1600 past the lowest panel`; `shift-click selects, click replaces`; `a click does not open the editor, a double-click does` (`focusedPanelId`); `Add panel button keeps testid add-panel`. `SelectionBar.test.tsx`: `says Generate from 2 panels`; `says Generate from 1 panel`; `counts only panels with a ready image`; `is absent without a shift selection`; `says the selected panels have no image when none do` (`Selected panels have no image yet`).

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run src/renderer/src/components/visualizer src/renderer/src/stores`
Expected: FAIL.

- [ ] **Step 3: Implement**

`.strip-canvas` is `position: relative`, `width: 440px`, `container-type: inline-size`, centred on a neutral pane. Cards are `position: absolute`, with `--share` set from `share`. The row and gap CSS stays until Task 14, because export still draws rows. Remove the panel toolbar's Beside, Move up and Move down. With them, remove `panels:move`, `PanelService.move`, `EpisodeService.movePanel` and the store's `movePanel`. `add-panel` is a button in the episode bar and below the last panel; until Task 17 it keeps today's blank-panel call and then calls `focusPanel`, so the flows after it still reach the editor. A click on empty strip clears the selection.

- [ ] **Step 4: Verify and commit**

Run: `npm run check`
Expected: PASS.

```bash
git add src
git commit -m "feat: draw the strip as free-standing panels with a selection"
```

### Task 9: Move, resize and group move

**Files:**
- Create: `visualizer/use-strip-drag.ts` and test
- Modify: `visualizer/PanelCard.tsx`, `StripCanvas.tsx`, `styles.css`

**Interfaces:**
- Consumes: `clampGroupDelta`, `clampPlacement`, `placePanels`, `DRAG_THRESHOLD_PX`.
- Produces: `useStripDrag(placed: PlacedPanel[]): { previews: Record<string, PanelPlacement>; bindCard(id): HTMLAttributes<HTMLElement>; bindResize(id): HTMLAttributes<HTMLElement> }`.

- [ ] **Step 1: Write the failing tests**

`a press under the threshold stays a click` (no `panels:place`); `a drag saves the moved panel`; `dragging a selected panel moves the whole selection by the same delta`; `dragging an unselected panel selects it and moves only it`; `resize keeps the aspect and saves width`; `arrow nudges 1, Shift 10, and saves after 300 ms`; `the preview holds until the save lands, and clears on failure with an error shown`.

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run src/renderer/src/components/visualizer/use-strip-drag`
Expected: FAIL.

- [ ] **Step 3: Implement**

Use pointer capture. Convert client deltas by the canvas's on-screen scale. Shift-click must not start a drag. A completed drag suppresses the click that follows.

- [ ] **Step 4: Verify with a real window**

Update `tests/e2e/panels.spec.ts` for card placement and add `a dragged panel stays where it was put after a relaunch`.
Run: `npm run build`, then `npx playwright test tests/e2e/panels.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat: drag, resize and group-move panels on the strip"
```

### Task 10: Tools on the panel and focus mode

**Files:**
- Create: `visualizer/PanelTools.tsx` and test
- Modify: `panel-editor/PanelWorkspace.tsx`, `SceneTab.tsx:23-25,145,161-170`, `PanelInspector.tsx:85-86`, `PanelStage.tsx`, `SketchStage.tsx`, `use-field-autosave.ts`, `src/shared/schemas.ts:361`, `src/main/domain/panel-service.ts:129,182`, `src/main/agent/tools/panel-tools.ts:59-61,114-116`, `panel-chat-tools.ts:27-29`, `src/main/agent/system-prompt.ts:90-93`, `resources/agent-docs/{AGENTS.md,reference/webtoon-style-guide.md,workflows/panel-editing.md,workflows/panel-generation.md,workflows/story-direction.md}`, `tests/e2e/panel-editing.spec.ts`, `tests/e2e/panel-chat.spec.ts`

**Interfaces:**
- Produces: `PanelTools({ panel })`, rendered by `PanelCard` when exactly one panel is selected. Contains Lines, Cast, Items, Scene (each opening `PanelInspector` on that tab in a popover), Versions (`VersionSwitcher`), Upload image, Redraw, Sketch, Focus (aria-label `Focus`), Delete. Add bubble arrives in Task 11. `PanelInspector` gains `initialTab?: Tab`. `focusPanel(id, opts?: { sketch?: boolean })` opens focus mode on the sketch canvas, the one tool that needs the larger stage.

- [ ] **Step 1: Write the failing tests**

`PanelTools.test.tsx`: `Redraw starts a generation`; `Scene opens the panel's scene fields in place`; `Focus opens focus mode`; `Delete asks first`; `Lines edits a line in place`; `Upload image stores a new version without opening focus mode`; `Versions switches the current image in place`; `Sketch opens focus mode on the canvas`. `PanelWorkspace.test.tsx`: `is named Focus mode` (`getByRole('region', { name: 'Focus mode' })`); `the back button says Back to the strip and clears focus only, leaving the selection`. `SceneTab`: `has no Beside, Gap after or Gutter field`. Panel tool schema: `has no gutter`.

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run src/renderer/src/components/panel-editor src/renderer/src/components/visualizer/PanelTools.test.tsx src/main/agent`
Expected: FAIL.

- [ ] **Step 3: Implement**

`backToStrip` calls `focusPanel(null)`. Rename the workspace's accessible name from `Panel editor` to `Focus mode`, and "editing mode" to "focus mode" in code comments and `resources/agent-docs/`. Stage background is the neutral surface, since `gutter` is gone. Delete `gutter` from `PanelDraftSchema` and `PanelPatchSchema` (`PanelSchema` keeps it). Delete the `gutter` lines from the agent docs, and change "move and delete are on each panel's toolbar" to "drag a panel on the strip to move it; delete is in its tools".

- [ ] **Step 4: Verify and commit**

Run: `npm run check`, then `npm run build` and `npx playwright test tests/e2e/panel-editing.spec.ts tests/e2e/panel-chat.spec.ts`
Expected: PASS. A rare injected drag miss in `panel-editing.spec.ts` is a known flake: rerun before calling it a regression.

```bash
git add src tests resources
git commit -m "feat: edit a panel where it sits; the full editor becomes focus mode"
```

### Task 11: Free bubbles

**Files:**
- Create: `visualizer/StripBubbles.tsx` and test
- Modify: `src/shared/schemas.ts:235`, `schemas.test.ts`, `panel-editor/bubble-placement.ts:28-61`, its test, `panel-editor/use-bubble-editing.ts:63,106-109`, `visualizer/StripCanvas.tsx`, `visualizer/PanelCard.tsx`, `styles.css`

**Interfaces:**
- Produces: `BubblePlacementSchema` is `{ x: finite, y: finite }`. `placementFromPointer` and `nudgePlacement` take an optional `bounds?: Box`; given, the bubble stays inside `bounds` horizontally and below its top, and may leave the panel; absent, today's clamp to the panel applies. `useBubbleEditing(panel, stageRef, bounds?: () => Box | null)`. `StripBubbles({ placed, canvas, mode })`.

- [ ] **Step 1: Write the failing tests**

```ts
it('with bounds a bubble can leave its panel', () => {
  const p = placementFromPointer({ pointer: { x: 100, y: 900 }, grab: { dx: 0, dy: 0 }, panel: box(0, 0, 200, 200), bubble: { width: 40, height: 20 }, bounds: box(0, 0, 440, 5000) })
  expect(p).toEqual({ x: 0.5, y: 4.5 })
})
it('with bounds it stays inside the strip', () => { /* pointer x 900 clamps so the bubble's right edge is 440 */ })
it('without bounds it stays inside the panel', () => { /* existing test unchanged */ })
```

`StripBubbles.test.tsx`: `draws a placed bubble below its panel`; `a bubble can be pressed on a panel that is not selected`; `the empty layer lets clicks through to the panel`; `pressing a bubble does not start a panel drag`; `double-clicking a bubble retypes it on the strip`; `selecting a bubble opens its text and style controls in the panel's tools`; `Add bubble adds a line on the strip`.

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run src/renderer/src/components/panel-editor/bubble-placement.test.ts src/renderer/src/components/visualizer/StripBubbles`
Expected: FAIL.

- [ ] **Step 3: Implement**

Each panel gets an absolutely positioned wrapper at its rectangle holding a transparent `.panel-media` (`overflow: visible`) and a `DialogueOverlay` with `useBubbleEditing`'s `editing`. Wrapper and overlay are `pointer-events: none`; `.bubble` and its handles are `auto`. Render all wrappers after all cards so bubbles sit on top. `PanelCard` draws `PanelArt` with `lettering={false}`. `PanelTools` is now rendered by `StripBubbles`, whose hook supplies new props `add` and `adding` for an `AddBubbleMenu` in the tools, and `selectedLine` and `onSelectLine`, so selecting a bubble selects its panel and opens Lines on that line.

- [ ] **Step 4: Verify and commit**

Run: `npm run check`, then `npm run build` and `npx playwright test tests/e2e/panel-editing.spec.ts`
Expected: PASS.

```bash
git add src tests
git commit -m "feat: bubbles move anywhere on the strip"
```

---

## Phase 3: Background

### Task 12: Background model and storage

**Files:**
- Create: `src/shared/strip-background.ts` and test
- Modify: `src/shared/schemas.ts` (move `HexColor` above `EpisodeSchema`), `types.ts`, `ipc.ts`, `src/main/domain/episode-service.ts`, `src/main/ipc/handlers/panels.ts`, `stores/panels-store.ts`, `visualizer/StripCanvas.tsx`

**Interfaces:**
- Consumes: `PlacedPanel`, `contentBottom`.
- Produces:

```ts
StripBackgroundSchema // discriminated on kind: solid{color} | linear{stops,angle,repeatEvery} | radial{stops,repeatEvery} | conic{stops,angle,repeatEvery} | image{path,fit:'width'|'tile'|'stretch',opacity,color}
export function stripBackgroundStyle(bg: StripBackground, at: { imageUrl: string | null; bottom: number }): Record<string, string>
export function legacyBackground(placed: PlacedPanel[]): StripBackground
export function effectiveBackground(stored: StripBackground | null, placed: PlacedPanel[]): StripBackground
```

`EpisodeService.setBackground(ctx, id, bg: StripBackground | null)`; `EpisodeService.storeBackgroundImage(ctx, id, data: Buffer, ext: UploadExt)`. IPC `'episodes:setBackground'` returns `Episode`; `'episodes:pickBackgroundImage'` returns `Episode | null`. `usePanelsStore.setBackground`, `pickBackgroundImage`.

- [ ] **Step 1: Write the failing tests**

```ts
it('draws a linear gradient over the whole content', () => {
  expect(stripBackgroundStyle({ kind: 'linear', angle: 180, repeatEvery: null, stops: [{ color: '#000000', at: 0 }, { color: '#ffffff', at: 1 }] }, { imageUrl: null, bottom: 1000 })).toEqual({
    backgroundColor: '#ffffff',
    backgroundImage: 'linear-gradient(180deg, #000000 0%, #ffffff 100%)',
    backgroundSize: '100% 1000px',
    backgroundRepeat: 'no-repeat'
  })
})
it('repeats a gradient when asked', () => { /* repeatEvery 400: size '100% 400px', repeat 'repeat-y' */ })
it('tints an image by its opacity', () => {
  expect(stripBackgroundStyle({ kind: 'image', path: 'x', fit: 'width', opacity: 0.5, color: '#112233' }, { imageUrl: 'asset://x', bottom: 900 }).backgroundImage).toBe('linear-gradient(#11223380, #11223380), url("asset://x")')
})
it('an old all-white episode stays white', () => { /* solid #ffffff */ })
it('an old episode keeps its black bands', () => {
  /* a 1:1 white row, then a 1:1 black row: linear, angle 180, a hard stop at 488 / 928 */
})
```

Service: `refuses an image path it did not store`; `a new image removes the old file`; `an episode saved without a background reads null`.

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run src/shared/strip-background.test.ts src/main/domain/episode-service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Images live at `episode-backgrounds/<episodeId>/<random>.<ext>`, written with `writeFileAtomic` outside the lock and recorded under it, following `panel-images.ts`. `setBackground` rejects `kind: 'image'` when `path` differs from the stored one. `bottom` is always `contentBottom(resolveStrip(allPanels))`. Fits: `width` is `100% auto`, `repeat-y`; `tile` is `auto`, `repeat`; `stretch` is `100% ${bottom}px`, `no-repeat`.

- [ ] **Step 4: Verify and commit**

Run: `npm run check`
Expected: PASS.

```bash
git add src
git commit -m "feat: an episode has a colour, gradient or image background"
```

### Task 13: Background editor

**Files:**
- Create: `visualizer/BackgroundEditor.tsx` and test, `visualizer/background-presets.ts`
- Modify: `visualizer/EpisodeBar.tsx`, `styles.css`

**Interfaces:**
- Consumes: `setBackground`, `pickBackgroundImage`, `effectiveBackground`.
- Produces: `BackgroundEditor({ episode, placed, onClose })`, opened by an EpisodeBar button named `Background` (testid `background-open`).

- [ ] **Step 1: Write the failing tests**

`picks any colour by hex` (typing `#12ab9f` saves it); `refuses a malformed hex with a message` (`Enter a colour as #rrggbb`, nothing saved); `offers Color, Linear, Radial, Conic and Image`; `adds and removes gradient stops but keeps at least two`; `changes the angle`; `sets repeat length`; `applies a preset gradient`; `image upload then fit and opacity`; `saves once 300 ms after the last change`; `the strip shows the change before it saves`.

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run src/renderer/src/components/visualizer/BackgroundEditor`
Expected: FAIL.

- [ ] **Step 3: Implement**

`background-presets.ts` exports `COLOR_PRESETS` (32 hexes) and `GRADIENT_PRESETS` (16 named linear or radial backgrounds). Each stop row has a colour input, a hex field and a 0-100 position slider. Live preview via a local draft passed to `StripCanvas`.

- [ ] **Step 4: Verify and commit**

Run: `npm run check`
Expected: PASS.

```bash
git add src
git commit -m "feat: edit the strip background with colours, gradients and images"
```

---

## Phase 4: Export

### Task 14: Export ends at the last panel

**Files:**
- Delete: `visualizer/WebtoonStrip.tsx` and test
- Modify: `src/shared/strip-canvas.ts` and test, `src/shared/strip-layout.ts` (remove `exportRows`), `components/export/ExportView.tsx` and test, `components/export/measure.ts`, `src/renderer/src/styles.css:2008-2060` (the row and gap rules), `src/renderer/src/export.css`, `src/main/export/export-service.test.ts`, `tests/e2e/export.spec.ts`

**Interfaces:**
- Consumes: `resolveStrip`, `stripBackgroundStyle`, `StripCanvas` `mode="export"`.
- Produces: `exportStrip(panels: Panel[]): { placed: PlacedPanel[]; bottom: number; contentBottom: number }`: positions from all panels, `placed` only finished ones, `bottom` the lowest finished panel's bottom.

- [ ] **Step 1: Write the failing tests**

```ts
it('ends at the lowest finished panel', () => {
  const { placed, bottom } = exportStrip([finished({ aspect: '1:1', placement: { x: 0, y: 500, width: 100 } }), finished({ aspect: '1:1', placement: { x: 0, y: 0, width: 200 } }), unfinished({ aspect: '1:1', placement: { x: 0, y: 900, width: 200 } })])
  expect(bottom).toBe(600); expect(placed).toHaveLength(2)
})
```

`ExportView.test.tsx`: `sizes the strip to the last panel and hides what is below` (height `600px`, `overflow: hidden`); `paints the episode background`; `a bubble placed below the last panel is cut off`; `a gradient spans the on-screen content, not the crop`. Add to `export.spec.ts`: `the image is as tall as the last panel's bottom at 800/440 scale`.

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run src/shared/strip-canvas.test.ts src/renderer/src/components/export`
Expected: FAIL.

- [ ] **Step 3: Implement**

`ExportView` renders `StripCanvas mode="export"` with a canvas height of `bottom`. Drop the band rules and body gutter colour from `export.css` and `ExportView`. Confirm `measure.ts` still reads `#root`'s bottom as the strip's bottom.

- [ ] **Step 4: Verify and commit**

Run: `npm run check`, then `npm run build` and `npx playwright test tests/e2e/export.spec.ts`
Expected: PASS.

```bash
git add src tests
git commit -m "feat: export stops at the last panel"
```

---

## Phase 5: Generate page

### Task 15: References, style and prompt on a panel

**Files:**
- Modify: `src/shared/schemas.ts:307-369`, `src/main/domain/prompts.ts`, `src/main/domain/panel-service.ts:118-141,173-189,220-316`, `src/main/domain/prompts.test.ts`, `panel-service.test.ts`, `resources/agent-docs/reference/prompt-templates.md`, `panel-editor/SceneTab.tsx`

**Interfaces:**
- Produces: `Panel.referencePanelIds`, `styleOverride`, `promptOverride`, optional on draft and patch. `PanelPromptInput.referencePanels?: { panelId: string; imagePath: string }[]`. `ReferenceSubject` gains `{ kind: 'panel'; id: string }`. `PanelService.readReferencePanels(ctx, panel): Promise<{ panelId; imagePath }[]>` (private; skips missing or imageless panels).

- [ ] **Step 1: Write the failing tests**

```ts
it('adds the chosen panels after the sketch and before the previous panel', () => {
  const r = composePanelPrompt({ ...base, sketch: 's.png', previous: prev, referencePanels: [{ panelId: 'p1', imagePath: 'a.png' }, { panelId: 'p2', imagePath: 'b.png' }], maxReferences: 8 })
  expect(r.references.map((x) => x.relPath)).toEqual(['s.png', 'a.png', 'b.png', 'prev.png'])
  expect(r.prompt).toContain('[REFERENCE PANELS] Reference images 2 and 3 are panels the user chose: match their characters, art style, palette and setting. Never copy their composition.')
})
it('over the cap the previous panel goes first, then chosen panels from the end', () => { /* ... */ })
it('says nothing when no chosen panel was sent', () => { /* no [REFERENCE PANELS] */ })
```

`PanelService`: `a panel style replaces the project's in [STYLE]`; `a custom prompt is sent instead of the composed one and keeps a [FIX] line`; `the references still go with a custom prompt`; `a chosen panel deleted before drawing is skipped`; `chosen panels are not shown to the checker`. SceneTab: `says the panel uses a custom prompt and clears it` (`This panel uses a custom prompt`, button `Use automatic prompt`).

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run src/main/domain/prompts.test.ts src/main/domain/panel-service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Wording for one image: `[REFERENCE PANELS] Reference image 2 is a panel the user chose: match its characters, art style, palette and setting. Never copy its composition.` Three or more numbers read `2, 3 and 4`. Count chosen panels in `others` for packing. The same `styleOverride ?? meta.stylePreset` applies in `draw` and `editImage`. Update `prompt-templates.md` so the lint test passes.

- [ ] **Step 4: Verify and commit**

Run: `npm run check`
Expected: PASS.

```bash
git add src resources
git commit -m "feat: a panel can draw from chosen panels, its own style and its own prompt"
```

### Task 16: Prompt preview and one-call creation

**Files:**
- Modify: `src/main/domain/panel-service.ts:430-445`, `src/shared/ipc.ts:156`, `src/main/ipc/handlers/panels.ts:71-77`, `stores/panels-store.ts:169`, tests beside them

**Interfaces:**
- Produces: `PanelService.previewPrompt(ctx, draft: PanelDraft, hasSketch: boolean): Promise<PromptPreview>` where `PromptPreview = { prompt: string; references: { label: string }[]; droppedPanelIds: string[] }`. IPC `'panels:previewPrompt'`. `'panels:create'` req adds `sketchPng?: string`. `continuityOf` is split so preview can pass an insertion index.

- [ ] **Step 1: Write the failing tests**

`previews without writing anything` (no new files, no `panel.changed`); `lists the chosen panels the model has no room for` (cap 2, three chosen, `droppedPanelIds` has the excess); `uses the panel it will follow for continuity`; `create stores the sketch before drawing` (the first version's `referenceImagePaths` includes the sketch); `create leaves nothing behind when the sketch is refused`.

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run src/main/domain/panel-service.test.ts src/main/ipc/handlers/panels.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Preview uses `composePanelPrompt` with `packing.path` returning a placeholder and `sketch: hasSketch ? 'sketch' : null`. It validates nothing beyond what compose throws on, and reports a compose error as a rejected promise.

- [ ] **Step 4: Verify and commit**

Run: `npm run check`
Expected: PASS.

```bash
git add src
git commit -m "feat: preview a new panel's prompt and create it with its sketch"
```

### Task 17: Generate page shell and library

**Files:**
- Create: `stores/generate-store.ts` and test, `components/generate/GeneratePage.tsx` and test, `LibraryColumn.tsx` and test, `ReferenceRow.tsx`, `generate-draft.ts` and test
- Modify: `App.tsx`, `visualizer/SelectionBar.tsx`, `visualizer/StripCanvas.tsx`, `visualizer/EpisodeBar.tsx`, `styles.css`, `tests/e2e/helpers.ts`, `tests/e2e/panels.spec.ts`, `tests/e2e/panel-editing.spec.ts`

**Interfaces:**
- Consumes: `panels:create` with `sketchPng`.
- Produces:

```ts
interface GenerateRequest { episodeId: string; referencePanelIds: string[]; afterPanelId?: string }
interface GenerateDraft { description: string; setting: string; shot: Panel['shot']; aspect: PanelAspect; location: PanelLocation | null; characters: PanelCharacter[]; items: PanelItem[]; styleOverride: string | null; promptOverride: string | null; sketchPng: string | null }
useGenerateStore: { request; draft; open(req); close(); patch(p: Partial<GenerateDraft>); toggleCharacter(c: Character); toggleItem(i: Item); removeReference(id); isDirty(); submit(draw: boolean): Promise<void> }
```

`App` renders `GeneratePage` instead of the workspace while `request !== null`. `helpers.ts` gains `addBlankPanel(page)` (`add-panel`, then testid `generate-blank`).

- [ ] **Step 1: Write the failing tests**

`GeneratePage.test.tsx`: `shows no AI chat` (`queryByTestId('composer-input')` null, `queryByTestId('pane-chat')` null); `shows every character, item and location` (tile per non-archived entry, testids `library-character`, `library-item`, `library-location`); `selecting a character uses a ready variation and shows the variation picker`; `selecting a location uses its base state and main camera`; `shows the chosen panels and lets one be removed`; `Generate needs a description or a custom prompt`; `Generate creates and draws the panel after the last chosen one, closes, and selects it`; `Add blank panel creates without drawing`; `a refused create keeps the page and says why`; `Back with work asks first` (`Discard this panel?`); `Back with nothing asks nothing`. `SelectionBar`: `Generate opens the page with the ready panels, in strip order`. `add-panel` opens the page with no references.

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run src/renderer/src/components/generate src/renderer/src/stores/generate-store.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Header: Back, `Generate panel`, `Add blank panel` (testid `generate-blank`), `Generate` (testid `generate-submit`). Three columns. A panel's `afterPanelId` is the last chosen panel in episode order. New panels default to shot `medium` and the project's `defaultAspect`. Rosters come from the existing character, item and location stores; load them on open.

- [ ] **Step 4: Update e2e flows**

Specs that made blank panels with `add-panel` use `addBlankPanel`.

- [ ] **Step 5: Verify and commit**

Run: `npm run check`, then `npm run build` and `npx playwright test tests/e2e/panels.spec.ts tests/e2e/panel-editing.spec.ts`
Expected: PASS.

```bash
git add src tests
git commit -m "feat: a Generate page to choose the cast, items and location of a new panel"
```

### Task 18: Drawing on the Generate page

**Files:**
- Create: `components/generate/GenerateSketch.tsx` and test
- Modify: `panel-editor/use-sketch-pad.ts`, `panel-editor/SketchStage.tsx:13-25,66-70`, `sketch.test.ts`

**Interfaces:**
- Produces: `useSketchCanvas({ aspect, initialPng, onChange(png: string | null) }): SketchPad`, the persistence-free part. `useSketchPad(panel)` wraps it, keeping today's `queueSketchSave`. `SKETCH_TOOLS` and `SKETCH_SIZES` are exported from `SketchStage` for reuse (or a `SketchToolbar` component).

- [ ] **Step 1: Write the failing tests**

`GenerateSketch.test.tsx`: `drawing stores the sketch in the draft`; `New sketch clears it`; `offers pen, eraser, line, rectangle, ellipse, sizes and undo`; `changing the aspect keeps the ink, rescaled`. Existing `sketch.test.ts` and `use-stage-pan` tests stay green.

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run src/renderer/src/components/generate/GenerateSketch`
Expected: FAIL.

- [ ] **Step 3: Implement**

Move everything but `readSketch` and `queueSketchSave` into `useSketchCanvas`. On an aspect change, draw the old ink scaled into the new canvas size.

- [ ] **Step 4: Verify and commit**

Run: `npm run check`
Expected: PASS.

```bash
git add src
git commit -m "feat: draw a reference on the Generate page"
```

### Task 19: Prompt and style for the new panel

**Files:**
- Create: `components/generate/PromptColumn.tsx` and test
- Modify: `components/generate/GeneratePage.tsx`, `styles.css`

**Interfaces:**
- Consumes: `panels:previewPrompt`, `styles:list`, `GenerateDraft`.
- Produces: `PromptColumn()`.

- [ ] **Step 1: Write the failing tests**

`the prompt follows the selections until edited` (preview text fills the box; after a debounce of 300 ms a new cast refreshes it); `an edit is kept when selections change, with a notice` (`Your selections changed. Reset to automatic to renumber the references.`); `Reset to automatic clears the edit`; `a late preview never overwrites a newer one`; `style defaults to Project style` (null override); `choosing a library style stores its words`; `typed style text is kept`; `says how many chosen panels will not be sent` (`2 chosen panels won't be sent: this image model takes fewer references.`); `a preview failure shows its reason and Generate still works`.

- [ ] **Step 2: Run to confirm they fail**

Run: `npx vitest run src/renderer/src/components/generate/PromptColumn`
Expected: FAIL.

- [ ] **Step 3: Implement**

Fields: Description, Setting, Shot, Aspect, Style (select of `Project style`, each library style, `Custom`, plus a textarea for Custom), Prompt. Use a request counter to discard stale previews.

- [ ] **Step 4: Verify and commit**

Run: `npm run check`
Expected: PASS.

```bash
git add src
git commit -m "feat: tweak the prompt and style of a new panel"
```

### Task 20: End to end and documentation

**Files:**
- Modify: `tests/e2e/full-flow.spec.ts`, `tests/e2e/helpers.ts`, `README.md`, `AGENTS.md` (this repo's, if a rule changed), `resources/agent-docs/AGENTS.md`, any remaining e2e spec using removed UI
- Create: `tests/e2e/free-strip.spec.ts`

- [ ] **Step 1: Write the e2e flow**

`free-strip.spec.ts`, using `WEBTOON_MOCK_SCRIPT`: from the home page create a project and session, have the mock draw two panels, drag a panel, drag a bubble off its panel, set a gradient, shift-click both panels, click `Generate from 2 panels`, confirm no chat is on the page, select a character, draw on the sketch, edit the prompt, generate, see a third panel selected on the strip, export, and assert the output height equals the last panel's bottom scaled by 800/440. Relaunch and confirm the home page shows, then that positions and background persist.

- [ ] **Step 2: Run it**

Run: `npm run build`, then `npx playwright test tests/e2e/free-strip.spec.ts`
Expected: PASS.

- [ ] **Step 3: Update the docs**

`README.md`: home page, File menu, strip, Generate page, background, no story modes. `resources/agent-docs/AGENTS.md`: where the user finds these, and that a new panel the agent draws lands below or after the panel named without disturbing the user's arrangement.

- [ ] **Step 4: Run everything**

Run: `npm run check`, then `npm run test:e2e`
Expected: all pass except the known `docs.spec.ts` count failure if it still applies. Confirm the agent doc count and update that spec if this work changes the number of docs.

- [ ] **Step 5: Commit**

```bash
git add src tests resources README.md AGENTS.md
git commit -m "test: the free strip end to end, and document it"
```
