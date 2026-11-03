# Panel Shapes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each panel choose its frame (bordered, borderless, slanted), very tall aspects (1:2, 1:3), sitting beside the previous panel, the gap after it and its gutter colour, so the strip reads like a manhwa page.

**Architecture:** Four new fields on `Panel`, plus two new aspects. A shared `drawAspect()` keeps image models at the old six aspects. A pure `layoutStrip()` in the renderer turns the panel order into rows and bands. The agent sets the fields through its existing panel tools, guided by a new style-guide section. The user sets them in the panel editor and with a Beside toggle on the card.

**Tech Stack:** TypeScript 7, zod 4, React 19 + zustand, vitest + Testing Library, Playwright `_electron`, plain CSS (container queries, `mask-image`, `clip-path`).

**Spec:** `docs/superpowers/specs/2026-11-03-panel-shapes-design.md`

## Global Constraints

- Branch `feat/panel-shapes`, based on `feat/manhwa-bubbles`. Never commit to `main`.
- New enums, verbatim: `PanelFrame = 'bordered' | 'borderless' | 'slanted'`, `PanelGap = 'tight' | 'normal' | 'long'`, `PanelGutter = 'white' | 'black'`. The aspect enum gains `'1:2'` and `'1:3'`, appended after `'16:9'`.
- Defaults: `frame 'bordered'`, `beside false`, `gapAfter 'normal'`, `gutter 'white'`. A stored panel without the fields must load with these.
- Draw aspect: `1:2` and `1:3` → `9:16`. Every other aspect maps to itself. Image providers never see `1:2` or `1:3`.
- Pixel values: in-row gap 6px; `gapAfter` tight 8px, normal 28px, long 120px; slant offset 4% of the width (`4cqw` of the row); borderless edge fade 6%; max 3 panels a row.
- Prompt copy, verbatim:
  - tall: `Tall panel: keep the top fifth and bottom fifth plain background (sky, floor, darkness), so they can fade out.`
  - borderless: `Art runs to the edges, no frame.`
- Editor note, verbatim: `Tall panels fade instead of a frame`.
- Layout-only changes never start a redraw.
- Ruling (not in the spec): the "+" insert button sits only in the gaps between rows, not between panels of one row. To put a panel inside a row, insert it after the row and move it up. The cost if that's wrong: a small follow-up to add an in-row "+".
- Comments and naming match the surrounding code: plain sentences, no section banners beyond those already used.
- Run tests with `npx vitest run <path>` and type-check with `npm run typecheck`. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Editor save drops layout edits.** `changes()` in `PanelEditorDialog` builds the patch field by field. A new field it doesn't compare is silently not saved. → Task 6 test: change only Gap after, save, and expect `updatePanel` called with exactly `{ gapAfter: 'long' }` and no generate call.
2. **The Beside toggle overwrites agent edits.** The toggle must send only `{ beside }`, never a whole panel. → Task 6 test asserts the exact patch.
3. **Slanted card loses its toolbar or selection ring.** `clip-path` on the card would clip the hover toolbar and the outline. → Task 5: clip only the media/ink layers. The e2e in Task 7 clicks a toolbar button on a slanted panel.
4. **Bubbles spill out of a narrow panel** once lettering is sized from the row. → Task 5: bubble max-widths in `%` of the overlay. The Task 7 shoot checks a row of 3 with dialogue.
5. **The agent's snapshot hides that a row is full.** Without `beside` in `recent_panels`, the agent adds a 4th beside panel blindly. → Task 3 test: the snapshot line for a beside panel contains `beside`.

---

### Task 1: Data model, draw aspect, providers

**Files:**
- Modify: `src/shared/schemas.ts` (`PanelAspectSchema`, new enums, `PanelSchema`, `PanelDraftSchema`)
- Modify: `src/shared/types.ts` (export the new types)
- Create: `src/shared/draw-aspect.ts`, `src/shared/draw-aspect.test.ts`
- Modify: `src/main/models/providers/types.ts`, `openai-images.ts`, `gemini-images.ts`, `mock.ts`, `src/main/domain/image-service.ts` (`aspect: DrawAspect`)
- Modify: `src/main/domain/panel-service.ts` (create/update carry the fields; requests use `drawAspect`)
- Test: `src/shared/schemas.test.ts`, `src/main/domain/panel-service.test.ts`, `src/main/models/providers/openai-images.test.ts`, `gemini-images.test.ts`

**Interfaces:**
- Produces: `PanelFrameSchema`, `PanelGapSchema`, `PanelGutterSchema`, `DrawAspectSchema` (the old six values), and types `PanelFrame`, `PanelGap`, `PanelGutter`, `DrawAspect`. `Panel` gains `frame`, `beside`, `gapAfter`, `gutter`. `PanelDraft` and `PanelPatch` gain them as optional.
- Produces: `drawAspect(aspect: PanelAspect): DrawAspect` and `isTallAspect(aspect: PanelAspect): boolean` (true for `1:2` and `1:3`), from `@shared/draw-aspect`.

- [ ] **Step 1: Write the failing tests**
  - `draw-aspect.test.ts`: `drawAspect` returns `'9:16'` for `'1:2'` and `'1:3'`, and the input for each of the other six. `isTallAspect` is true only for `1:2` and `1:3`.
  - `schemas.test.ts`: a stored panel object without the four fields parses to `frame 'bordered'`, `beside false`, `gapAfter 'normal'`, `gutter 'white'`. `aspect: '1:3'` parses. `frame: 'tilted'` and `gapAfter: 'huge'` are refused. `PanelPatchSchema.parse({ beside: true })` succeeds.
  - `panel-service.test.ts`:
    - `create` with `{ frame: 'slanted', beside: true }` stores them, and the others default.
    - `update` with `{ gapAfter: 'long', gutter: 'black' }` keeps `currentVersionId` and adds no version.
    - `generate` on a `1:3` panel sends `aspect: '9:16'` to the image service (use the existing fake image service's recorded request).
  - `openai-images.test.ts` / `gemini-images.test.ts`: the existing aspect tests take `DrawAspect`. Add none for 1:2/1:3, since the type forbids them.
- [ ] **Step 2: Run them and see them fail**
  Run: `npx vitest run src/shared src/main/domain/panel-service.test.ts`. Expected: FAIL (module `@shared/draw-aspect` not found, missing defaults).
- [ ] **Step 3: Implement**
  - The enums and fields go in `schemas.ts` with `.default(...)` on `PanelSchema` and `.optional()` on `PanelDraftSchema`.
  - `panel-service.create` passes the draft's values through (the schema defaults fill the rest). `update`'s `merged` includes the four fields with `patch.x ?? current.x`.
  - `generate` and `editImage` build `aspect: drawAspect(panel.aspect)`.
  - Provider/request types switch `PanelAspect` → `DrawAspect`. Character and item reference requests (`'2:3'`, `'1:1'`) type-check unchanged.
- [ ] **Step 4: Run the tests and the type-check**
  Run: `npx vitest run src/shared src/main/domain src/main/models` then `npm run typecheck`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit** — `feat: store panel frame, row, gap and gutter, and draw tall panels at 9:16`

### Task 2: Prompt lines and the template doc

**Files:**
- Modify: `src/main/domain/prompts.ts` (`composePanelPrompt`: the `panel` pick adds `'frame'`; the `[STYLE]` line)
- Modify: `resources/agent-docs/reference/prompt-templates.md` (Panel Prompt section)
- Test: `src/main/domain/prompts.test.ts`, `src/main/agent/workflow-docs.lint.test.ts` (must stay green)

**Interfaces:**
- Consumes: `drawAspect`, `isTallAspect` (Task 1).

- [ ] **Step 1: Write the failing tests** in `prompts.test.ts`
  - A `1:3` panel's `[STYLE]` line contains `9:16 aspect ratio` and ends with the verbatim tall sentence. It does not contain `1:3`.
  - A `borderless` `2:3` panel's `[STYLE]` line contains the verbatim borderless sentence.
  - A default panel's `[STYLE]` line is byte-identical to today's.
  - A borderless tall panel gets only the tall sentence, because tall panels always fade.
- [ ] **Step 2: Run them and see them fail**
  Run: `npx vitest run src/main/domain/prompts.test.ts`. Expected: FAIL on the three new cases.
- [ ] **Step 3: Implement** — the `[STYLE]` line names `drawAspect(panel.aspect)`. It appends the tall sentence when `isTallAspect`, otherwise the borderless sentence when `frame === 'borderless'`, each after a space at the end of the line.
- [ ] **Step 4: Document** — in `prompt-templates.md`, Panel Prompt: `{aspect}` is now "the panel's draw aspect (1:2 and 1:3 are drawn at 9:16)". Add a short list of the two optional sentences with their conditions, verbatim. Keep the existing example blocks byte-identical (the lint test compares them).
- [ ] **Step 5: Run** `npx vitest run src/main/domain/prompts.test.ts src/main/agent/workflow-docs.lint.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit** — `feat: tell the image model about tall and borderless panels`

### Task 3: Agent tools, snapshot and layout guidance

**Files:**
- Modify: `src/main/agent/tools/panel-tools.ts` (`create_panel` input describes, `list_panels` output)
- Modify: `src/main/agent/tools/panel-chat-tools.ts` (`patchInput` describes, `fieldsView`)
- Modify: `src/main/agent/system-prompt.ts` (`panelSummary`)
- Modify: `resources/agent-docs/AGENTS.md`, `reference/webtoon-style-guide.md`, `workflows/story-direction.md`, `workflows/panel-generation.md`
- Modify: `src/main/agent/workflow-docs.lint.test.ts` (`REQUIRED['reference/webtoon-style-guide']` adds `'Panel Layout'`)
- Test: `panel-tools.test.ts`, `panel-chat-tools.test.ts`, `system-prompt.test.ts`

**Interfaces:**
- Consumes: the Task 1 fields and enums.
- Produces: `layoutTag(p: Panel): string`, exported from `system-prompt.ts`. It returns the bracket content: the shot, the aspect, then only the non-default values in the order `beside`, the frame (`borderless`/`slanted`), `gap <tight|long>`, `gutter black`. Example: `close-up, 2:3, beside`.

- [ ] **Step 1: Write the failing tests**
  - `system-prompt.test.ts`:
    - A default `2:3` medium panel's summary starts `<id> [medium, 2:3] cast:`.
    - A panel with `beside: true, frame: 'slanted', gapAfter: 'long', gutter: 'black'` shows `[wide, 16:9, beside, slanted, gap long, gutter black]`.
  - `panel-tools.test.ts`:
    - `list_panels` items include `frame`, `beside`, `gapAfter`, `gutter`.
    - `create_panel` with `{ beside: true, gapAfter: 'tight' }` creates the panel with them.
    - `update_panel` with patch `{ frame: 'borderless' }` and no `regenerate` returns the updated panel and records no new version.
  - `panel-chat-tools.test.ts`: `update_panel_fields({ gutter: 'black' })` returns `updated: ['gutter']`, and `fields.gutter === 'black'`.
- [ ] **Step 2: Run them and see them fail.** Run: `npx vitest run src/main/agent`. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement**
  - `panelSummary` uses `[${layoutTag(p)}]` in place of `[${p.shot}]`.
  - `list_panels` and `fieldsView` add the four fields.
  - `create_panel` and `patchInput` add a `.describe()` to each field:
    - `frame`: "bordered (default), borderless for clashes and wide establishing shots, slanted for action runs. Ignored on 1:2 and 1:3, which fade."
    - `beside`: "true puts this panel in the previous panel's row (at most 3 a row): the default for quick exchanges. Default false."
    - `gapAfter`: "Space after this panel or its row: tight for rapid fire, normal (default), long for time passing or a scene change."
    - `gutter`: "white (default) or black for dark places; consecutive black panels form one dark band."
    - `aspect`: add to the describe "1:2 and 1:3 are very tall panels for descents, falls and reveals."
  - Update the `list_panels` description's field list.
- [ ] **Step 4: Docs**
  - `webtoon-style-guide.md`: add a `## Panel Layout` section with the spec §5.2 rules (one bullet each, wording from the spec). Add `1:2`/`1:3` to Panel Aspects.
  - `story-direction.md`, in Vertical Pacing: one sentence pointing at `reference/webtoon-style-guide` Panel Layout for rows, gaps and gutters.
  - `panel-generation.md`, in Shot and Aspect Selection: one sentence on the new fields.
  - `AGENTS.md`:
    - the `recent_panels` line format becomes "panel id, [shot, aspect and the layout that differs from the defaults]";
    - the `create_panel` and `update_panel_fields` inputs list `frame`, `beside`, `gapAfter`, `gutter`;
    - the `list_panels` summary names them.
- [ ] **Step 5: Run** `npx vitest run src/main/agent`, then `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** — `feat: let the agent lay out panels in rows, frames, gaps and gutters`

### Task 4: `layoutStrip`

**Files:**
- Create: `src/renderer/src/components/visualizer/strip-layout.ts`, `strip-layout.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface StripRow { panels: Panel[]; gapAfter: PanelGap; gutter: PanelGutter; slants: Record<string, 'left' | 'right'> }
  export function layoutStrip(panels: Panel[]): StripRow[]
  ```
  `slants` holds an entry only for panels whose `frame === 'slanted'` and whose aspect is not tall.

- [ ] **Step 1: Write the failing tests** (build panels with `makePanel` from `src/renderer/src/test/panel-fixtures.ts`, adding the fields)
  - `[]` → `[]`.
  - Three defaults → three rows of 1, each `gapAfter 'normal'`, `gutter 'white'`.
  - `A, B(beside), C(beside)` → one row `[A,B,C]`.
  - `A, B(b), C(b), D(b)` → rows `[A,B,C]`, `[D]`.
  - The first panel `beside: true` → its own row.
  - `A(gutter black, gap long), B(beside, gutter white, gap tight)` → one row with `gutter 'white'`, `gapAfter 'tight'` (taken from the last panel).
  - Slanted `A`, default `B`, slanted `C`, slanted `D(beside)` → `A: 'left'`, `C: 'right'`, `D: 'left'`.
  - A slanted `1:3` panel gets no slant entry and doesn't advance the alternation.
- [ ] **Step 2: Run them and see them fail.** Run: `npx vitest run src/renderer/src/components/visualizer/strip-layout.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** — a single pass over the panels with a running slant counter. A pure function with no React.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** — `feat: group panels into rows for the strip`

### Task 5: Drawing rows, frames, fades and gutters

**Files:**
- Modify: `src/renderer/src/components/visualizer/WebtoonStrip.tsx` (render bands and rows from `layoutStrip`)
- Modify: `src/renderer/src/components/visualizer/PanelCard.tsx` (new prop `slant?: 'left' | 'right'`, data attributes, tall/borderless classes)
- Modify: `src/renderer/src/styles.css` (strip, card, media, lettering container)
- Test: `src/renderer/src/components/visualizer/WebtoonPane.test.tsx`, `PanelCard.test.tsx`

**Interfaces:**
- Consumes: `layoutStrip`, `StripRow` (Task 4), `isTallAspect` (Task 1).
- Produces:
  - DOM: `.strip-band[data-gutter]` > `.strip-row[data-row-size]` > `.panel-card[data-frame][data-beside][data-gutter][data-gap][data-slant]`, then `.strip-gap[data-gap]` holding the `InsertPanelButton` for after the row's last panel.
  - On a tall panel, `data-frame` is the effective frame `'fade'`.
  - `PanelCard` takes `{ panel, selected, slant? }`.

- [ ] **Step 1: Write the failing tests**
  - `WebtoonPane.test.tsx`:
    - With panels `A, B(beside), C`, there are 2 `.strip-row` elements, with `data-row-size` `2` and `1`.
    - There is one insert button (`data-testid="add-panel"`) per row: one after each row but the last, plus the append. That's 2 in this case.
    - A black-gutter panel's band has `data-gutter="black"`.
  - `PanelCard.test.tsx`:
    - A `slanted` panel with `slant="right"` has `data-frame="slanted"` and `data-slant="right"`.
    - A `1:3` panel with `frame: 'bordered'` has `data-frame="fade"`, and its `.panel-media` style has `aspect-ratio: 1 / 3`.
    - The existing bubble tests still pass.
- [ ] **Step 2: Run them and see them fail.** Run: `npx vitest run src/renderer/src/components/visualizer`. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement the components** — `WebtoonStrip` maps `layoutStrip(panels)` to bands. The insert button after a row uses that row's last panel id. The append button stays the single keyed element at the end (keep the existing comment's reason true).
- [ ] **Step 4: Implement the CSS**, in the existing strip/card block, keeping its comment style.
  - **Band and row:**
    - The band spans the strip's full width. The strip's side padding moves onto the band.
    - The band background is the strip's page colour (`var(--raised)`, spec §11 R2) for white, or `#000` for black. The insert button stays visible on black.
    - `.strip-row`: `display: flex; gap: 6px; width: min(100%, 440px); container-type: inline-size`.
    - Each card has `flex: <w/h> 1 0` from an inline `--ar` custom property set by `PanelCard`, so heights match.
  - **Gaps:** `.strip-gap` heights are 8 / 28 / 120px. The old card `margin`/gutter rules go.
  - **Lettering:** remove `container-type` from `.panel-media`. Change bubble `max-width`s that are in `cqw` to `%`.
  - **Borderless:** no border, transparent background, and the image gets a two-gradient `mask-image` with `mask-composite: intersect` (6% fade on each edge).
  - **Slanted:** the card keeps no border of its own. `.panel-media` gets `background: var(--ink)` and a `clip-path: polygon(...)` with a `4cqw` offset (left slant: top edge drops to the right and bottom edge rises to the right; right slant is the mirror). The `img` and overlay sit in it with the same polygon inset by 2.5px, so the ink shows as the edge. The card's outline and toolbar stay unclipped.
  - **Fade (tall):** no border, transparent background. The `img` is absolutely centred vertically at `width: 100%; height: auto` with a vertical `mask-image` fading 15% at the top and bottom.
- [ ] **Step 5: Run** `npx vitest run src/renderer` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** — `feat: draw panel rows, frames, tall fades and gutter bands`

### Task 6: Editing the layout

**Files:**
- Modify: `src/renderer/src/components/visualizer/PanelEditorDialog.tsx` (`Values`, `fromPanel`, `normalize`, `changes`, create defaults, a Layout group)
- Modify: `src/renderer/src/components/visualizer/PanelCard.tsx` (toolbar Beside toggle)
- Test: `PanelEditorDialog.test.tsx`, `PanelCard.test.tsx`

**Interfaces:**
- Consumes: `usePanelsStore.getState().updatePanel(id, patch)` (existing), `isTallAspect`, the Task 1 enums' `.options`.

- [ ] **Step 1: Write the failing tests**
  - `PanelEditorDialog.test.tsx`:
    - In edit mode, changing "Gap after" to `long` and clicking Save calls `updatePanel(id, { gapAfter: 'long' })` exactly, and does not call `generatePanel`.
    - Each control (Frame, Beside the previous panel, Gap after, Gutter) round-trips the panel's stored value.
    - Picking aspect `1:3` disables Frame and shows the text `Tall panels fade instead of a frame`.
    - Create mode sends no layout fields unless they were changed.
  - `PanelCard.test.tsx`:
    - The "Beside previous" button has `aria-pressed` equal to `panel.beside`. Clicking it calls `updatePanel(panel.id, { beside: true })` exactly, and does not select the panel.
    - It is disabled when the panel is first in the episode.
- [ ] **Step 2: Run them and see them fail.** Run: `npx vitest run src/renderer/src/components/visualizer`. Expected: FAIL on the new cases.
- [ ] **Step 3: Implement**
  - **Values:** gain `frame`, `beside`, `gapAfter`, `gutter`. `changes()` compares each one. Create-mode initial values use the defaults, and create sends only the changed layout fields.
  - **Layout group:** a `fieldset`/`field-row` after Shot/Aspect, with labels exactly `Frame`, `Beside the previous panel` (checkbox), `Gap after`, `Gutter`.
  - **Saving:** a save whose patch holds only layout fields goes through the same path as a dialogue-only save (no generate).
  - **Toolbar:** the toggle uses the lucide `Columns2` icon, `aria-label="Beside previous"`, and goes through the existing `run()` for busy and error handling.
- [ ] **Step 4: Run** `npx vitest run src/renderer` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** — `feat: edit a panel's layout in the editor and from the card`

### Task 7: Whole-suite check, e2e and the story re-shoot

**Files:**
- Modify: the panels e2e spec under `e2e/` (find it with `grep -l "panel-card" e2e`)
- Modify (outside the repo): `E:\claude\manhwa-benchmark\run\story-panels.spec.ts` (new `STAGE=layout`), `E:\claude\manhwa-benchmark\story-panels\results.md`

- [ ] **Step 1: Write the e2e case.** Two panels; set the second to beside and slanted through the editor. Assert one `.strip-row[data-row-size="2"]`, then click the slanted card's Edit button. Expect the dialog to open, which proves the toolbar isn't clipped.
- [ ] **Step 2: Run** `npm test`, `npm run typecheck`, and the panels e2e (`npm run build`, then `npx playwright test <panels spec>`). Expected: all pass. A worker crash `0xC0000409` in `mcp-server.test.ts` is the known Node 24.15 flake: re-run that file alone and report it.
- [ ] **Step 3: Commit** — `test: cover panel rows and slanted frames end to end`
- [ ] **Step 4: Re-shoot the story.** Add `STAGE=layout` to `story-panels.spec.ts`. It patches the 22 panels through `panels:update` with a fixed layout map: the talk panels beside in rows of 2–3, the clash borderless/slanted, the descent `1:3`, the dungeon `gutter: 'black'`, and a `long` gap at the scene change. Then run `STAGE=shoot SHOOT_DIR=strip-shapes`. Compare against `episode-strip-new-bubbles.jpg`.
- [ ] **Step 5: Update `results.md`.** Mark gaps 3–4 addressed (or say what's still off) and re-score the layout rows of the rubric.
