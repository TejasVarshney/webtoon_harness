# Sheet Check — Design Spec

Extends `2026-10-21-webtoon-ai-harness-design.md` and `2026-11-02-item-maker-design.md`. Everything not said here works as
those specs say. Branch `feat/sheet-check`, cut from `feat/item-maker` (unmerged).

## 1. Requirement

From the manhwa benchmark (`E:\claude\manhwa-benchmark\results.md`, gap 1): Ara's lock says "Twenty-four-year-old woman",
but her base reference sheet came out male and without her scar. Every panel copied the sheet, and the panel checker, which
compares panels with their reference sheets, passed them all. A wrong sheet therefore always wins.

The fix: **check every generated reference sheet against its lock before it can be used**, and redraw it when it fails.

User decision: a sheet that still fails after the redraws **blocks the agent and warns in the editor** (the same split as
the mention guard).

## 2. Vocabulary

| Term | Meaning |
|---|---|
| **Sheet** | A reference image of a character variation (`Variation`) or an item usage (`ItemUsage`). The base sheet is the `base` variation or the `At rest` usage. |
| **Sheet check** | A vision call that judges one newly drawn sheet against its lock (and, for a non-base sheet, against the base sheet). Its result is a `CheckResult`, the same shape panels use. |
| **Failed sheet** | A sheet whose `check` is `{ passed: false, skipped: false }`. |

## 3. Behavior

1. **Checked on generation.** When a vision model is assigned, every generated sheet (base, variation, item base, state
   usage, action usage) is checked before it is recorded.
2. **Redrawn on failure.** A failed check redraws the sheet with `Important details: {issues joined by "; "}.` appended to its
   prompt, up to the project's `consistencyRetries` (default 1) times. Only the final image is kept.
3. **Never castable while checking.** The sheet stays `pending` through every draw and check. The final image and its check
   are recorded together in one locked step.
4. **Agent blocked, editor warns.** A failed sheet keeps its image and is `ready`. Casting it (or attaching the usage) is an
   error for the agent and a warning in the manual editor.
5. **No variation from a failed base.** The agent cannot generate a variation or a non-base usage while the base sheet has
   failed its check: variations copy the base's face and usages copy the base's shape.
6. **Unchecked is usable.** `check: null` (uploads, sheets made before this change, no vision model, a check that could not
   run is `skipped`) is never blocked or warned about.
7. **Panels check gender and age.** The panel checklist gains apparent gender and apparent age as Major identity items. When a
   reference sheet and the lock disagree, **the lock wins**.

## 4. Data model (`src/shared/schemas.ts`)

```
Variation  { …, check: CheckResult | null = null }
ItemUsage  { …, check: CheckResult | null = null }
```

- `CheckResultSchema` moves above the character section so both can use it (it is unchanged).
- Existing files have no `check` and parse as `null`.
- Marking a sheet `pending` leaves `check` as it is (a pending sheet cannot be cast anyway). The final record sets it to
  the last check, or `null` when there was none. An upload sets `check: null`. When the first draw fails, the sheet keeps
  its previous image **and its previous check**, so a failed regeneration neither blocks nor unblocks anything.

## 5. The sheet checker (`src/main/domain/consistency-checker.ts`)

A new method next to `check`:

```
checkSheet(ctx, input: SheetCheckInput): Promise<CheckResult | null>

SheetCheckInput {
  image: Buffer                       // the candidate, not yet on disk
  subject:
    | { kind: 'character'; character: Character; variation: Variation }
    | { kind: 'item'; item: Item; usage: ItemUsage }
  baseImageRelPath: string | null     // the base sheet, for a non-base sheet; null for a base sheet
  signal?: AbortSignal
}
```

- Same contract as `check`: null when no `vision` model is assigned; never throws (a model, image or doc problem is a
  skipped pass); the same timeout rule (Ruling T25c) and the same JSON parsing (`parseCheckResponse`).
- **Buffer seam:** the candidate is downscaled with `imageOps` (the same JPEG downscale `loadImageForTextModel` uses) and
  served to the provider's `loadImage` under a reserved key (`candidate://sheet`); the base sheet loads from disk as usual.
- System prompt: the new project doc **`reference/sheet-checklist`** (§6). The panel checklist is not reused: its gray-hands
  rule is the opposite of what an action usage sheet must show.
- `buildSheetCheckMessage(input)` (exported, pinned by tests):

  ```
  Images, in the order attached:
  1. Base reference: {character | item} {name}          ← only for a non-base sheet
  N. Generated sheet (the image to check)

  Sheet: {Character reference sheet | Item reference sheet | Item usage reference sheet}
  Subject: {name}
  Lock: {appearanceLock}
  Look: {variation.name} — {variation.delta}            ← character, non-base
  State: {usage.name} — {usage.delta}                   ← item, kind 'state'
  Usage: {usage.name} — {usage.delta}                   ← item, kind 'action'
  ```

## 6. `reference/sheet-checklist` (new doc in `resources/agent-docs/reference/`)

The checker's instructions. Same structure as `consistency-checklist`: what you receive, checklist, severity, retry
guidance, output format (`{"passed": …, "issues": [...]}`, at most 4 fixable issues of about 20 words, each written as the
plain visual description of what the sheet must show, never naming the wrong attribute that was drawn and never using meta words (lock, reference, fix, edit, original)).

**Character sheets.** Judge the main full-body figure:

1. Apparent gender and apparent age match the lock ("a twenty-four-year-old woman" must read as a young woman).
2. Hair color, length and style; eye color; skin tone; build.
3. Every distinguishing mark in the lock (scars, glasses, tattoos) is visible on the face or body where the lock puts it.
4. Outfit: the variation's look when it has a delta, else the lock's default outfit.
5. Non-base: face, hair, body and colors match the base reference except for what the look changes.

**Item sheets.** Shape, size, materials, colors and every marking in the lock. Non-base: identical to the base reference
except for the state or usage.

- **State and base sheets:** the object alone, no people, no hands.
- **Action usage sheets:** only plain gray hands and forearms, no face, body or clothing. Gray hands are **required** here,
  not a fault. The grip, the motion and the effect match the usage text.

**Every sheet:** no text, letters, numbers or watermarks; one subject (no second character or object).

**Major:** wrong apparent gender or clearly wrong age; wrong hair color or length, eye color or skin tone; a lock mark
missing; wrong outfit or clearly wrong colors; an item of a different shape, material or color, or a lock marking missing;
a person or skin-colored hands on an action sheet; hands on a base or state sheet; any text; a second subject.

**Minor (never fail a sheet for these):** several views on one sheet (turnarounds, back views, close-up insets of the face,
hands or details); which side a mark is on (left and right are easy to mirror: report a mark only when it is missing); the pose; the background shade; lighting; art quality; small folds and strands.

When unsure, Minor.

## 7. Generation flow (`CharacterService.generateVariationImage`, `ItemService.generateUsageImage`)

Ruling T15a is kept: mark pending under the lock, work outside it, record under the lock.

```
mark pending (check untouched)
attempt = 0; instruction = none
loop:
  draw (prompt + instruction)                       → failure on the first draw: record failed, keep previous image and check
                                                      failure on a redraw: stop, record the last candidate and its failed check
  check = sheetChecker?.checkSheet(candidate)        → null (no vision model) : stop with check null
  if check.passed or check.skipped or attempt == retries or signal aborted: stop
  attempt++; instruction = "Important details: …."     (none when issues is empty: a plain re-roll)
record the last candidate + its check (finish)
```

- `retries` is `consistencyRetries` read with the style preset at the start.
- The services get an optional `sheetChecker: Pick<ConsistencyChecker, 'checkSheet'>` (`services.ts` passes the one
  `ConsistencyChecker`). Without it nothing is checked.
- Failed candidates are never written to disk, so there is nothing to clean up. A crash mid-check leaves the sheet
  `pending`, which `recoverInterrupted` turns into `failed` as today.
- A non-base sheet whose base has failed its check: the services still generate it (the user may want it); the **agent
  tools** refuse it (§9).
- The prompt builders gain an optional `fix` argument appended at the end: `… {prompt} Important details: {issues}.`.
  Pinned in `reference/prompt-templates`.

## 8. The gate (`src/main/domain/panel-validation.ts`)

- New exported `sheetCheckFailure(sheet: Variation | ItemUsage): string[] | null` → the issues when failed, else null.
- `validatePanelDraft(…, opts: { strictMentions: boolean; strictSheets: boolean })`. For each cast entry and item entry
  whose sheet is ready but failed:
  - `Variation "{name}" of {character} failed its sheet check: {issues}. Regenerate it or ask the user.`
  - `Usage "{name}" of {item} failed its sheet check: {issues}. Regenerate it or ask the user.`
  
  It is an error when `strictSheets`, else a warning.
- `strictSheets` is true for every agent create and update (`panel-tools.ts`, `panel-chat-tools.ts`), false in the IPC
  handlers (the editor).
- **Grandfathering** (Ruling T18b): `grandfatherUnchangedCast` and `grandfatherUnchangedItems` also clear a failed check on
  an unchanged pair, so editing a panel's description does not suddenly block a cast it already had.

## 9. Agent

- `variationOutcome` and `usageOutcome` add `check` (`{ passed, issues, skipped }` or null) to their content. When the sheet
  failed, the content also says: `The sheet failed its check after the redraws. It cannot be cast until it passes:
  regenerate it, fix the lock, or ask the user.`
- `create_variation` / `regenerate_variation` (non-base) and `create_item_usage` / `regenerate_item_usage` (non-base)
  refuse with an error when the base sheet has failed its check: `The base sheet of {name} failed its check: {issues}.
  Regenerate the base first.`
- System-prompt snapshot: a failed sheet reads `(ready, check failed)` in place of `(ready)`.
- `list_characters` / `list_items` / `get_*`: each sheet adds `check: 'passed' | 'failed' | 'skipped' | null`, and the
  issues when failed.
- Workflow docs (`character-creation`, `item-creation`): after creating a sheet, read its check; on a failure, improve the
  lock (state positive, visible traits) and regenerate, or ask the user.

## 10. UI

- `VariationGrid` and `UsageGrid` tiles: a red **Check failed** badge with the issues in its tooltip and below the image;
  a small muted **Checked** mark when passed; nothing when unchecked or skipped.
- The panel editor shows the gate's warning in its existing warnings list. No new controls.
- Out of scope: a "re-check without regenerating" button. Uploads and older sheets stay unchecked until regenerated.

## 11. Panel checklist (`reference/consistency-checklist`)

- Item 2 (identity) gains: **apparent gender and apparent age match the appearance lock.**
- Major gains: **a character reads as a different gender, or a clearly different age, than the appearance lock says.**
- New rule under the checklist: **When the reference image and the appearance lock disagree, the lock wins.**

## 12. Testing

- Unit:
  - `buildSheetCheckMessage` for each sheet kind;
  - `checkSheet` with a stub provider: the buffer seam (the candidate reaches `loadImage`), null without a vision model,
    a skipped pass on errors and timeouts;
  - the loop in both services with a stub checker: pass first time; fail then pass (the second prompt carries the fix);
    fail every time (recorded `ready` with the failed check); skipped; draw failure keeps the previous check; still
    `pending` while the check runs; aborted;
  - the gate: error with `strictSheets`, warning without, grandfathering, unchecked and skipped are not reported;
  - agent tools: the refusal on a failed base, `check` in outcomes, the snapshot marker.
- Renderer: the badge and the mark.
- E2E (mock provider): a scripted failing check shows the badge; the editor warns when casting it.
- **Live** (ChatGPT bridge, `127.0.0.1:7870`, endpoint timeout 600): re-run the benchmark's sheets
  (`E:\claude\manhwa-benchmark\run`). Success is a final Ara base sheet that **reads as a young woman with the scar**,
  not only a failed check. If the redraw still comes out male, the next fix is the prompt or the lock wording (the lock's
  "narrow angular face, sharp jaw" pulls toward male), recorded in the benchmark results.

## 13. Decisions made without asking (please review)

1. Failed candidates are discarded, not kept as history (sheets have no versions, unlike panels).
2. The retry count reuses `consistencyRetries`; there is no separate setting.
3. The base-failed rule is enforced in the agent tools only; the studio still lets the user generate a variation.
4. Uploads are never checked: the user chose that image.
5. A check that could not run (`skipped`) counts as unchecked, as for panels.

## 14. Amendments after the live run

Seen (ChatGPT bridge, 2026-11-04): the checker detected the failures (Ara drawn as a man, a human beside the Rift Hound), but the redraw never happened. The suffix `Fix these issues: ...` read as an edit request, so ChatGPT asked for the original image and drew nothing. The checker also reported a scar on the wrong side, probably a left/right mirroring mistake.

Changed:

- The redraw instruction is now `Important details: {issues joined by "; "}.`, so it reads as a new drawing (§3.2, §7).
- Issues are written as requirements taken from the lock, never naming the wrong attribute drawn, because the image model copies the words it reads (§6).
- Which side a mark is on is Minor; a mark is reported only when it is missing (§6).
- The panel redraw instruction is unchanged.

Second live run: ChatGPT still treated the "Draw it fresh ..." redraw as an edit. Ara got "Please upload the reference image so I can make the requested version of Ara", and the Hound got a ChatGPT error. Two direct probes drew an image at once, with and without the name "Ara", when the suffix was plain description: ` Important details: Ara is clearly a young woman of twenty-four, with a feminine face and figure; a thin vertical scar crosses Ara's right eyebrow.` So the trigger is the meta words, not the name.

Changed again:

- The redraw instruction is now `Important details: {issues joined by "; "}.` (§3.2, §7). It is still absent for no issues.
- Issues are plain visual description, as if part of the drawing description; the words lock, reference, sheet check, earlier, original, fix, requirement, edit and "as ... says" are banned (§6).
