# Panel Editing Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a panel opens an editing mode over the sheet. The panel is lettered and editable on the left (retype a bubble, drag it anywhere, add and remove lines, cast and items), and the panel's AI chat is on the right. Every change saves on its own.

**Architecture:** Dialogue lines gain an optional `placement` (a fraction-based centre), and image versions record the visual fields they were drawn from. `PanelService.update` lets a patched line inherit its placement, so agent rewrites keep it. In the renderer, `selectedPanelId !== null` now means editing mode. `PanelWorkspace` is an overlay inside `.sheet`, and the panes stay mounted under it. It holds a `PanelStage` (the card's own art, scaled from a 560px reference row), tabs built on the existing pickers, and the moved `PanelThread`. Pure modules do the pointer math, the dialogue patches and the stale-image check, so jsdom tests can reach them.

**Tech Stack:** TypeScript 7, zod 4, React 19 + zustand, react-resizable-panels 4, lucide-react, vitest + Testing Library + user-event, Playwright `_electron`, plain CSS (container queries, transforms).

**Spec:** `docs/superpowers/specs/2026-11-03-panel-editing-design.md`

## Global Constraints

- Branch `feat/panel-editing`, cut from `feat/panel-shapes` at `6bac74f`. Never commit to `main`.
- Schemas, verbatim:
  - `BubblePlacementSchema = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })`.
  - `DialogueLineSchema.placement`: `.nullable().default(null)`.
  - `DialogueDraftSchema.placement`: `.nullable().optional()`, with **no default**.
  - `PanelVersionSchema.drawnFrom`: `VisualFieldsSchema.nullable().default(null)`.
- Visual fields, in this order: `description, setting, shot, aspect, characters, items`. Labels: `Description, Setting, Shot, Aspect, Cast, Items`.
- Constants:
  - `STAGE_ROW_PX = 560`
  - `AUTOSAVE_MS = 600`
  - `DRAG_THRESHOLD_PX = 3`
  - `NUDGE = 0.01`
  - `NUDGE_BIG = 0.05`
  - `NUDGE_COMMIT_MS = 300`
  - stage max height `62vh`
  - columns 64% (min 40%) and 36% (min 26%)
- Copy, verbatim:
  - Back button: `Strip` (aria-label `Back to the strip`)
  - title: `Panel {n} of {m}`
  - tabs: `Lines`, `Cast`, `Items`, `Scene`
  - chat header: `Panel chat`
  - stale notice: `{Fields} changed since this image was drawn.`, with a `Regenerate` text button
  - empty Lines: `No lines yet. Double-click the panel to place one.`
  - conflict: `This line changed while you were editing it.`
  - undo: `Undo my change`
  - reset: `Reset to auto`
  - gone panel: `Panel not in the current episode`
  - agent placement doc line: as spec §7.
- Look: take tokens from `styles.css` only, and add no colours.
  - The accent goes only on the selected bubble (2px outline, 3px offset) and the active tab.
  - Use a 1px `--border` or a tone step, never both. A shadow (`--float-shadow`) goes only on a bubble while it is dragged.
  - Icons are lucide outlines at 15–16px in `--muted`. Never put an icon in a tinted box.
  - Reuse the `.tab-bar` look for the tabs, and `--pill-warning-*` for the stale notice.
  - Regenerate is the only filled button (`--primary`).
- Layout-only, dialogue and placement changes never start a redraw.
- Rulings (not in the spec; each costs a small follow-up if wrong):
  - **R1.** While editing, the main chat is covered. The user leaves with Back to use it.
  - **R2.** If the open panel disappears from the loaded episode (the agent or another window deleted it), the workspace keeps its frame. It shows `Panel not in the current episode` and the Back button. It does not close by itself.
  - **R3.** ‹ › step through the open episode in strip order, and are disabled at the ends.
  - **R4.** Back focuses the card the user left from (`[data-panel-id]`).
- Comments and naming match the surrounding code: plain sentences, the existing section banners only.
- Tests: `npx vitest run <path>`. Type-check: `npm run typecheck`. E2E: `npm run test:e2e -- <spec>`. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **An agent rewrite wipes the user's placements.** The agent sends the whole dialogue array without `placement`. Expected: each line keeps the stored placement at its index. → Task 1 service test, and Task 2 tool test through `update_panel_fields`.
2. **A drag or text commit lands on the wrong line, or reverts the agent.** Line ids change on every save, and the agent can edit while the user drags. Expected: the patch is built from the store at send time; if the indexed line changed, nothing is sent and the conflict copy shows. → Task 6 test.
3. **The last keystroke is lost on Back.** The user types in Scene or Lines and clicks Back inside 600ms. Expected: the pending value is saved on unmount. → Task 7 test.
4. **Esc while typing leaves the editor.** Expected: Esc in a bubble's textarea cancels the text edit, and Esc in any input does nothing to the mode. Esc on the bare stage first clears the bubble selection, and only a second Esc goes back. → Task 6 test (stage) and Task 5 test (workspace).
5. **The open panel is deleted under the editor.** Expected (R2): the frame stays, the placeholder and Back show, and no save is attempted. → Task 5 test.

---

### Task 1: Placement, drawn-from fields, inheritance

**Files:**
- Modify: `src/shared/schemas.ts` (add `BubblePlacementSchema` and `VisualFieldsSchema` before `PanelVersionSchema`; `DialogueLineSchema`, `DialogueDraftSchema`, `PanelVersionSchema`), `src/shared/types.ts`
- Create: `src/shared/visual-fields.ts`, `src/shared/visual-fields.test.ts`
- Modify: `src/main/domain/panel-service.ts` (`create`, `update`, `record`/attempt, `uploadImage`)
- Modify: `src/renderer/src/components/visualizer/PanelEditorDialog.tsx`, `DialogueEditor.tsx` (new lines carry `placement: null`). `normalize` keeps `placement`.
- Test: `src/shared/schemas.test.ts`, `src/main/domain/panel-service.test.ts`

**Interfaces:**
- Produces:
  - `BubblePlacement`, `VisualFields`, `VisualField = keyof VisualFields`.
  - `DialogueLine.placement: BubblePlacement | null`, and `DialogueDraft.placement?: BubblePlacement | null`.
  - `PanelVersion.drawnFrom: VisualFields | null`.
- Produces from `@shared/visual-fields`:
  - `VISUAL_FIELDS: readonly VisualField[]`
  - `visualFields(panel: Pick<Panel, VisualField>): VisualFields`
  - `staleVisualFields(panel: Panel): VisualField[]`, in `VISUAL_FIELDS` order. `aspect` is compared via `drawAspect`. Every other field is compared by JSON equality.

- [ ] **Step 1: Write the failing tests**
  - `schemas.test.ts`:
    - A stored line without `placement` parses to `placement: null`.
    - `{ x: 1.2, y: 0 }` is refused.
    - `PanelPatchSchema.parse({ dialogue: [{ speakerId: null, kind: 'narration', text: 'A' }] }).dialogue[0]` has no `placement` key.
    - A stored version without `drawnFrom` parses to `null`.
  - `visual-fields.test.ts`:
    - `[]` with no current version.
    - `[]` when `drawnFrom` is `null`.
    - `['characters', 'items']` after both change.
    - `[]` when `aspect` goes `1:2` → `1:3` (same draw aspect).
    - `['aspect']` for `2:3` → `1:1`.
    - `[]` after only `frame`, `gutter` or `dialogue` change.
  - `panel-service.test.ts`:
    - `update` with lines lacking `placement` keeps the stored placement at each index, and a 4th new line gets `null`.
    - An explicit `placement: null` clears it.
    - `create` stores `null`.
    - `generate`, `editImage` and `uploadImage` record `drawnFrom` equal to `visualFields(panel)`.
    - An `update` of only dialogue adds no version and keeps `currentVersionId`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/shared src/main/domain/panel-service.test.ts`
Expected: FAIL. The new fields are undefined, and `@shared/visual-fields` is not found.

- [ ] **Step 3: Implement the schemas, `visual-fields.ts` and the service changes**

In `update`: `patch.dialogue.map((line, i) => withId({ ...line, placement: line.placement === undefined ? (current.dialogue[i]?.placement ?? null) : line.placement }))`. Set `drawnFrom` on the attempt from the panel read at the start of the attempt. Fix the type errors that follow in the renderer's draft-line code with `placement: null` for new lines.

- [ ] **Step 4: Run the tests and the type-check**

Run: `npx vitest run src/shared src/main/domain && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit** — `feat: store bubble placement and the fields each image was drawn from`

---

### Task 2: The agent sees and keeps placement

**Files:**
- Modify: `src/main/agent/tools/panel-chat-tools.ts` (`fieldsView` dialogue gets `placement`; the `patchInput.dialogue` description appends the spec §7 sentence)
- Modify: `src/main/agent/tools/panel-tools.ts` (the `update_panel` patch and `create_panel` dialogue descriptions get the same sentence; `get_panel` already returns the whole panel)
- Modify: `src/main/agent/system-prompt.ts` (`buildPanelContext` dialogue only: a placed line ends ` @x,y` with two decimals; `panelSummary` is unchanged)
- Modify: `resources/agent-docs/workflows/panel-editing.md` (Purpose: "opened the panel in editing mode"; a placement paragraph in Dialogue-Only Changes; the example `<panel_context>` gets one placed line)
- Test: `src/main/agent/tools/panel-chat-tools.test.ts`, `src/main/agent/system-prompt.test.ts`, the existing `src/main/agent/workflow-docs.lint.test.ts` and `src/main/plugins/claude-code/mcp-tools.test.ts`

**Interfaces:**
- Consumes: Task 1's `DialogueLine.placement` and the inheritance rule.

- [ ] **Step 1: Write the failing tests**
  - `update_panel_fields` with `dialogue: [{ speakerId, kind: 'speech', text: 'New text' }]`, on a panel whose line 0 has `placement {x:0.62,y:0.18}`, returns `fields.dialogue[0].placement` equal to `{ x: 0.62, y: 0.18 }`.
  - `get_panel_context` lists `placement` for every line (`null` for automatic ones).
  - `buildPanelContext` prints `Jin: "Hey" @0.62,0.18` for a placed line, and `Mina: "Hi"` for an automatic one.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/main/agent`
Expected: FAIL. `placement` is missing from `fieldsView`, and the context has no `@`.

- [ ] **Step 3: Implement**, then update the workflow doc so its example and its prose match.

- [ ] **Step 4: Run the agent and plugin suites**

Run: `npx vitest run src/main/agent src/main/plugins`
Expected: PASS, the docs lint included.

- [ ] **Step 5: Commit** — `feat: show bubble placement to the agent and keep it through its edits`

---

### Task 3: Placed bubbles on the strip, and `PanelArt`

**Files:**
- Create: `src/renderer/src/components/visualizer/PanelArt.tsx`. Move it out of `PanelCard.tsx`: the `.panel-media` box, the image, "No image yet", `DialogueOverlay`, and the pending/failed status with Retry.
- Modify: `PanelCard.tsx` (uses `PanelArt`; the article gets class `panel-card panel-shape` and `data-panel-id`), `DialogueOverlay.tsx`, `src/renderer/src/styles.css`
- Create: `src/renderer/src/components/visualizer/DialogueOverlay.test.tsx`
- Test: the existing `PanelCard.test.tsx` and `WebtoonStrip.test.tsx` stay green.

**Interfaces:**
- Produces:
  - `PanelArt({ panel, editing? }: { panel: Panel; editing?: OverlayEditing })`. Retry lives inside it and keeps `stopPropagation`.
  - `DialogueOverlay({ dialogue, cast, editing? })`.
  - The type, exported from `DialogueOverlay.tsx`:

```ts
export interface OverlayEditing {
  selected: number | null
  /** The line whose text is open for typing; its bubble renders `textEditor` instead of its text. */
  textEditing: number | null
  textEditor: ReactNode
  /** Shown instead of the stored placement while a drag or nudge is in progress. */
  preview: { index: number; placement: BubblePlacement } | null
  dragging: number | null
  /** Handlers, tabIndex and aria-label for the bubble of line `index`. */
  bind(index: number): HTMLAttributes<HTMLDivElement>
}
```

- [ ] **Step 1: Write the failing tests** (`DialogueOverlay.test.tsx`)
  - A line with `placement {x:0.25,y:0.75}` renders inside `.dialogue-placed`, with `style.left === '25%'` and `style.top === '75%'`. It is not in `.dialogue-flow`.
  - An unplaced line stays in `.dialogue-flow`. A placed sfx goes to `.dialogue-placed`, not `.dialogue-sfx`.
  - With `editing.selected = 1`, bubble 1 has `data-selected="true"`. With `textEditing = 1`, bubble 1 renders the given `textEditor` node and not its text. With `preview` for index 0, bubble 0 uses the preview's left and top.
  - Without `editing`, no bubble has a tabIndex.

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/renderer/src/components/visualizer`
Expected: the new file FAILs, and the existing tests pass.

- [ ] **Step 3: Implement**
  - In `styles.css`, rename every `.panel-card[data-frame…]` and `.panel-card:is([data-frame…])` frame rule to `.panel-shape`. The hover, toolbar and selection rules stay on `.panel-card`.
  - `.dialogue-placed` is `position:absolute; inset:0`. A placed bubble is `position:absolute; translate:-50% -50%; max-width:62%`.
  - `.dialogue-overlay[data-editing='true'] .bubble { pointer-events:auto; cursor:grab }`.
  - The selected outline and the dragged float follow Global Constraints.

- [ ] **Step 4: Run the renderer tests**

Run: `npx vitest run src/renderer`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat: draw placed bubbles where the user put them`

---

### Task 4: Pointer math and stage fit

**Files:**
- Create: `src/renderer/src/components/panel-editor/bubble-placement.ts`, `bubble-placement.test.ts`

**Interfaces:**
- Produces:
  - `DRAG_THRESHOLD_PX`, `NUDGE`, `NUDGE_BIG`, `NUDGE_COMMIT_MS`, `STAGE_ROW_PX`
  - `type Box = { left: number; top: number; width: number; height: number }`
  - `placementFromPointer(a: { pointer: { x: number; y: number }; grab: { dx: number; dy: number }; panel: Box; bubble: { width: number; height: number } }): BubblePlacement`. `grab` is the pointer's offset from the bubble's centre at press time. The result is clamped so that the bubble lies inside `panel`. If the bubble is wider or taller than the panel, that axis is 0.5.
  - `nudgePlacement(p: BubblePlacement, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown', big: boolean, half: { x: number; y: number }): BubblePlacement`, where `half` is the bubble's half-size as fractions of the panel. It uses the same clamp.
  - `centreOf(bubble: Box, panel: Box): BubblePlacement`, the placement of a bubble where it is drawn now (for an automatic bubble's first drag or nudge).
  - `fitScale(avail: { width: number; height: number }, natural: { width: number; height: number }): number`, which is `min(avail.width / natural.width, avail.height / natural.height)`, and `1` when either natural side is 0.

- [ ] **Step 1: Write the failing tests**
  - Panel `{0,0,400,600}`, bubble `100×50`, pointer `(200,300)`, grab `(0,0)` → `{ x: 0.5, y: 0.5 }`.
  - The same panel at `left 1000, top 200`, scaled to `800×1200`, with pointer `(1400, 800)` → `{ x: 0.5, y: 0.5 }`. This is the transformed-stage case.
  - A pointer at `(0,0)` with that bubble → `{ x: 0.125, y: 50/1200 }`.
  - A bubble `500` wide on a `400` panel → `x: 0.5`.
  - `nudgePlacement({x:0.5,y:0.5}, 'ArrowRight', false, {x:0.1,y:0.1})` → `{ x: 0.51, y: 0.5 }`. With `big` → `0.55`. At `x: 0.89` going right, it clamps to `0.9`.
  - `fitScale({800,600}, {400,600})` → `1`. `fitScale({800,600}, {0,0})` → `1`.

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/renderer/src/components/panel-editor/bubble-placement.test.ts`
Expected: FAIL, the module is not found.

- [ ] **Step 3: Implement**, rounding results to 4 decimals.

- [ ] **Step 4: Run it to see it pass**

Run: the same command. Expected: PASS.

- [ ] **Step 5: Commit** — `feat: pointer and nudge math for placing bubbles`

---

### Task 5: The workspace replaces the side chat

**Files:**
- Create: `src/renderer/src/components/panel-editor/PanelWorkspace.tsx`, `PanelWorkspace.test.tsx`, `stale-notice.ts` (+ test)
- Create: `src/renderer/src/components/panel-chat/PanelThread.tsx`. Move `PanelThread` out of `PanelSideChat.tsx`, and move its thread cases from `PanelSideChat.test.tsx` into `PanelThread.test.tsx`. Then delete `PanelSideChat.tsx` and its test.
- Modify: `src/renderer/src/components/layout/ThreePaneLayout.tsx` (an `overlay?: ReactNode` prop drawn inside `.sheet`; `inert` on `.sheet-panes` while it is set) and its test, `src/renderer/src/App.tsx` (passes `<PanelWorkspace panelId=…/>` when `selectedPanelId !== null`), `src/renderer/src/components/chat/ChatPane.tsx` (the side split goes; the main chat only), `ChatPane.test.tsx`, `src/renderer/src/styles.css` (`.sheet { position: relative }`; workspace, header, notice; the old `.panel-side-chat` and `.side-chat-*` rules go)

**Interfaces:**
- Consumes: Task 1's `staleVisualFields`, and Task 3's `PanelArt` (as a placeholder stage until Task 6).
- Produces:
  - `PanelWorkspace({ panelId }: { panelId: string })`, with `data-testid="panel-workspace"`. Its left column renders `children` slots that Tasks 6 and 7 fill: `<PanelStage panel share />` and `<PanelInspector panel />`, keyed by `panel.id`.
  - `staleNotice(fields: VisualField[]): string | null`.
  - `PanelThread({ projectId, panelId })`, unchanged in behaviour.

- [ ] **Step 1: Write the failing tests**
  - `stale-notice.test.ts`:
    - `['characters']` → `Cast changed since this image was drawn.`
    - `['description', 'characters', 'items']` → `Description, cast and items changed since this image was drawn.`
    - `[]` → `null`.
  - `PanelWorkspace.test.tsx` (fake api, panels from `panel-fixtures`):
    - It shows `Panel 2 of 3` as the h1.
    - It shows the version switcher and the `Panel chat` heading with the thread's composer.
    - "Strip" sets `selectedPanelId` to null. Next (›) selects panel 3, and is disabled on panel 3.
    - Upload calls `uploadPanelImage`. Regenerate calls `generatePanel` and never `updatePanel`.
    - The stale notice shows for a version with a `drawnFrom` whose cast differs, and its Regenerate calls `generatePanel`.
    - Esc on `document.body` goes back. Esc with focus in the composer, or while a `[role="dialog"]` is open, does not (Review Focus 4).
    - Panel removed from `panelsByEpisode` → the frame, `Panel not in the current episode` and Strip show, and `updatePanel` is never called (Review Focus 5).
  - `ThreePaneLayout.test.tsx`: with an `overlay`, `.sheet-panes` has the `inert` attribute and the overlay is inside `.sheet`.
  - `ChatPane.test.tsx`: selecting a panel no longer renders a side chat. Delete the cases that asserted it.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/renderer/src/components`
Expected: the new cases FAIL.

- [ ] **Step 3: Implement**
  - The Esc listener follows the old `PanelSideChat` logic, plus `textarea` and `[contenteditable]` in the ignore list.
  - Back runs `selectPanel(null)`, then focuses `[data-panel-id="<id>"]` on the next frame (R4).
  - Columns use `react-resizable-panels` with the Global Constraints sizes.

- [ ] **Step 4: Run the renderer tests and the type-check**

Run: `npx vitest run src/renderer && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat: open a clicked panel in an editing mode over the sheet, with its chat on the right`

---

### Task 6: Editing bubbles on the stage

**Files:**
- Create: `src/renderer/src/components/panel-editor/PanelStage.tsx`, `use-bubble-editing.ts`, `use-dialogue-saver.ts`, `dialogue-edits.ts` (+ `dialogue-edits.test.ts`), `PanelStage.test.tsx`
- Modify: `PanelWorkspace.tsx` (mount the stage), `styles.css` (`.panel-stage`: the gutter-colour field, centring, the 62vh cap, the transform origin)

**Interfaces:**
- Consumes:
  - `PanelArt` / `OverlayEditing` (Task 3)
  - everything in `bubble-placement.ts` (Task 4)
  - `rowShares(layoutStrip(panels))` from `strip-layout.ts` for `share`
  - `usePanelsStore.getState().updatePanel`
- Produces:
  - `type LineIdentity = Pick<DialogueLine, 'speakerId' | 'kind' | 'text'>`
  - `toDrafts(lines: DialogueLine[]): DialogueDraftLine[]`, which keeps placement.
  - `editLine(current: DialogueLine[], index: number, expect: LineIdentity, change: Partial<DialogueDraftLine>): DialogueDraftLine[] | null`. It returns `null` when `current[index]` does not match `expect`.
  - `removeLine(current, index, expect): DialogueDraftLine[] | null`
  - `appendLine(current, line: DialogueDraftLine): DialogueDraftLine[]`
  - `useDialogueSaver(panelId: string): { save(build: (current: DialogueLine[]) => DialogueDraftLine[] | null): Promise<void>; conflict: boolean; error: string | null }`. It reads the panel from `usePanelsStore` at call time and sets `conflict` when `build` returns `null`.
  - `useBubbleEditing(panel: Panel, stageRef: RefObject<HTMLElement>): { editing: OverlayEditing; selected: number | null; select(i: number | null): void }`. The selected index goes up to the workspace, so the Lines tab can follow it (Task 7).
  - `PanelStage({ panel, share, onSelectLine }: { panel: Panel; share: number; onSelectLine(i: number | null): void })`.

- [ ] **Step 1: Write the failing tests**
  - `dialogue-edits.test.ts`: `editLine` keeps the other lines' placements and returns `null` on a text mismatch. `removeLine` drops exactly the index.
  - `PanelStage.test.tsx`: mock `getBoundingClientRect` for the stage overlay (`0,0,400,600`) and for each bubble (`100×50`).
    - Click a bubble → `onSelectLine(0)` and `data-selected`.
    - Pointer down, move 2px, up → no `updatePanel`. Down, move to `(300,150)`, up → `updatePanel(panelId, { dialogue })` where line 0 has `placement {x:0.75,y:0.25}` and line 1 is unchanged.
    - ArrowRight on a selected placed bubble, then 300ms (fake timers) → one save with `x + 0.01`.
    - Double-click → textarea. Type `Run!` and Enter → saves the text. Esc in the textarea → no save, and the editor stays open (Review Focus 4). Empty text with Enter → no save.
    - Delete on a selected bubble → saves without it.
    - Double-click the empty overlay at `(200,300)` → a textarea at `{0.5,0.5}`. Typing `Hey` and Enter saves an appended `speech` line from the first cast member, with that placement.
    - **Review Focus 2:** grab a bubble, replace the store's panel so line 0's text differs, release → no `updatePanel`, and `conflict` is true.
    - Esc on the stage with a bubble selected clears the selection and calls `preventDefault`. Selecting a bubble never calls `selectPanel`.
    - **No AI** (spec §5): after a test that selects, drags, nudges, retypes, adds and deletes, the fake api's recorded channels contain only `panels:update` and the loads that follow it. There is no `panelChat:*`, no `agent:*`, no `panels:generate`, no `panels:editImage` and no `panels:upload*`.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/renderer/src/components/panel-editor`
Expected: the new files FAIL.

- [ ] **Step 3: Implement**
  - Lay the stage out as a `container-type: inline-size` box that is `STAGE_ROW_PX` wide. Inside it put a `.panel-shape` of width `share × STAGE_ROW_PX`, and carry `--share` and the frame and slant attributes.
  - Scale it with `fitScale` from a `ResizeObserver` on the stage's slot.
  - Use pointer capture for drags.
  - Keep the text editor's textarea at the bubble's font (`font: inherit; text-transform: inherit; text-align: center`). It auto-grows by rows.

- [ ] **Step 4: Run the renderer tests**

Run: `npx vitest run src/renderer`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat: select, retype, drag, nudge, add and delete bubbles on the panel`

---

### Task 7: Lines, Cast, Items and Scene tabs, autosaved

**Files:**
- Create: `src/renderer/src/components/panel-editor/PanelInspector.tsx`, `LinesTab.tsx`, `SceneTab.tsx`, `use-field-autosave.ts`, `PanelInspector.test.tsx`
- Modify: `PanelWorkspace.tsx` (mount the inspector and pass the stage's selected line), `styles.css`
- Modify: `src/renderer/src/components/visualizer/PanelCard.tsx` (the pencil and `onEdit` go), `WebtoonStrip.tsx` (the edit dialog and `editingId` go), `PanelEditorDialog.tsx` (create only: drop `mode` and `panel`, `changes()` and the edit buttons), and their tests (delete the edit-mode cases)

**Interfaces:**
- Consumes: `CastPicker`, `ItemPicker`, `useRoster`, `useItemRoster`, `Field`, `errorText`, and Task 6's `useDialogueSaver`, `editLine`, `removeLine`, `appendLine`.
- Produces:
  - `type AutosaveField = 'description' | 'setting' | 'shot' | 'aspect' | 'frame' | 'beside' | 'gapAfter' | 'gutter' | 'characters' | 'items'`
  - `useFieldAutosave<K extends AutosaveField>(panel: Panel, field: K): { value: Panel[K]; set(v: Panel[K]): void; flush(): void; error: string | null; warnings: string[]; undo(): void }`. It saves `{ [field]: value }` (text trimmed) `AUTOSAVE_MS` after the last `set`, at once on `flush()` (text inputs call it on blur), and on unmount. It mirrors `panel[field]` while nothing is pending.
  - Setting `characters` also clears `heldBy` for anyone who left the cast, through a second `items` save. This is the same rule as the old dialog.
  - `PanelInspector({ panel, selectedLine, onSelectLine })`.

- [ ] **Step 1: Write the failing tests** (`PanelInspector.test.tsx`, fake timers)
  - Lines is the default tab. With `selectedLine = 1`, row 1 is scrolled into view (stub `scrollIntoView`) and marked `aria-current`.
  - An empty dialogue shows the empty copy verbatim.
  - Edit row 0's text and wait 600ms → one `updatePanel` with the whole dialogue, row 0 changed. "Reset to auto" on a placed row → `placement: null`, shown only on placed rows.
  - Cast tab: add a character → after 600ms `updatePanel(id, { characters: [...] })` and nothing else. Removing a holder → a second save with that item's `heldBy: null`.
  - Scene tab: change Gap after → exactly `{ gapAfter: 'long' }`, and `generatePanel` is not called.
  - **Review Focus 3:** type in Description, then unmount within 100ms → `updatePanel` is called with the trimmed text.
  - A store update (an agent edit) while nothing is pending shows the new Setting. While a Setting edit is pending, the local text stays.
  - `updatePanel` rejects → the error shows in the tab, with `Undo my change`. Undo restores the store value and sends nothing.
  - `PanelCard.test`: no Edit button. `WebtoonStrip.test`: no edit dialog. `PanelEditorDialog.test`: only create cases remain, and they pass.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/renderer`
Expected: the new cases FAIL.

- [ ] **Step 3: Implement**
  - Tabs use `role="tablist"` / `tab` / `tabpanel` with the `.tab-bar` classes.
  - Scene holds Description, Setting, Shot, Aspect and the Layout fieldset, moved from the old dialog with the tall-panel note.

- [ ] **Step 4: Run everything unit-level**

Run: `npx vitest run && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat: edit a panel's lines, cast, items and scene in editing mode, saved as you go`

---

### Task 8: End to end, and a look at it

**Files:**
- Create: `tests/e2e/panel-editing.spec.ts`
- Modify: `tests/e2e/panel-chat.spec.ts` (`panel-side-chat` → `panel-workspace`; the main-chat turn is sent after Strip, per R1), `tests/e2e/panels.spec.ts` (edit flows use the workspace instead of the pencil)

- [ ] **Step 1: Write the e2e**

Use the mock script: create Mina, then a panel with `dialogue: [{ speakerId: Mina, kind: 'speech', text: 'Is that the moon?' }]`. Then:
1. Set the window to 1440×900 (`BrowserWindow.setSize`) and click the card. `panel-workspace` shows `Panel 1 of 1`.
2. Double-click the bubble, select all, type `It's huge!` and press Enter.
3. Drag the bubble with `page.mouse` to 25% / 75% of the stage's box. Stored `panels/<id>.json` (via `readProjectJson`) has line 0 `placement` within 0.02 of `{0.25, 0.75}`.
4. In Scene, set Gutter to black. Stored `gutter` is `black`, and the version count is unchanged.
5. Send `make her smile` in the panel chat (a mock `edit_image` turn). The version label goes to `v2 / 2`.
6. Screenshot to `test-results/panel-editing/editor-1440.png`. Resize to 1100×720 and screenshot `editor-1100.png`.
7. Click Strip. The card is focused, and its bubble has `style.left` `25%`-ish and the new text.

- [ ] **Step 2: Run the e2e suites**

Run: `npm run test:e2e -- panel-editing.spec.ts panel-chat.spec.ts panels.spec.ts`
Expected: PASS.

- [ ] **Step 3: Look at both screenshots** and answer the design skill's app-screen questions in the PR description:
  1. Is the panel the biggest thing, and read first?
  2. Do the columns share edges, with no dead strip?
  3. Is colour only on the selected bubble, the active tab and Regenerate?
  4. Is the stale notice the only tinted ground?
  5. Does every empty tab keep its frame and copy?
  6. Does anything collide or clip at 1100?

Fix the worst three, re-run, and look again (three rounds at most). `inspect.mjs` cannot drive this renderer (it needs the preload's `window.api`), so say that in the report.

- [ ] **Step 4: Full suite**

Run: `npx vitest run && npm run typecheck && npm run test:e2e`
Expected: PASS. The `*-live` specs skip without their keys, as before.

- [ ] **Step 5: Commit** — `test: cover panel editing end to end`
