# Sheet Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Check every generated character and item reference sheet against its lock with the vision model, redraw it when it fails, block the agent from casting a sheet that still fails, and warn in the editor.

**Architecture:** `ConsistencyChecker` gains `checkSheet`, which judges an in-memory candidate image with a new system-prompt doc (`reference/sheet-checklist`). `CharacterService.generateVariationImage` and `ItemService.generateUsageImage` run a draw→check→redraw loop before their existing locked `finish` step, so a sheet is `pending` until its final image and check are recorded together. `validatePanelDraft` reads the stored `check` (pure, no I/O) and reports failed sheets as errors for the agent and warnings in the editor.

**Tech Stack:** Electron + electron-vite, TypeScript, zod 4, React 19 + zustand, vitest, Playwright `_electron`.

**Spec:** `docs/superpowers/specs/2026-11-02-sheet-check-design.md`

## Global Constraints

- Branch `feat/sheet-check`, worktree `E:\claude\Webtoon AI Harness\.claude\worktrees\sheet-check`. Run every command from there.
- Unit tests: `npx vitest run <path>`. Any edit under `resources/agent-docs/` must keep `src/main/agent/workflow-docs.lint.test.ts` passing. Whole suite: `npm test`. Types: `npm run typecheck`. E2E: `npm run build` then `npx playwright test <spec>`.
- Zod input and patch schemas carry no defaults; stored schemas default `check` to `null`.
- Ruling T15a: mark pending under the lock, work outside it, record under the lock. Never hold a file lock across a model call.
- `checkSheet`, like `check`, never throws and returns null when no `vision` model is assigned.
- A failed sheet is exactly `check !== null && check.passed === false && check.skipped === false`. `null` and `skipped` are never blocked or warned about.
- The fix instruction text is exactly `Fix these issues: {issues joined by "; "}`, appended to the sheet prompt after one space; no instruction when `issues` is empty.
- Gate messages, exact: `Variation "{name}" of {character} failed its sheet check: {issues joined by "; "}. Regenerate it or ask the user.` and `Usage "{name}" of {item} failed its sheet check: {issues joined by "; "}. Regenerate it or ask the user.`
- Agent refusal, exact: `The base sheet of {name} failed its check: {issues joined by "; "}. Regenerate the base first.`
- Agent outcome note, exact: `The sheet failed its check after the redraws. It cannot be cast until it passes: regenerate it, fix the lock, or ask the user.`
- Snapshot marker for a failed sheet: `(ready, check failed)` in place of `(ready)`.
- Code style: match the surrounding files (JSDoc on exported functions, `Ruling …` references where a rule comes from a ruling, no semicolons, single quotes).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The checker says `passed: false` with no issues.** The redraw must be a plain re-roll (no "Fix these issues:" suffix), not a prompt ending in "Fix these issues: ". → Task 3 test.
2. **`consistencyRetries` is 0.** The sheet is checked once and recorded with its failed check, with no redraw. → Task 3 test.
3. **The run is cancelled during the check.** The checker returns a skipped "Cancelled" result. The candidate must be recorded with that skipped check, not thrown away and not redrawn. → Task 3 test.
4. **An upload over a failed sheet.** The upload clears `check` to null, so the user's own image unblocks the sheet. → Task 3 and Task 4 tests.
5. **A project file written before this change.** A variation or usage with no `check` key parses as `check: null` and is never reported by the gate. → Task 1 and Task 5 tests.

---

### Task 1: `check` on sheets and the fix suffix in sheet prompts

**Files:**
- Modify: `src/shared/schemas.ts` (move `CheckResultSchema` above the Characters section; add `check` to `VariationSchema` and `ItemUsageSchema`)
- Modify: `src/main/domain/prompts.ts`
- Modify: `resources/agent-docs/reference/prompt-templates.md` (document the fix suffix on the four sheet prompts)
- Test: `src/shared/schemas.test.ts` (create it if it does not exist), `src/main/domain/prompts.test.ts`

**Interfaces:**
- Produces: `Variation.check: CheckResult | null` and `ItemUsage.check: CheckResult | null` (default `null`).
- Produces: `sheetFixInstruction(issues: string[]): string | undefined` in `prompts.ts`. It returns `Fix these issues: a; b`, or `undefined` for `[]`.
- Produces: an optional last parameter `fix?: string` on `baseReferencePrompt(c, stylePreset, fix?)`, `variationPrompt(c, v, stylePreset, fix?)`, `itemReferencePrompt(item, stylePreset, fix?)` and `itemUsagePrompt(item, usage, stylePreset, fix?)`. With `fix`, the prompt is the existing prompt + `' ' + fix`. Without it, the prompt is byte-identical to today's.

- [ ] **Step 1: Write the failing tests**

```ts
it('parses a stored variation and usage without check as check: null', () => {
  const v = VariationSchema.parse({ id: 'var_0000000001', characterId: 'chr_0000000001', name: 'Base', kind: 'base', status: 'ready', createdBy: 'user', createdAt: '2026-11-02T00:00:00.000Z' })
  expect(v.check).toBeNull()
  const u = ItemUsageSchema.parse({ id: 'use_0000000001', itemId: 'itm_0000000001', name: 'At rest', kind: 'base', status: 'ready', createdBy: 'user', createdAt: '2026-11-02T00:00:00.000Z' })
  expect(u.check).toBeNull()
  expect(VariationSchema.parse({ ...v, check: { passed: false, issues: ['x'] } }).check).toEqual({ passed: false, issues: ['x'], skipped: false })
})
```

In `prompts.test.ts`:
- `sheetFixInstruction(['A is wrong', 'B is missing'])` → `'Fix these issues: A is wrong; B is missing'`; `sheetFixInstruction([])` → `undefined`.
- For each of the four builders: `builder(..., 'Fix these issues: X')` equals `builder(...) + ' Fix these issues: X'`, and `builder(...)` with no `fix` still equals the existing pinned string.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/shared/schemas.test.ts src/main/domain/prompts.test.ts`
Expected: FAIL (`check` is undefined; `sheetFixInstruction` is not exported).

- [ ] **Step 3: Implement**

Use `check: CheckResultSchema.nullable().default(null)` on both schemas. In `prompts.ts`, add `sheetFixInstruction`. Each builder returns `fix ? `${prompt} ${fix}` : prompt`. In `prompt-templates.md`, add one line under the sheet prompts: after a failed sheet check, the redraw appends ` Fix these issues: {issues joined by "; "}`.

- [ ] **Step 4: Run them and see them pass, then typecheck**

Run: `npx vitest run src/shared/schemas.test.ts src/main/domain/prompts.test.ts && npm run typecheck`
Expected: PASS. Typecheck is clean (factories pick up the default).

- [ ] **Step 5: Commit**

```bash
git add src/shared/schemas.ts src/shared/schemas.test.ts src/main/domain/prompts.ts src/main/domain/prompts.test.ts resources/agent-docs/reference/prompt-templates.md
git commit -m "feat: sheets store their check, sheet prompts take a fix instruction"
```

---

### Task 2: `checkSheet` and the sheet checklist doc

**Files:**
- Modify: `src/main/domain/consistency-checker.ts`
- Create: `resources/agent-docs/reference/sheet-checklist.md`
- Modify: `resources/agent-docs/AGENTS.md` (add a row to the doc table: `need to understand a failed sheet check | reference/sheet-checklist`)
- Test: `src/main/domain/consistency-checker.test.ts`

**Interfaces:**
- Consumes: `Variation.check` and `ItemUsage.check` (Task 1).
- Produces:
  ```ts
  export const SHEET_CHECKLIST_DOC = 'reference/sheet-checklist'
  export const CANDIDATE_IMAGE_KEY = 'candidate://sheet'
  export type SheetSubject =
    | { kind: 'character'; character: Character; variation: Variation }
    | { kind: 'item'; item: Item; usage: ItemUsage }
  export interface SheetCheckInput { image: Buffer; subject: SheetSubject; baseImageRelPath: string | null; signal?: AbortSignal }
  export function buildSheetCheckMessage(input: Pick<SheetCheckInput, 'subject' | 'baseImageRelPath'>): string
  ConsistencyChecker.checkSheet(ctx: ProjectContext, input: SheetCheckInput): Promise<CheckResult | null>
  ```

- [ ] **Step 1: Write the failing tests**

`buildSheetCheckMessage`, exact output for each case:
- Base character (no base image):
  ```
  Images, in the order attached:
  1. Generated sheet (the image to check)

  Sheet: Character reference sheet
  Subject: Ara
  Lock: LOCK
  ```
- Character variation `Outfit: Rain` with delta `yellow raincoat`, base given: the images list becomes `1. Base reference: character Ara` / `2. Generated sheet (the image to check)`, and a last line `Look: Outfit: Rain — yellow raincoat` is added.
- Item base: `Sheet: Item reference sheet`, no `State:` or `Usage:` line.
- Item state usage `Folded` / `blade folded flat`: `Sheet: Item reference sheet`, `1. Base reference: item Vesper glaive`, and `State: Folded — blade folded flat`.
- Item action usage `Sweeping strike` / `D`: `Sheet: Item usage reference sheet`, and `Usage: Sweeping strike — D`.
- A non-base sheet with an empty delta reads `Look: {name}` (or `State:`/`Usage:` with the name alone), matching `buildCheckMessage`.

`checkSheet`, using the existing `fakeProvider` and a registry stub:
- `'sends the sheet checklist as system and the candidate as the last image'`:
  - `req.system` equals the project's copy of `sheet-checklist.md`;
  - the message's `imagePaths` equal `['characters/chr_x/base.png', 'candidate://sheet']` for a variation, and `['candidate://sheet']` for a base;
  - the loaded candidate equals the identity-ops downscale of the candidate buffer;
  - the result is the parsed reply.
- `'returns null without a vision model'`.
- `'is a skipped pass when the doc is missing, the base image is missing, the provider throws or the call times out'`. Same wording as `check`: `Consistency check failed to run: …` and `Consistency check timed out after {n}s`.
- `'reads Cancelled when the caller aborts'`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/main/domain/consistency-checker.test.ts`
Expected: FAIL (no `buildSheetCheckMessage` / `checkSheet`).

- [ ] **Step 3: Implement**

- **`checkSheet`:** reuse `check`'s skeleton. Factor the shared part into a private `runVision(ctx, { doc, text, imagePaths, loadImage, signal })` that both methods call. Its timeout, abort and skipped-result handling are unchanged.
- **Loading images:** the `loadImage` passed to the provider returns the downscaled candidate for `CANDIDATE_IMAGE_KEY`: `imageOps.downscale(image, MAX_TEXT_MODEL_IMAGE_EDGE, { format: 'jpeg' })`, as base64. Every other path goes through `loadImageForTextModel`. An empty or undecodable candidate is a skipped pass.
- **`check`:** its behavior and its tests stay as they are.

Write `sheet-checklist.md` from spec §6, with the same section layout as `consistency-checklist.md`:
- What you receive
- Checklist (Character sheets / Item sheets / Every sheet)
- Severity (Major / Minor, "When you are not sure whether a problem is Major, treat it as Minor")
- Retry Guidance (the issues are pasted after `Fix these issues:`; at most 4; about 20 words; name what is wrong and what it must be, pointing at the lock)
- Output Format, ending with the same one-line JSON reminder

Its good-issue examples must include:
- "Ara reads as a man, but her lock says a twenty-four-year-old woman"
- "The scar through Ara's right eyebrow is missing"
- "Skin-colored hands hold the glaive, but an action sheet shows only plain gray hands"

State explicitly that several views on one sheet (turnarounds, back views, close-up insets) are Minor.

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run src/main/domain/consistency-checker.test.ts src/main/agent/workflow-docs.lint.test.ts`
Expected: PASS (the old `check` tests and the docs lint included).

- [ ] **Step 5: Commit**

```bash
git add src/main/domain/consistency-checker.ts src/main/domain/consistency-checker.test.ts resources/agent-docs/reference/sheet-checklist.md resources/agent-docs/AGENTS.md
git commit -m "feat: the vision checker judges a reference sheet against its lock"
```

---

### Task 3: Draw→check→redraw for character sheets

**Files:**
- Modify: `src/main/domain/character-service.ts`
- Modify: `src/main/services.ts` (construct `ConsistencyChecker` before `CharacterService` and pass it as `sheetChecker`)
- Test: `src/main/domain/character-service.test.ts`

**Interfaces:**
- Consumes: `ConsistencyChecker.checkSheet` and `SheetCheckInput` (Task 2), and `sheetFixInstruction` plus the `fix` parameter (Task 1).
- Produces:
  - `CharacterServiceOptions.sheetChecker?: Pick<ConsistencyChecker, 'checkSheet'>`;
  - `generateVariationImage` resolves to the recorded variation, with `check` set;
  - `uploadVariationImage` records `check: null`.

- [ ] **Step 1: Write the failing tests**

Extend `setup` with an optional scripted checker. It is a list of `CheckResult | null` replies, and it records each `SheetCheckInput`. It also takes an optional `consistencyRetries`, which the test sets through `t.store` project meta.

1. `'records a sheet that passes its first check'`: 1 draw, 1 check. The result has `status: 'ready'` and `check: { passed: true, issues: [], skipped: false }`. The check got `baseImageRelPath: null` and `subject.kind: 'character'`.
2. `'redraws a failed sheet with the issues and records the second image'`: replies fail `['Ara reads as a man']`, then pass. That makes 2 draws, and `calls[1].prompt` ends with ` Fix these issues: Ara reads as a man`. The recorded `imagePath` is the second image's file, the check passed, and only one image file exists in the character folder.
3. `'records the last image with its failed check when every check fails'`: retries 1, so fail, fail. 2 draws; the result is `status: 'ready'` with the second failed check.
4. `'re-rolls without a fix when a failed check names no issue'` (Review Focus 1): `calls[1].prompt` equals `calls[0].prompt`.
5. `'checks once and does not redraw when consistencyRetries is 0'` (Review Focus 2).
6. `'stops on a skipped check and records it'`: also covers the "Cancelled" case for an abort during the check (Review Focus 3). 1 draw; the recorded check is skipped.
7. `'stays pending while the check runs'`: the checker blocks on a deferred. `svc.get` shows the variation `pending` with `imagePath` unchanged; then the check is released.
8. `'keeps the previous image and check when the first draw fails'`: start from a variation stored `ready` with a passed check. The draw throws, so the result is `failed`, and `imagePath` and `check` are unchanged.
9. `'records the last candidate when a redraw fails'`: fail check, then the second draw throws. The result is `ready` with the first image and the failed check.
10. `'sends the base sheet to the check of a variation'`: `baseImageRelPath` is the base's `imagePath`, and the subject variation is the variation itself.
11. `'records check null without a sheet checker or when it returns null'`.
12. `'an upload clears a failed check'` (Review Focus 4).

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/main/domain/character-service.test.ts`
Expected: the new tests FAIL; the old ones still pass.

- [ ] **Step 3: Implement**

Split the current draw into a private `draw(snapshot, variation, base, stylePreset, fix, signal)`, then loop between it and `finish` as spec §7 shows. Read `consistencyRetries` with `stylePreset` from `getMeta` once, at the start.

`finish(ctx, id, fallback, result, failure, check)` records `check` on success. On the first-draw failure path, it leaves the stored `check` untouched (it spreads `existing`). The pending mark keeps `check` as stored.

In `services.ts`, move the `new ConsistencyChecker(...)` line above `new CharacterService(...)` and pass `sheetChecker: checker`.

- [ ] **Step 4: Run them and see them pass, then the whole suite and typecheck**

Run: `npx vitest run src/main/domain/character-service.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/domain/character-service.ts src/main/domain/character-service.test.ts src/main/services.ts
git commit -m "feat: character sheets are checked and redrawn before they are recorded"
```

---

### Task 4: Draw→check→redraw for item sheets

**Files:**
- Modify: `src/main/domain/item-service.ts`
- Modify: `src/main/services.ts` (pass `sheetChecker: checker` to `ItemService`)
- Test: `src/main/domain/item-service.test.ts`

**Interfaces:**
- Consumes: the same pieces as Task 3, with `subject: { kind: 'item', item, usage }`.
- Produces: `ItemServiceOptions.sheetChecker?: Pick<ConsistencyChecker, 'checkSheet'>`. `generateUsageImage` and `uploadUsageImage` behave as in Task 3.

- [ ] **Step 1: Write the failing tests**

Mirror Task 3's tests 1, 2, 3, 7, 8, 10 and 12 for usages. The item twin of test 2 asserts that an action usage's redraw prompt is `itemUsagePrompt(...) + ' Fix these issues: …'`. Test 10 asserts that `baseImageRelPath` is the `At rest` usage's image.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/main/domain/item-service.test.ts`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

Use the same shape as Task 3. Do not share a helper across the two services unless it falls out naturally: the two services are deliberate twins, and the existing code duplicates `finish`.

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run src/main/domain/item-service.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/domain/item-service.ts src/main/domain/item-service.test.ts src/main/services.ts
git commit -m "feat: item sheets are checked and redrawn before they are recorded"
```

---

### Task 5: The gate in panel validation

**Files:**
- Modify: `src/main/domain/panel-validation.ts`
- Modify: `src/main/domain/panel-service.ts` (`create` / `update` opts; both grandfather helpers)
- Modify: `src/main/agent/tools/panel-tools.ts`, `src/main/agent/tools/panel-chat-tools.ts` (pass `strictSheets: true`)
- Modify: `src/main/ipc/handlers/panels.ts` (pass `strictSheets: false`)
- Test: `src/main/domain/panel-validation.test.ts`, `src/main/domain/panel-service.test.ts`

**Interfaces:**
- Consumes: `Variation.check` and `ItemUsage.check` (Task 1).
- Produces:
  - `sheetCheckFailure(sheet: { check: CheckResult | null }): string[] | null` returns the issues of a failed sheet, else null;
  - `sheetCheckState(check: CheckResult | null): 'passed' | 'failed' | 'skipped' | null`;
  - `validatePanelDraft(draft, roster, itemRoster, opts: { strictMentions: boolean; strictSheets: boolean })`;
  - `PanelService.create(ctx, draft, opts: { createdBy; strictMentions; strictSheets })` and `update(ctx, id, patch, opts: { strictMentions; strictSheets })`.

- [ ] **Step 1: Write the failing tests**

In `panel-validation.test.ts`:
- `'reports a cast variation that failed its sheet check as an error when strictSheets'`: the errors contain exactly the Global Constraints message, with issues joined by `; `.
- `'… as a warning without strictSheets'`.
- `'reports an item usage that failed its sheet check'`: the error and warning variants.
- `'does not report unchecked, passed or skipped sheets'` (Review Focus 5): `check: null`, passed, and `{ passed: true, skipped: true }`.
- `'does not report a failed sheet that is also not ready'`: only the existing "no ready reference image" error.
- `sheetCheckState` covers all four values.

In `panel-service.test.ts`:
- `'update grandfathers an unchanged cast entry whose sheet failed its check'`: a panel stored with a failed variation. `update` of the description only, with `strictSheets: true`, succeeds. Changing that entry to another failed variation is rejected.
- The same for an unchanged item entry.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/main/domain/panel-validation.test.ts src/main/domain/panel-service.test.ts`
Expected: the new tests FAIL. The type errors at call sites are fixed in Step 3.

- [ ] **Step 3: Implement**

In `validatePanelDraft`, report the sheet failure in the same `else` chain right after the ready check, so a sheet that is not ready gets only the ready error. In the grandfather helpers, `unusable` also counts a kept pair whose sheet `sheetCheckFailure` reports; the replacement sets `check: null` as well. Update every caller: agent paths pass `strictSheets: true` on both create and update, and IPC passes `false`. Existing tests that call these with `{ strictMentions }` add `strictSheets: false`.

- [ ] **Step 4: Run them and see them pass, then the whole suite**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/main/domain src/main/agent/tools src/main/ipc/handlers/panels.ts
git commit -m "feat: a failed sheet blocks the agent and warns in the editor"
```

---

### Task 6: The agent sees checks and cannot build on a failed base

**Files:**
- Modify: `src/main/agent/tools/character-tools.ts`, `src/main/agent/tools/item-tools.ts`
- Modify: `src/main/agent/system-prompt.ts`
- Modify: `resources/agent-docs/workflows/character-creation.md`, `resources/agent-docs/workflows/item-creation.md`
- Test: `src/main/agent/tools/character-tools.test.ts`, `src/main/agent/tools/item-tools.test.ts`, `src/main/agent/system-prompt.test.ts`

**Interfaces:**
- Consumes: `sheetCheckFailure` and `sheetCheckState` (Task 5).
- Produces:
  - `variationOutcome` / `usageOutcome` content adds `check: CheckResult | null`, plus `note` (the exact outcome note) when the sheet failed;
  - `list_characters` / `get_character` / `list_items` / `get_item` sheet entries add `check: 'passed' | 'failed' | 'skipped' | null`, plus `checkIssues: string[]` when failed;
  - the snapshot sheet status reads `(ready, check failed)` for a failed sheet.

- [ ] **Step 1: Write the failing tests**

- `create_variation` with the base failed throws `ToolError`. The message equals the exact refusal (with the character's name), and no variation was added (`addVariation` not called; the character still has one variation).
- `regenerate_variation` on a non-base variation with the base failed throws the same refusal. `regenerate_variation` on the failed base itself is allowed.
- `create_item_usage` / `regenerate_item_usage`: the same, with the item's name.
- Outcomes: a generation that records a failed check returns `content.check` and the exact `note`; a passed one returns `check` and no `note`.
- `list_characters` lists `check: 'failed'` and `checkIssues` for a failed base.
- Snapshot: a failed base reads `var_… Base (ready, check failed)`; passed and unchecked read `(ready)`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/main/agent`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

Put the base-failed refusal in one small helper per tools file, called before `addVariation` / `addUsage`. In the two workflow docs, add a short step after "generate the sheet": read `check`. When it failed, rewrite the lock with positive, visible traits ("smooth eyeless brow plate", not "no visible eyes"; "a young woman" stated first) and regenerate, or ask the user. Never cast a failed sheet.

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run src/main/agent && npm run typecheck` (includes `workflow-docs.lint.test.ts` for the edited docs)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/agent resources/agent-docs/workflows
git commit -m "feat: the agent reads sheet checks and will not build on a failed base"
```

---

### Task 7: Check badge in the studios

**Files:**
- Modify: `src/renderer/src/components/characters/VariationGrid.tsx`, `src/renderer/src/components/items/UsageGrid.tsx`
- Create: `src/renderer/src/components/SheetCheckBadge.tsx` (shared by both grids)
- Test: `src/renderer/src/components/characters/CharacterStudio.test.tsx`, `src/renderer/src/components/items/ItemStudio.test.tsx`

**Interfaces:**
- Consumes: `Variation.check` / `ItemUsage.check` (Task 1).
- Produces: `SheetCheckBadge({ check }: { check: CheckResult | null })`:
  - for a failed sheet: `data-testid="sheet-check-failed"`, the text "Check failed", the issues in `title` (joined by `\n`) and as a list under the badge;
  - for a passed sheet: `data-testid="sheet-check-passed"` with the text "Checked";
  - for `null` or skipped: nothing.

- [ ] **Step 1: Write the failing tests**

- A character with a failed base shows `sheet-check-failed` and the issue text.
- A passed one shows `sheet-check-passed`.
- An unchecked one shows neither.
- The same three for an item usage.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/renderer/src/components`
Expected: FAIL.

- [ ] **Step 3: Implement**

Render the badge under each tile's status line. Use the existing CSS variables for danger and muted text (look at how the tiles show `failed` today and reuse those classes).

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run src/renderer/src/components && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components
git commit -m "feat: studios show each sheet's check"
```

---

### Task 8: Panel checklist identity items and the end-to-end test

**Files:**
- Modify: `resources/agent-docs/reference/consistency-checklist.md` (spec §11)
- Create: `tests/e2e/sheet-check.spec.ts`

**Interfaces:**
- Consumes: everything above. The default mock text model `mdl_000000000a` has the `vision` capability.

- [ ] **Step 1: Edit the checklist**

Make three edits:
- Item 2 gains the bullet `apparent gender and apparent age: they match the appearance lock;`.
- Major gains `a character reads as a different gender, or a clearly different age, than the appearance lock says;`.
- After the "(no reference image)" paragraph, add: `When a reference image and the appearance lock disagree, the lock wins: judge the panel against the lock.`

- [ ] **Step 2: Write the e2e test**

Name: `'a sheet that fails its check is flagged and warns when cast'`. Steps:
1. `launchApp({ script: { turns: [{ text: FAIL }, { text: FAIL }] } })`, where `FAIL = '{"passed": false, "issues": ["Mina reads as a man, but her lock says a young woman"]}'`.
2. Create a project and a session.
3. `api.invoke('models:assignRole', { role: 'vision', modelId: 'mdl_000000000a' })`.
4. Create the character Mina through the character form, the way `characters.spec.ts` does.
5. Expect `sheet-check-failed` to be visible and to contain "Mina reads as a man".
6. Open the panel editor, the way `items.spec.ts` does, cast Mina's Base, and save.
7. Expect the editor's warnings to contain `failed its sheet check`.
8. Read the character JSON with `readProjectJson` and assert `variations[0].check.passed === false`.

- [ ] **Step 3: Build and run it**

Run: `npm run build && npx playwright test tests/e2e/sheet-check.spec.ts tests/e2e/characters.spec.ts tests/e2e/items.spec.ts`
Expected: PASS (the existing specs did not regress).

- [ ] **Step 4: Commit**

```bash
git add resources/agent-docs/reference/consistency-checklist.md tests/e2e/sheet-check.spec.ts
git commit -m "test: a failed sheet check end to end; panels check gender and age"
```

---

### Task 9: Live run through the ChatGPT bridge (controller, not a subagent)

**Files (outside the repo):**
- `E:\claude\manhwa-benchmark\run\benchmark.spec.ts`: add an opt-in `SHEETS_ONLY=1` mode. In it, the spec stops after the four sheets. It records each sheet's `check` and the number of draws (taken from the run log or the image calls) in `manifest.json`.
- `E:\claude\manhwa-benchmark\results.md`: add a "Sheet check run" section.

- [ ] **Step 1:** Confirm the bridge is healthy: `curl -s http://127.0.0.1:7870/health` and `/bridge/status?refresh=1`. Confirm `run/node_modules` points at this worktree's `node_modules` (re-point the junction if it targets the main checkout). Then `npm run build` in the worktree.
- [ ] **Step 2:** Run in the background: `SHEETS_ONLY=1 npx playwright test -c run/playwright.config.ts`, with the endpoint `timeoutSeconds` at 600, as the seed script sets.
- [ ] **Step 3:** Look at the final Ara base sheet. **Pass:** she reads as a young woman and shows the scar through the right eyebrow. Record the checks and draws.
- [ ] **Step 4:** If she still reads as male after the redraws, do not change the checker. Instead, try one lock rewording ("Young woman, twenty-four" first; drop "sharp jaw"; add "feminine features"), re-run, and record both runs in `results.md`.
