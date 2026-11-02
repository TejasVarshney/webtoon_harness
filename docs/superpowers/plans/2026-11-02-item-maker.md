# Item Maker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add recurring **items**, like characters, so a special object looks the same in every panel and is used the same way. Each way of using it is a named **usage** with its own reference image, generated when a panel first needs it.

**Architecture:** An `ItemService` (modeled on `CharacterService`) stores items with an appearance lock and usages (≈ variations). Panels gain `items: PanelItem[]`. The pieces that support this:
- validation checks the entries;
- prompt composition adds an `[ITEMS]` block and item references (cast → items → previous panel);
- the consistency checker judges them.

The agent gets item tools and a workflow doc, and the renderer gets an Items tab and an item picker in the panel editor.

**Tech Stack:** Electron + electron-vite, TypeScript, zod 4, React 19 + zustand, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-02-item-maker-design.md`. Read it first; the pinned prompt wording is in its §5.

## Global Constraints

- IDs: items are `itm_<10 hex>` and usages are `use_<10 hex>`, made with `newId`. Both prefixes are added to `ID_PREFIXES`.
- Schemas live in `src/shared/schemas.ts` and types come from `z.infer` in `src/shared/types.ts`. Input and patch schemas carry no `.default()`.
- Prompt strings are exactly spec §5, word for word. Every image prompt says "no text".
- Lock discipline is the same as `CharacterService` (Ruling T15a):
  - mark `pending` under the file lock;
  - generate outside it;
  - re-read and record under the lock;
  - never throw for a provider failure;
  - never let a failed image replace a ready one.
- Existing panel JSON without `items` must still parse (as `[]`). Existing prompt and checker output for panels without items must not change by a single character, because the lint test pins it.
- `npm test` and `npm run typecheck` pass at the end of every task.
- Branch `feat/item-maker` from the tip of `feat/endpoint-timeout`, not from `main`. Commit 873d2c6 is not on `main` yet and touches `consistency-checker.ts`, which Task 5 edits.
  - The first commit on the branch is this plan and its spec: `docs: item maker spec and plan`.
  - Commit after every task, and end each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A generic item name collides with prose.** An item named "Blaster" makes the strict mention guard reject "a guard draws his blaster". The error text must name `offPanelMentions` as the way out, and the doc must ask for distinctive names. Tested in Task 4.
2. **The item reference is dropped at the reference cap.** With 3 cast, 1 item and the previous panel at cap 4, the previous panel is dropped and the item kept. With cap 3, the item reads `(no reference image)` but its lock is still in the prompt. Tested in Task 5.
3. **Gray hands leak into the panel.** The `[ITEMS]` header forbids drawing gray hands, and the checklist makes "gray hands or a featureless figure appear" Major. The header is tested in Task 5 and the checklist text in Task 8.
4. **A patch removes the item's holder from the cast.** `update_panel` that drops Mina from `characters` while `items[0].heldBy` is Mina is rejected with "held by Mina, who is not in the cast". Tested in Task 4 (validation) and Task 6 (through `update`).
5. **A usage that panels use is deleted, or its regeneration fails later.** Delete is refused with `ItemInUseError`. A panel whose usage is no longer ready stays editable through the same grandfathering as cast. Tested in Task 3 and Task 6.

---

### Task 1: Item data model, ids, paths, event

**Files:**
- Modify: `src/shared/schemas.ts`, `src/shared/types.ts`, `src/shared/ids.ts`, `src/main/storage/project-paths.ts`, `src/main/test/factories.ts`
- Test: `src/shared/schemas.test.ts`, `src/shared/ids.test.ts`, `src/main/storage/project-paths.test.ts`

**Interfaces:**
- Produces, in schemas:
  - `ItemUsageKindSchema` (`'base' | 'state' | 'action'`)
  - `ItemUsageSchema`, `ItemSchema`, `ItemInputSchema`, `ItemPatchSchema`
  - `ItemUsageInputSchema`, where `kind` is `ItemUsageKindSchema.exclude(['base'])`
  - `PanelItemSchema`
  - `PanelSchema.items`, which is `z.array(PanelItemSchema).default([])`
  - `PanelDraftSchema.items`, which is `z.array(PanelItemSchema).optional()`
- Produces, in types: `Item`, `ItemUsage`, `ItemInput`, `ItemPatch`, `ItemUsageInput`, `ItemUsageKind`, `PanelItem`, and the `AppEvent` member `{ type: 'item.changed'; projectId: string; itemId: string }`.
- Produces, in `ProjectPaths`: `itemsDir()`, `itemFile(id)` (`items/<id>.json`) and `itemDir(id)` (`items/<id>`). The id-taking methods validate with `checkedId`.
- Produces, in factories: `makeItem(o?)` and `makeItemUsage(o?)`, following `makeCharacter` and `makeVariation`. `makeItem` gives one base usage named `At rest`.

- [ ] **Step 1: Write the failing tests**

```ts
// schemas.test.ts
it('parses an item with defaults and a base usage', () => {
  const item = ItemSchema.parse({ id: 'itm_0000000001', name: 'Kestrel blaster', appearanceLock: 'L', createdBy: 'ai', createdAt: 't', updatedAt: 't',
    usages: [{ id: 'use_0000000001', itemId: 'itm_0000000001', name: 'At rest', kind: 'base', status: 'pending', createdBy: 'ai', createdAt: 't' }] })
  expect(item).toMatchObject({ aliases: [], ownerId: null, notes: '', archived: false })
  expect(item.usages[0]).toMatchObject({ delta: '', imagePath: null, error: null })
})
it('reads a panel file written before items existed', () => expect(PanelSchema.parse(panelJsonWithoutItems).items).toEqual([]))
it('defaults a panel item', () => expect(PanelItemSchema.parse({ itemId: 'itm_1', usageId: 'use_1' })).toEqual({ itemId: 'itm_1', usageId: 'use_1', heldBy: null, action: '' }))
it('refuses a second base usage on input', () => expect(ItemUsageInputSchema.safeParse({ name: 'x', kind: 'base', delta: '' }).success).toBe(false))
it('item patch fills no defaults', () => expect(ItemPatchSchema.parse({ name: 'X' })).toEqual({ name: 'X' }))
// ids.test.ts: the expected prefix list gains 'itm', 'use' at the end
// project-paths.test.ts
it('places items', () => {
  expect(paths.itemFile('itm_0000000001')).toBe(path.join(root, 'items', 'itm_0000000001.json'))
  expect(() => paths.itemDir('../x')).toThrow(PathEscapeError)
})
```

- [ ] **Step 2: Run them to verify they fail.** Run `npx vitest run src/shared src/main/storage/project-paths.test.ts`. Expected: FAIL, because `ItemSchema` and `itemFile` do not exist.
- [ ] **Step 3: Implement the schemas, types, prefixes, paths and factories listed in Interfaces.** Put the item schemas in a new `// Items` section right after `// Characters`. Use the `text()` helper for the string defaults.
- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Expected: PASS. If an exhaustive `switch` on `AppEvent` fails to compile, add an `item.changed` case that does nothing; Task 10 fills it.
- [ ] **Step 5: Commit** with `feat: item and usage schemas, ids and paths`.

---

### Task 2: Item reference prompts

**Files:**
- Modify: `src/main/domain/prompts.ts`
- Test: `src/main/domain/prompts.test.ts`

**Interfaces:**
- Produces:
  - `itemReferencePrompt(item: Item, stylePreset: string): string`
  - `itemUsagePrompt(item: Item, usage: ItemUsage, stylePreset: string): string`
- The usage prompt picks the state wording or the action wording by `usage.kind`.

- [ ] **Step 1: Write the failing tests.** Their expected strings are spec §5 copied verbatim:

```ts
it('item base prompt', () => expect(itemReferencePrompt(makeItem({ appearanceLock: 'LOCK' }), 'STYLE')).toBe(
  'Item reference sheet. STYLE. The object alone, three-quarter view, centered, plain light-gray background, even studio lighting, no people, no hands, no text. LOCK'))
it('state usage prompt', () => expect(itemUsagePrompt(makeItem({ appearanceLock: 'LOCK' }), makeItemUsage({ kind: 'state', name: 'Folded', delta: 'barrel folded back' }), 'STYLE')).toBe(
  'Item reference sheet. STYLE. The object alone, three-quarter view, plain light-gray background, no people, no hands, no text. LOCK State: Folded — barrel folded back. Keep shape, size, materials, colors and markings identical to the reference image except for the state.'))
it('action usage prompt shows hands only', () => expect(itemUsagePrompt(makeItem({ appearanceLock: 'LOCK' }), makeItemUsage({ kind: 'action', name: 'Firing', delta: 'cyan beam' }), 'STYLE')).toBe(
  'Item usage reference sheet. STYLE. Plain light-gray background, no text. LOCK Usage: Firing — cyan beam. Show only plain gray hands and forearms, cropped at the elbow, with no face, body, clothing or jewelry, so the sheet shows only the grip, the motion and the effect. Keep shape, size, materials, colors and markings identical to the reference image.'))
```

- [ ] **Step 2: Run `npx vitest run src/main/domain/prompts.test.ts`.** Expected: FAIL, because the functions are not exported.
- [ ] **Step 3: Implement both functions** next to `variationPrompt`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: item reference prompts`.

---

### Task 3: ItemService and wiring

**Files:**
- Create: `src/main/domain/item-service.ts`
- Modify: `src/main/services.ts`, `src/main/test/test-services.ts` (only if it builds services by hand)
- Test: `src/main/domain/item-service.test.ts`

**Interfaces:**
- Consumes: `ImageService.generate`, `ProjectStore.getMeta`, the Task 1 paths and schemas, and the Task 2 prompts.
- Produces:
  - `class ItemService` with constructor options `{ bus, images, projects, usage: ItemUsageLookup, trash }`.
  - Its methods follow `CharacterService` one for one:
    - `list(ctx, { includeArchived? })`, `get(ctx, id)`
    - `create(ctx, input: ItemInput, createdBy, { generate? })`
    - `update(ctx, id, patch: ItemPatch): Promise<{ item: Item; appearanceLockChanged: boolean }>`
    - `archive`, `unarchive`, `delete`
    - `addUsage(ctx, itemId, input: ItemUsageInput, createdBy, { generate? }): Promise<ItemUsage>`
    - `generateUsageImage(ctx, itemId, usageId, { signal? }): Promise<ItemUsage>`
    - `uploadUsageImage(ctx, itemId, usageId, data, ext)`, `deleteUsage(ctx, itemId, usageId)`
    - `recoverInterrupted(ctx)`
  - `interface ItemUsageLookup { panelsUsingItem(ctx, itemId): Promise<string[]>; panelsUsingItemUsage(ctx, usageId): Promise<string[]> }`
  - Error classes:
    - `DuplicateItemError` (`An item named "X" already exists`)
    - `DuplicateUsageError(itemName, usageName)` (`X already has a usage named "Firing": use that one`)
    - `ItemInUseError(panelIds, what = 'item')` (`This item is used by N panel(s): … Archive it instead.`)
  - `Services.items: ItemService`

How it differs from `character-service.ts` (copy its structure and rulings, change only this):
- Files live in `itemsDir()` and match `/^itm_[A-Za-z0-9]+\.json$/`. Images go to `items/<itemId>/<usageId>_<6 hex>.<ext>`.
- `create` makes one base usage `{ name: 'At rest', kind: 'base', delta: '' }`.
- `addUsage` runs under the item file lock and refuses a usage name already on the item, compared trimmed and case-insensitive, with `DuplicateUsageError`.
- The base image uses `itemReferencePrompt` with no references. A non-base usage uses `itemUsagePrompt` with `[{ relPath: base.imagePath, label: 'item base reference' }]`. Both use aspect `'1:1'`. A non-ready base gives the failure `'Base reference image is not ready'`.
- It emits `item.changed`.
- Wiring in `services.ts`:
  - build it after `characters`, with a lazy `ItemUsageLookup` that calls `services.panels.panelsUsingItem` and `panelsUsingItemUsage` (Task 6 adds those methods; until then, have the lazy closures return `[]`);
  - register `projects.addHooks({ onOpen: (ctx) => items.recoverInterrupted(ctx) })`;
  - add `items` to the services object.

- [ ] **Step 1: Write the failing tests.** Use the `setup()` harness of `character-service.test.ts`: a temp project, a stub `ImageService` that records requests, a stub usage lookup and a trash list.

```ts
it('creates an item with a pending At rest usage and generates it from the lock alone')
  // calls[0].prompt === itemReferencePrompt(item, meta.stylePreset); calls[0].references == []; usage becomes ready with imagePath under items/<id>/
it('generates an action usage from the base image')
  // calls[1].references == [{ relPath: base.imagePath, label: 'item base reference' }]; prompt contains 'Show only plain gray hands'
it('refuses a duplicate usage name, case-insensitively')        // addUsage 'firing' after 'Firing' rejects DuplicateUsageError
it('fails a usage whose base is not ready, keeping no image')   // status 'failed', error 'Base reference image is not ready'
it('keeps the previous image when regeneration fails')         // gen throws ProviderError; imagePath unchanged; status failed
it('refuses to delete an item or a usage that panels use')      // lookup returns ['pnl_1'] -> ItemInUseError, nothing trashed
it('refuses to delete the base usage')
it('refuses a duplicate item name and allows it once the other is archived')
it('fails pending usages on recoverInterrupted')                // error 'Interrupted: the app closed during generation'
it('reports an item file whose id does not match its name in ctx.problems and skips it')
it('is wired: services.items exists and recovers on project open')   // in services.test.ts
```

- [ ] **Step 2: Run `npx vitest run src/main/domain/item-service.test.ts`.** Expected: FAIL, because the module is missing.
- [ ] **Step 3: Implement `item-service.ts` and the wiring** as described above.
- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: item service with usages and reference images`.

---

### Task 4: Panel validation for items

**Files:**
- Modify: `src/main/domain/panel-validation.ts`
- Test: `src/main/domain/panel-validation.test.ts`

**Interfaces:**
- Changes `PanelDraftFields` to `Pick<PanelDraft, 'description' | 'characters' | 'dialogue' | 'offPanelMentions' | 'items'>`.
- Changes `validatePanelDraft(draft, roster: Character[], itemRoster: Item[], opts)`. The new third parameter comes before `opts`. Update the existing callers in `panel-service.ts` to pass the item roster: `[]` for now, and Task 6 passes the real one.
- Produces `hasReadyUsage(usage: ItemUsage)`, with the same rule as `hasReadyReference`.
- Changes `findUnattachedMentions` to take `Mentionable[]`, where `type Mentionable = { id: string; name: string; aliases: string[]; archived: boolean }`. `Character` and `Item` both satisfy it, so the body does not change.

Error messages, appended after the dialogue speaker errors and before the mention guard, in item order:
- `Unknown item: ${itemId}`
- `Item ${name} is archived`
- `${name} is attached twice`
- `Usage ${usageId} does not belong to ${name}`
- `Usage "${usage.name}" of ${name} has no ready reference image`
- `${name} is held by ${holderName ?? heldBy}, who is not in the cast`

Mention guard for items, using the same strict/warning switch as for characters: `Item mentioned but not attached: ${names}. Attach it to items, or list it in offPanelMentions if it is only talked about.`

- [ ] **Step 1: Write the failing tests:**

```ts
it('accepts a ready usage held by a cast member')
it('reports an unknown item, an archived item, a foreign usage and a usage with no ready image', () =>
  expect(check.errors).toEqual(['Unknown item: itm_x', 'Item Kestrel blaster is archived', ...]))
it('rejects an item held by someone outside the cast', () =>
  expect(errors).toContain('Kestrel blaster is held by Mina, who is not in the cast'))
it('rejects the same item attached twice')
it('guards item names: strict for the agent, a warning for the editor', () => {
  // description 'Mina raises the Kestrel blaster', items: []
  expect(strict.errors).toContain('Item mentioned but not attached: Kestrel blaster. Attach it to items, or list it in offPanelMentions if it is only talked about.')
  expect(lenient.warnings).toHaveLength(1)
})
it('accepts an item listed in offPanelMentions by alias')
it('keeps the old messages for a panel without items')   // existing fixture -> identical errors/warnings to before
```

- [ ] **Step 2: Run `npx vitest run src/main/domain/panel-validation.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: validate panel items and guard item mentions`.

---

### Task 5: Panel prompt, edit prompt and checker message with items

**Files:**
- Modify: `src/main/domain/prompts.ts`, `src/main/domain/consistency-checker.ts`
- Test: `src/main/domain/prompts.test.ts`, `src/main/domain/consistency-checker.test.ts`, `src/main/agent/workflow-docs.lint.test.ts` (call sites only)

**Interfaces:**
- Produces `type ReferenceSubject = { kind: 'character'; id: string } | { kind: 'item'; id: string } | { kind: 'previous' }`.
- `PanelPromptReference` gains `subject: ReferenceSubject`, alongside `relPath` and `label`. An item's label is the item name.
- `PanelPromptInput` changes:
  - `panel` picks `'items'` too;
  - it adds `itemRoster: Map<string, Item>`;
  - `roster` (characters) also resolves `heldBy` names.
- `composePanelPrompt`:
  - pushes references in the order cast, then items, then previous;
  - emits the `[ITEMS]` block of spec §5 after the cast lines, only when `panel.items.length > 0`;
  - writes `Held by: nobody.` when `heldBy` is null and omits `Action:` when it is blank;
  - writes `Use: ${name}` with no ` — ` when `delta` is empty.
- `editPanelPrompt(instruction, cast, items: { name: string; appearanceLock: string }[] = [])`: when `items` is non-empty, it inserts ` and keep these items on-model: ${items.map(i => `${i.name}: ${i.appearanceLock}`).join(' ')}` just before ` No text`. The output with no items is unchanged.
- `ConsistencyCheckInput.references` is retyped from `{ relPath; label }[]` to `PanelPromptReference[]`, and the input gains `itemRoster: Item[]`. `buildCheckMessage`:
  - decides "has a reference" by `subject` (kind and id), not by label;
  - after the `Cast:` block, when the panel has items, adds a blank line, then `Items:`, then `- ${name} — ${lock} — Use: ${look} — Held by: ${holder | nobody}` with ` (no reference image)` when that item's reference was not sent.

  The output for a panel without items is unchanged.
- Update every existing test call site:
  - give each reference literal a `subject`;
  - pass `itemRoster: new Map()` or `[]`;
  - add `items: []` where a `panel` literal is typed.

- [ ] **Step 1: Write the failing tests:**

```ts
it('adds an [ITEMS] block after the cast and an item reference before the previous panel', () => {
  const { prompt, references } = composePanelPrompt({ ...base, panel: { ...panel, items: [{ itemId: blaster.id, usageId: firing.id, heldBy: mina.id, action: 'aimed at the door' }] }, itemRoster })
  expect(references.map((r) => r.subject)).toEqual([{ kind: 'character', id: mina.id }, { kind: 'item', id: blaster.id }, { kind: 'previous' }])
  expect(prompt).toContain('[ITEMS] Draw each item exactly as its reference image shows it, and use it exactly as its reference shows. Gray hands in an item reference only show the grip: draw the holder\'s own hands, never gray hands.')
  expect(prompt).toContain('- Kestrel blaster (reference image 2): BLOCK Use: Firing — cyan beam. Held by: Mina. Action: aimed at the door.')
})
it('drops the previous panel before an item, and an item before the cast', () => {
  // 3 cast + 1 item + previous, maxReferences 4 -> subjects: 3 characters + item, no previous
  // same with maxReferences 3 -> item line reads '(no reference image)' and still contains its lock
})
it('leaves a panel without items exactly as before')   // existing snapshot/expectation unchanged
it('keeps items on-model in an edit', () => expect(editPanelPrompt('x', [], [{ name: 'Kestrel blaster', appearanceLock: 'BLOCK' }])).toContain('keep these items on-model: Kestrel blaster: BLOCK No text'))
it('lists items for the checker and matches references by subject, not label')
  // a character and an item both named 'Nova': the item line has no '(no reference image)' when its reference was sent, and the character line is correct too
```

- [ ] **Step 2: Run `npx vitest run src/main/domain`.** Expected: the new tests FAIL.
- [ ] **Step 3: Implement it, and update the call sites in tests** (including `workflow-docs.lint.test.ts`), so the existing verbatim template tests still pass unchanged.
- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Expected: PASS. `panel-service.ts` compiles by passing `itemRoster: new Map()` and `[]` for now.
- [ ] **Step 5: Commit** with `feat: items in panel prompts, edits and the consistency check message`.

---

### Task 6: PanelService uses items

**Files:**
- Modify: `src/main/domain/panel-service.ts`, `src/main/services.ts`
- Test: `src/main/domain/panel-service.test.ts`

**Interfaces:**
- Consumes `ItemService.list(ctx, { includeArchived: true })` from Task 3, plus Task 4 and Task 5.
- `PanelServiceOptions` gains `items: ItemService`.
- `PanelService` gains:
  - `panelsUsingItem(ctx, itemId): Promise<string[]>`, which matches `p.items.some(i => i.itemId === itemId)`;
  - `panelsUsingItemUsage(ctx, usageId): Promise<string[]>`.

  Point the lazy lookup from Task 3 at these.
- `create` and `update` validate against the item roster. `update` merges `items: patch.items ?? current.items`. A new `grandfatherUnchangedItems(itemRoster, stored, next)` mirrors `grandfatherUnchangedCast`: unchanged `itemId/usageId` pairs read as active and ready.
- `create` stores `items: draft.items ?? []`.
- `draw` passes `itemRoster` to `composePanelPrompt`. `DrawContext` gains `itemRoster: Item[]` and hands it to the checker.
- `editImage` passes the panel's items, as `{ name, appearanceLock }`, to `editPanelPrompt`, and their references come from `composePanelPrompt` as the cast's already do.

- [ ] **Step 1: Write the failing tests:**

```ts
it('draws a panel with its item reference and [ITEMS] block')        // images stub sees references [mina, blaster]; prompt contains '[ITEMS]'
it('rejects create with an item usage that has no ready image')
it('rejects an update that removes the holder from the cast', () =>
  expect(update(...{ characters: [] })).rejects.toThrow('Kestrel blaster is held by Mina, who is not in the cast'))
it('keeps a panel editable after its item is archived or its usage regeneration failed')   // grandfathering
it('lists panels using an item and a usage, and ItemService.delete is refused through services')
it('passes items to the checker and keeps them on-model in an edit')
```

- [ ] **Step 2: Run `npx vitest run src/main/domain/panel-service.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: panels attach items and draw them from their usage references`.

---

### Task 7: Item agent tools and the item-creation doc

These ship together because the doc lint test requires every tool to be in the AGENTS Tool Catalog.

**Files:**
- Create: `src/main/agent/tools/item-tools.ts`, `resources/agent-docs/workflows/item-creation.md`
- Modify:
  - `src/main/agent/tools/index.ts`
  - `src/main/agent/tools/panel-tools.ts`: the `create_panel` and `update_panel` input descriptions
  - `resources/agent-docs/AGENTS.md`: the Tool Catalog, Workflow Docs Index, Operating Loop and Failure Handling
  - `src/main/agent/workflow-docs.lint.test.ts`: the `REQUIRED` map
  - `src/main/agent/tools/panel-tools.test.ts`: the tool-order test slices `names().slice(6, -5)`, which becomes `slice(12, -5)` once the item tools sit at indexes 6–11. Update its comment and the `arrayContaining` list.
- Test: `src/main/agent/tools/item-tools.test.ts`, `src/main/agent/workflow-docs.lint.test.ts`

**Interfaces:**
- Produces `itemTools: ToolDefinition[]`, in this order:
  - `list_items`, `get_item`
  - `create_item` (input `ItemInputSchema` extended with `generateBaseImage?`)
  - `update_item` (`{ itemId, patch: ItemPatchSchema }`; it warns on a lock change like `update_character`)
  - `create_item_usage` (`{ itemId, name, kind: 'state' | 'action', delta, generateImage? }`)
  - `regenerate_item_usage` (`{ itemId, usageId }`)
- `buildAgentTools` puts `itemTools` after `characterTools`.
- Tool errors are `Unknown item: <id>` and `Unknown usage: <id>`. `DuplicateItemError` and `DuplicateUsageError` become a `ToolError` with the service message.
- `create_item` validates `ownerId` with `characters.get` and rejects an unknown one with `Unknown character: <id>`.
- `create_panel` gets an `items` description: "Items shown in the panel: itemId, a usageId with a ready image, heldBy (a cast member's id or null), action. An item named in the description must be attached or listed in offPanelMentions."
- `item-creation.md` has these sections, each of which goes in `REQUIRED['workflows/item-creation']`:
  - `Purpose`
  - `Item Sheet`
  - `Writing the Item Lock`: 25 to 70 words, fixed order (overall shape and size compared with a hand, materials, colors, markings, lights/glow, distinctive parts); no text, no brand logos with letters
  - `Base Reference Image`
  - `Usages`: state vs action; the delta names grip, motion and visible effect
  - `Reusing Usages`: list the item's usages first, reuse one whose action matches, and never create "Shooting" when "Firing" exists
  - `When to Create an Item`: it recurs, or its exact look or use matters; distinctive names
  - `Using Items in Panels`: heldBy; keep the cast to 2 when the item matters, because of the reference cap
  - `Examples`: real tool calls the lint test validates

  The examples must include `create_item`, `create_item_usage` and a `create_panel` with `items`.
- AGENTS Operating Loop gets one step: before drawing a panel where a roster item is used, check its usages and create the missing usage first. Failure Handling gets rows for:
  - `Unknown item`
  - `Item mentioned but not attached`
  - `Usage "…" of … has no ready reference image`
  - `… is held by …, who is not in the cast`
  - `already has a usage named`

- [ ] **Step 1: Write the failing tests:**

```ts
it('are part of the agent tool set, right after the character tools', () =>
  expect(buildAgentTools({ vision: false }).names().slice(6, 12)).toEqual(['list_items', 'get_item', 'create_item', 'update_item', 'create_item_usage', 'regenerate_item_usage']))
it('create_item generates the base image and returns it', async () => {
  const r = await run('create_item', { name: 'Kestrel blaster', appearanceLock: 'BLOCK' })
  expect(json(r)).toMatchObject({ baseStatus: 'ready' }); expect(r.images).toHaveLength(1)
})
it('create_item_usage refuses a duplicate name and names the existing usage', async () =>
  expect((await run('create_item_usage', { itemId, name: 'firing', kind: 'action', delta: 'x' })).content).toContain('already has a usage named "Firing"'))
it('create_item rejects an unknown ownerId')
it('a mangled id reads Unknown item')
// lint: REQUIRED gains 'workflows/item-creation'; existing lint tests (catalog, example calls, real tools) cover the rest
```

- [ ] **Step 2: Run `npx vitest run src/main/agent`.** Expected: FAIL. The tools are missing, and once they exist the catalog lint fails until the docs are written.
- [ ] **Step 3: Implement the tools and write the docs.**
- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Expected: PASS, including every `workflow-docs.lint.test.ts` case.
- [ ] **Step 5: Commit** with `feat: item tools and the item-creation workflow doc`.

---

### Task 8: Items in agent context, side chat and reference docs

**Files:**
- Modify:
  - `src/main/agent/system-prompt.ts`
  - `src/main/agent/agent-runner.ts`: `gatherState`
  - `src/main/agent/tools/panel-chat-tools.ts`: `fieldsView`, `neighborView`, `loadPanelBundle`
  - `src/main/agent/panel-chat.ts`
  - `resources/agent-docs/workflows/panel-generation.md`
  - `resources/agent-docs/reference/prompt-templates.md`
  - `resources/agent-docs/reference/consistency-checklist.md`
  - `src/main/agent/workflow-docs.lint.test.ts`
- Test: `src/main/agent/system-prompt.test.ts`, `src/main/agent/tools/panel-chat-tools.test.ts`, `src/main/agent/workflow-docs.lint.test.ts`

**Interfaces:**
- `StateSnapshotInput` gains `items: Item[]`. After the characters block, `buildStateSnapshot` writes `items: none`, or `items:` followed by `- ${id} ${name} usages: ${usageId} ${name} (${status}), …` for each non-archived item.
- `panelSummary` appends ` items: ${name} (${usageName})…` only when the panel has items.
- `PanelBundle` gains `itemRoster: Item[]`. `buildPanelContext(panel, roster, itemRoster, prev, next)` and `fieldsView` show `items: [{ itemId, name, usageName, heldBy }]`.
- The side chat's `patchInput` in `panel-chat-tools.ts` already inherits `items` from `PanelPatchSchema`. Give it a `.describe(...)`: "Items in the panel (itemId, a ready usageId, heldBy a cast member or null, action), replacing the whole list. Removing a cast member who holds an item is rejected: change heldBy too."
- Docs:
  - `panel-generation.md` gets a section `## Attaching Items`, added to `REQUIRED`. It covers usage choice, `heldBy`, and the reference order and cap.
  - `prompt-templates.md` gets `## Item Reference Prompt`, `## Item Usage Prompt` (both kinds) and, in the existing Panel Prompt and Consistency Check Prompt sections, an "with items" example. All of these go in `REQUIRED`.
  - `consistency-checklist.md`:
    - a checklist item **Items, per item**: shape, colors and markings match its reference; the usage (grip, motion, effect) matches its usage text; held by the named holder;
    - Major entries: the item's look clearly differs, the usage or effect differs (for example the wrong beam color), the item is missing, or "gray hands or a featureless gray figure appear".
- Lint additions:
  - extend "reproduce the prompt builders verbatim" with `itemReferencePrompt` and `itemUsagePrompt` (state and action) built from `{placeholders}`;
  - add a with-items `composePanelPrompt` and `buildCheckMessage` to the verbatim checks.

- [ ] **Step 1: Write the failing tests:**

```ts
it('lists items and their usages in project_state', () =>
  expect(buildStateSnapshot({ ...input, items: [blaster] })).toContain('- itm_0000000001 Kestrel blaster usages: use_0000000001 At rest (ready), use_0000000002 Firing (ready)'))
it('says items: none without items')
it('the panel side chat sees the panel items')   // get_panel_context-style tool output has items[0].usageName === 'Firing'
it('the checklist makes gray hands Major', () => expect(extractSection(read('reference/consistency-checklist'), 'Severity')).toContain('gray hands'))
it('prompt templates reproduce the item prompt builders verbatim')
```

- [ ] **Step 2: Run `npx vitest run src/main/agent`.** Expected: FAIL.
- [ ] **Step 3: Implement it and write the doc sections.**
- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: items in project state, panel side chat and reference docs`.

---

### Task 9: Item IPC channels

**Files:**
- Create: `src/main/ipc/handlers/items.ts`
- Modify: `src/shared/ipc.ts`, `src/main/ipc/register.ts`
- Test: `src/main/ipc/handlers/items.test.ts`, `src/main/ipc/register.test.ts` (the existing "every channel" test covers registration)

**Interfaces:**
- Channels mirror `characters:*` exactly, with `itemId` and `usageId` in place of `characterId` and `variationId`:
  - `items:list`, `items:get`
  - `items:create` (`{ projectId, input: ItemInput, generateBase: boolean }`)
  - `items:update`, `items:archive`, `items:unarchive`, `items:delete`
  - `items:addUsage` (`{ …, input: ItemUsageInput, generate: boolean }`)
  - `items:generateUsage`, `items:deleteUsage`
  - `items:uploadUsageImage` (returns `ItemUsage | null`)
- Every channel is added to `channelSet`.
- `itemsHandlers(s, { pickFiles })` follows `charactersHandlers`:
  - parses inputs with the schemas;
  - runs generation in the background, with `=== true` for the flags;
  - checks that the usage exists before opening the dialog.

- [ ] **Step 1: Write the failing tests.** They follow `characters.test.ts`: create without generation gives a failed base with `NO_IMAGE_YET`, create with generation goes pending then ready after the event, `addUsage` with `kind: 'base'` is rejected, a cancelled upload returns `null`, and delete in use is rejected.
- [ ] **Step 2: Run `npx vitest run src/main/ipc src/shared/ipc.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: item IPC channels`.

---

### Task 10: Items store and Items tab

**Files:**
- Create:
  - `src/renderer/src/stores/items-store.ts`
  - `src/renderer/src/components/items/ItemStudio.tsx`, `ItemCard.tsx`, `ItemForm.tsx`, `UsageGrid.tsx`, `UsageForm.tsx`
  - `src/renderer/src/test/item-fixtures.ts`
- Modify:
  - `src/renderer/src/stores/app-store.ts`: `RightTab` gains `'items'`
  - `src/renderer/src/components/layout/RightPane.tsx`: a tab `{ id: 'items', label: 'Items', testId: 'tab-items', icon: Package }` after Characters
  - `src/renderer/src/events.ts`: `item.changed` triggers `useItemsStore.getState().load()`
  - `src/renderer/src/styles.css`: reuse the `character-*` classes where possible, and add only what differs
- Test: `src/renderer/src/stores/items-store.test.ts`, `src/renderer/src/components/items/ItemStudio.test.tsx`, `src/renderer/src/components/layout/RightPane.test.tsx`

**Interfaces:**
- `useItemsStore` mirrors `useCharactersStore`. Its fields are `projectId`, `items`, `loaded`, `error`, `selectedId`. Its actions are `load`, `select`, `create`, `update`, `archive`, `unarchive`, `remove`, `addUsage`, `generateUsage`, `deleteUsage` and `uploadUsageImage`, with the same latest-load guard.
- `ItemForm` fields:
  - name, aliases;
  - owner: a select of the non-archived characters from `useRoster()`, plus "Nobody";
  - notes;
  - appearance lock, with a live word count hint "25–70 words".
- `UsageForm` fields are name, kind (State or Action) and "How it is used / what changes" (`delta`).
- `UsageGrid` shows each usage's image, status and error, with Regenerate, Upload and Delete; Delete is hidden for the base usage. It reuses `ConfirmButton`, `Field` and `errorText` from `components/characters/controls.tsx`.
- Test ids:
  - `item-card`
  - `item-form-name`, `item-form-lock`, `item-form-save`
  - `usage-card`, `usage-add`
- Empty-state copy: "No items yet. Create one, or ask the agent to."

- [ ] **Step 1: Write the failing tests.** They follow `CharacterStudio.test.tsx` with `installFakeApi`:
  - the grid lists active items and hides archived ones until "Show archived";
  - creating an item calls `items:create` with `generateBase: true`;
  - adding an action usage calls `items:addUsage` with `{ kind: 'action', delta }`;
  - a failed usage shows its error and a Regenerate that calls `items:generateUsage`;
  - an `item.changed` event reloads the list;
  - RightPane renders `tab-items` and switches to the Items tab.
- [ ] **Step 2: Run `npx vitest run src/renderer`.** Expected: FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: Items tab with usages`.

---

### Task 11: Item picker in the panel editor

**Files:**
- Create: `src/renderer/src/components/visualizer/ItemPicker.tsx`, plus `src/renderer/src/components/visualizer/use-item-roster.ts`, which mirrors `use-roster.ts`
- Modify: `src/renderer/src/components/visualizer/PanelEditorDialog.tsx`
- Test: `src/renderer/src/components/visualizer/PanelEditorDialog.test.tsx`

**Interfaces:**
- Signature: `ItemPicker({ items: Item[]; cast: PanelCharacter[]; characters: Character[]; value: PanelItem[]; onChange(next: PanelItem[]): void })`.
- Each row has:
  - an item select: non-archived items, plus the row's own item if it was archived;
  - a usage select: ready usages, plus the row's stale one labeled `(not ready)`, as `CastPicker` does;
  - a "Held by" select: the current cast plus "Nobody";
  - an action input;
  - Remove.
- "Add item" defaults:
  - the first unattached item that has a ready usage;
  - its base usage if ready;
  - `heldBy` = its `ownerId` if that character is in the cast, else null.
- When a cast row is removed, rows held by that character switch to null, so the form never sends an invalid holder.
- `PanelEditorDialog`:
  - `values.items` is loaded from `panel.items`, and `[]` for a new panel;
  - it goes in the draft on create, and in the patch only when it changed, using the same `same()` diff as `characters`;
  - saving is disabled while a row has an empty `usageId`, like `castReady`.

- [ ] **Step 1: Write the failing tests:**
  - creating a panel with an item sends `draft.items` `[{ itemId, usageId, heldBy: mina.id, action: 'aims' }]`;
  - editing only the action sends `patch.items` and no other field;
  - removing Mina from the cast resets the item's held-by to Nobody;
  - an archived item on an existing row shows as `Kestrel blaster (archived)`.
- [ ] **Step 2: Run `npx vitest run src/renderer/src/components/visualizer`.** Expected: FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run `npm test` and `npm run typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** with `feat: attach items in the panel editor`.

---

### Task 12: End-to-end check

**Files:**
- Create: `tests/e2e/items.spec.ts`
- Modify: `src/main/models/providers/mock.ts`, which gets `$item` and `$usage` refs
- Test: `src/main/models/providers/mock.test.ts`

**Interfaces:**
- `resolveMockRefs` resolves two new refs from the `items:` lines Task 8 adds to `<project_state>`:
  - `{"$item": name}` resolves to the item id;
  - `{"$usage": [item, usage]}` resolves to the usage id.
- `parseSnapshot` reads those lines into `items: { id, name, usages: { id, name }[] }[]`.
- Character parsing must not change. A character line keeps its `[role]`, and item lines have none.

- [ ] **Step 1: Write the failing unit test:**

```ts
it('resolves $item and $usage from the items lines', () => {
  const snap = '<project_state>\nitems:\n- itm_0000000001 Kestrel blaster usages: use_0000000001 At rest (ready), use_0000000002 Firing (ready)\n</project_state>'
  expect(resolveMockRefs({ itemId: { $item: 'Kestrel blaster' }, usageId: { $usage: ['Kestrel blaster', 'Firing'] } }, snap))
    .toEqual({ itemId: 'itm_0000000001', usageId: 'use_0000000002' })
})
```

- [ ] **Step 2: Run `npx vitest run src/main/models/providers/mock.test.ts`.** Expected: FAIL.
- [ ] **Step 3: Implement it.** Then run the test again. Expected: PASS.
- [ ] **Step 4: Write `items.spec.ts`.** Model it on `full-flow.spec.ts`, which uses two user messages because refs resolve from the snapshot taken when a message is sent.
  - Message 1 is scripted as:
    1. `create_character` Mina;
    2. `create_item` "Kestrel blaster";
    3. `create_item_usage` with `itemId: { $item: 'Kestrel blaster' }`, `name: 'Firing'`, `kind: 'action'`, `delta: 'both hands, cyan beam from the barrel tip'`. This call is in the same turn list as `create_item`, so if the item id is not in the snapshot yet, move it to the start of message 2.
  - Message 2 is scripted as `create_panel` with:
    - `characters: [{ characterId: { $character: 'Mina' }, variationId: { $variation: ['Mina', 'Base'] } }]`;
    - `items: [{ itemId: { $item: 'Kestrel blaster' }, usageId: { $usage: ['Kestrel blaster', 'Firing'] }, heldBy: { $character: 'Mina' }, action: 'aims at the door' }]`;
    - a description that names "Kestrel blaster".
  - Assert:
    - the Items tab shows one `item-card`, and opening it shows two `usage-card`s;
    - the Webtoon tab shows one panel with an image;
    - the panel editor shows the item row with usage "Firing" and held by Mina.
- [ ] **Step 5: Run `npm run test:e2e -- items.spec.ts`.** Expected: PASS.
- [ ] **Step 6: Run the whole suite.** Run `npm run typecheck`, `npm test` and `npm run test:e2e`. Expected: all pass.
- [ ] **Step 7: Commit** with `test: item maker end to end`.
