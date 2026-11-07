# Bubble Width Handle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user set a bubble's width by dragging a handle on either side of the selected bubble on the stage. The text wraps to that width, separately from its size.

**Architecture:** `BubbleStyle` gains an optional `width`, a share of the panel's width. Like the rest of the look it is stored sparse and inherits by index, and the overlay draws it through a CSS variable. A new hook, `use-width-editing.ts`, beside `use-tail-editing.ts`, handles the two edge handles on the stage. A resize saves the bubble's placement and width together.

**Tech Stack:** Electron, React 19, TypeScript, zod 4, Vitest with Testing Library (jsdom has no layout, so rects are mocked), Playwright for Electron.

**Spec:** this file's Design section, extending `docs/superpowers/specs/2026-11-06-bubble-styling-design.md`.

## Design

User's words: "How can I change the dialogue box size?", then "Yes, add it" to a drag handle that sets a bubble's width.

| Question | Decision |
|---|---|
| What is stored | `style.width`: the bubble's whole width, padding and outline included, as a share of the panel's width, from 0.1 to 0.95. Absent means automatic, as today: the bubble fits its text and stops widening at its shape's cap (62%, 72% for a caption, 92% for a sound effect). It sits in `style`, so it inherits by index, Reset style clears it, and the agent sees it. |
| How it draws | `bubbleStyleProps` sets `--bubble-width` as a percentage. A bubble with a width gets the class `bubble-sized`, which sets `width: var(--bubble-width)` and lifts its shape's `max-width` cap. In the placed layer the percentage is of the panel. In the automatic layout it is of the flow column, a little narrower than the panel. That is accepted: a resize on the stage places the bubble first. The height follows the text. |
| The handles | Two, on the left and right edges of the selected bubble, at mid-height, shown while its text is not open, for every shape. Each is a vertical pill, 6 × 16 px on screen at any zoom, with a 24 px hit area. It uses the accent fill with a white ring, `cursor: ew-resize` and `z-index: 1`, like the tail's dot. |
| Dragging | The opposite edge stays where it is. Width is the distance from the pointer to that edge, over the panel's width, clamped to 0.1 to 0.95. The centre moves to midway between the two edges, then is kept inside the panel as a drag keeps it. The stage shows it live, and it saves once, on release. |
| An automatic bubble | Its first resize places it, starting from where it is drawn (`centreOf`), as a nudge does. |
| Keyboard | Each handle is focusable: `role="slider"`, `aria-label` "Width of line N", `aria-valuemin` 10, `aria-valuemax` 95, `aria-valuenow` the width in percent, measured when automatic. Left and Right arrows change the width by 1% (Shift: 5%) around a fixed centre. A run of keys saves once, after `NUDGE_COMMIT_MS`, as nudges do. |
| Back to automatic | A double-click on either handle clears `style.width` and keeps the placement. Reset style also clears it. |
| Saving | One save carrying `placement` and `style`. The style is built when the save is sent, from the stored line's style with only `width` changed, so a style picked in the row a moment earlier is kept. Pressing a handle moves focus out of the row, which already flushes the row's waiting style first. |
| Agent | The tool descriptions' list of style keys and `resources/agent-docs/workflows/panel-editing.md` gain `width`. Nothing else changes for the agent. |

## Global Constraints

- Branch `feat/bubble-width`, cut from `origin/main` at `92237e5`. The PR targets `main`.
- A line without `style.width` draws exactly as today: the export test's ratio checks stay green unchanged.
- `src/renderer/src/components/panel-editor/use-bubble-editing.ts` stays under the 500-line limit in `tests/structure/repo-rules.test.ts` (489 lines at the start). Width code goes in `use-width-editing.ts`, and press types in `bubble-press.ts`.
- No new IPC channel, and no change to `prompts.ts`.
- Every UI string is asserted verbatim in tests. Spelling in strings and code is British.
- Match the app: the tail dot's look, sizes divided by `--stage-scale`, no shadow at rest, the accent only on what is selected or dragged.
- `npm run check` passes at the end.

## Review Focus

1. A style picked in the row, then an immediate resize on the stage: both survive. Test in Task 1.
2. A bubble near the panel's edge resized past it: the bubble stays inside the panel and the width is clamped. Test in Task 1.
3. Export and strip draw the same width as the stage. Test in Task 1 (`export.spec.ts`).
4. A resize while the bubble's text is open is impossible, because the handles are hidden then. A press on a handle neither drags the bubble nor deselects it, nor adds a line on double-click. Test in Task 1.
5. Remove, the tail's dot and Add bubble all still behave. The existing tests stay green.

---

### Task 1: The width handle

**Files:**
- Modify: `src/shared/schemas.ts` (`BubbleStyleSchema`), `src/renderer/src/components/visualizer/bubble-style.ts`, `src/renderer/src/components/visualizer/DialogueOverlay.tsx`, `src/renderer/src/components/panel-editor/use-bubble-editing.ts`, `src/renderer/src/components/panel-editor/bubble-press.ts`, `src/renderer/src/styles.css`, `src/main/agent/tools/panel-tools.ts`, `src/main/agent/tools/panel-chat-tools.ts`, `resources/agent-docs/workflows/panel-editing.md`, `README.md`
- Create: `src/renderer/src/components/panel-editor/use-width-editing.ts`, `src/renderer/src/components/visualizer/BubbleWidthHandles.tsx`
- Test: `src/shared/schemas.test.ts`, `src/renderer/src/components/visualizer/bubble-style.test.ts`, `src/renderer/src/components/visualizer/DialogueOverlay.test.tsx`, `src/renderer/src/components/panel-editor/PanelStage.test.tsx`, `tests/e2e/panel-editing.spec.ts`, `tests/e2e/export.spec.ts`

**Interfaces:**
- `BubbleStyleSchema.width: z.number().min(0.1).max(0.95).optional()`
- `bubbleDefaults(shape)` returns `Required<Omit<BubbleStyle, 'shape' | 'width'>>`. Width has no default.
- `withStyleChange` keeps a defined `width`, and drops it when the change sets it to `undefined`.
- `OverlayEditing` gains `widthPreview: { index: number; width: number; placement: BubblePlacement } | null` and `bindWidth(index: number, edge: 'left' | 'right'): HTMLAttributes<HTMLDivElement>`.

- [ ] **Step 1: Write the failing tests**

- `schemas.test.ts`: `accepts a bubble width from a tenth to 0.95 of the panel` (0.1 and 0.95 parse), and `refuses a width the panel cannot hold` (0.05 and 1 throw).
- `bubble-style.test.ts`:
  - `bubbleStyleProps({ width: 0.42 })['--bubble-width']` is `'42%'`
  - `withStyleChange({ width: 0.4 }, { bold: false }, d)` equals `{ width: 0.4, bold: false }`
  - `withStyleChange({ width: 0.4 }, { width: undefined }, d)` is `null`
- `DialogueOverlay.test.tsx`: `a bubble with a width is drawn that wide` (class `bubble-sized`, `--bubble-width` set), and `a bubble without a width keeps today's look` (no class, no inline style).
- `PanelStage.test.tsx`, a new `describe('the width handles', ...)` using the file's rect mocks. Work out the exact expected numbers from the mocks and assert them.
  - `show on the selected bubble only, one on each side, and go while the text is open`
  - `dragging the right handle keeps the left edge, and saves the width and centre in one save`
  - `dragging the left handle keeps the right edge`
  - `a width past the panel is clamped, and the bubble stays inside`
  - `an automatic bubble is placed by its first resize`
  - `the stage shows the width while dragging, before anything is saved`
  - `arrow keys change the width by 1%, 5% with Shift, saved once`
  - `double-clicking a handle gives the width back to the text, keeps the placement, opens no text and adds no line`
  - `a press on a handle neither drags the bubble nor clears the selection`
  - `a style picked in the row just before a resize is kept`
- `tests/e2e/panel-editing.spec.ts`: `a bubble's width is set by dragging its handle`. Do a real drag of the right handle. The stored `style.width` is within 0.01 of the dragged share, and the bubble's on-screen width over the panel's width matches it within 0.02, on the stage and on the strip after going back. Also check that the handle centre hit-tests as the handle.
- `tests/e2e/export.spec.ts`: give the styled `Over here!` line `width: 0.5`. Assert its bubble's width over its panel's width agrees on screen and in the export within 0.01. The existing tail and ratio assertions must stay green.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/shared/schemas.test.ts src/renderer/src/components/visualizer src/renderer/src/components/panel-editor/PanelStage.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

Follow the Design table. `use-width-editing.ts` owns the handles' press, move, release, keys and double-click, sharing the stage's press ref, nudge timer and `send` as `use-tail-editing.ts` does. Read that file and `use-bubble-editing.ts` whole first. Guard the bubble's own press and double-click paths against a handle, as they are guarded against the dot.

The save's build is `editLine(current, i, expect, { placement, style: withStyleChange(current[i].style, { width }, defaults) })`, computed from `current` at send time. After release, keep the bubble inside the panel using its measured size, as `commitText` does for a new line.

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run src/renderer/src/components src/shared`, then `npm run check`, then `npm run test:e2e -- tests/e2e/panel-editing.spec.ts tests/e2e/export.spec.ts`
Expected: PASS.

- [ ] **Step 5: Look at it**

Using a temporary `tests/e2e/zz-*.spec.ts` (git-ignored), screenshot a selected speech, shout, thought and caption bubble with its handles. Screenshot a narrow and a wide bubble, and a pointed tail on a resized bubble. Read the images: the handles sit on the bubble's visual edges, the text wraps to the width, and the tail still joins the outline. Delete the spec.

- [ ] **Step 6: Docs**

In `panel-editing.md`'s style key list, add `width` (0.1 to 0.95, the bubble's width as a share of the panel's; leave it out to let the text decide). Add `width` to the list of style keys in the three tool descriptions. In `README.md`, add one clause to the bubble paragraph: drag the handles on its sides to set its width. Run `npx vitest run src/main/agent`.

- [ ] **Step 7: Commit**

Commit in a few focused commits: model and drawing, handles, docs.
