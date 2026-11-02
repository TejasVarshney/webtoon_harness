# Item Maker — Design Spec

Extends `2026-10-21-webtoon-ai-harness-design.md`. Everything not said here works as that spec says.

## 1. Requirement (user's words)

> Just like character maker, make an items maker also, so that a special item will be consistent throughout the panels. And how it is used must be consistent too: if there is a laser blaster of a specific type, it must be used the same way as in earlier panels. So create the image of every way it is being used, when needed.

## 2. Vocabulary

| Term | Meaning | Character analogue |
|---|---|---|
| **Item** | A recurring object that must look the same in every panel (a weapon, gadget, artifact, vehicle). `items/itm_<id>.json`. | Character |
| **Item lock** (`appearanceLock`) | One paragraph of concrete visual facts about the object, pasted verbatim into every image prompt that shows it. | Appearance lock |
| **Usage** | One recurring way the item looks or is handled, with its own reference image: `At rest` (base), a **state** (folded, glowing, broken) or an **action** (Firing, Swinging, Scanning). | Variation |
| **Usage delta** | What the usage shows: for an action, the grip, the motion and the visible effect ("both hands, right index finger on the trigger, thin cyan beam from the barrel tip"). Pasted verbatim. | Variation delta |
| **Panel item** | An item attached to a panel: which item, which usage, who holds it, what it is doing in this panel. | Cast entry |

## 3. Behavior

1. **Same look:** each item has a lock and a base reference image (the object alone). Every panel that attaches the item sends the usage's reference image to the image model and pastes the lock.
2. **Same use:** each way of using the item is a named usage with a reference image. A panel that shows the item being used picks that usage, so the grip, motion and effect come from the same reference every time. Usage names are unique per item; the agent must reuse an existing usage whose action matches before it creates a new one.
3. **Images when needed:** the agent creates a usage (and its reference image, waiting for it) the first time a panel needs a way of using the item that has no usage yet. A panel cannot attach a usage without a ready reference image, so the image always exists before the panel is drawn.
4. **Guarded mentions:** an item name or alias in a panel description must be attached to the panel or listed in `offPanelMentions`, exactly like characters (strict for the agent, a warning in the manual editor).
5. **Checked:** the consistency checker gets each item's lock, usage and holder, and judges the item's look and use as Major problems.

## 4. Data model (`src/shared/schemas.ts`)

```
ItemUsageKind = 'base' | 'state' | 'action'
ItemUsage   { id 'use_', itemId, name, kind, delta = '', imagePath = null, status, error = null, createdBy, createdAt }
Item        { id 'itm_', name, aliases = [], ownerId: chr id | null = null, notes = '', appearanceLock, usages: ItemUsage[],
              archived = false, createdBy, createdAt, updatedAt }
ItemInput   { name, aliases?, ownerId?, notes?, appearanceLock }      ItemPatch = ItemInput.partial()
ItemUsageInput { name, kind: 'state' | 'action', delta }
PanelItem   { itemId, usageId, heldBy: chr id | null = null, action = '' }
Panel.items: PanelItem[] = []        PanelDraft.items?: PanelItem[]   (PanelPatch follows from PanelDraft)
AppEvent    { type: 'item.changed', projectId, itemId }
```

- The base usage is created with the item: name `At rest`, kind `base`.
- `notes` (purpose, rules, origin) is never sent to the image model; it is for the agent's writing.
- `ownerId` is who usually carries the item. It is informational: the editor uses it as the default holder.
- On disk: `items/itm_<id>.json`, images in `items/itm_<id>/<usageId>_<6 hex>.<ext>`.
- Existing panel files have no `items` and parse as `[]`.

## 5. Prompts (pinned; mirrored in `reference/prompt-templates`)

- **Item reference (base):** `Item reference sheet. {style}. The object alone, three-quarter view, centered, plain light-gray background, even studio lighting, no people, no hands, no text. {lock}`
- **State usage:** `Item reference sheet. {style}. The object alone, three-quarter view, plain light-gray background, no people, no hands, no text. {lock} State: {usage.name} — {usage.delta}. Keep shape, size, materials, colors and markings identical to the reference image except for the state.`
- **Action usage:** `Item usage reference sheet. {style}. Plain light-gray background, no text. {lock} Usage: {usage.name} — {usage.delta}. Show only plain gray hands and forearms, cropped at the elbow, with no face, body, clothing or jewelry, so the sheet shows only the grip, the motion and the effect. Keep shape, size, materials, colors and markings identical to the reference image.`
- Non-base usages send the base image as their one reference.
- **Panel prompt:** after `[CHARACTERS]`, only when the panel has items:
  ```
  [ITEMS] Draw each item exactly as its reference image shows it, and use it exactly as its reference shows. Gray hands in an item reference only show the grip: draw the holder's own hands, never gray hands.
  - {item.name} (reference image N): {lock} Use: {usage.name} — {usage.delta}. Held by: {holder name | nobody}. Action: {action}.
  ```
- **References**, in order: cast variations, then items (panel order), then the previous panel. Over the model's cap, the previous panel goes first, then items from the end, then cast from the end. A dropped item reads `(no reference image)` and its lock still applies.
- **Panel edit prompt:** when the panel has items, `keep these items on-model: {name}: {lock} …` is added before `No text`.
- **Checker message:** an `Items:` block (only when the panel has items) lists `- {name} — {lock} — Use: {usage} — Held by: {holder}`, plus `(no reference image)` when its reference was not sent. Which reference belongs to whom is decided by an explicit `subject` on each reference, not by label.

## 6. Agent tools

`list_items`, `get_item`, `create_item` (generates the base image and waits), `update_item`, `create_item_usage` (generates and waits; refuses a duplicate name and points to the existing usage), `regenerate_item_usage`. `create_panel` / `update_panel` take `items`. `<project_state>` lists items with their usages; the panel side chat sees the panel's items.

## 7. UI

- An **Items** tab beside Characters: a grid of item cards, a detail view with the item form and the usage grid (add, regenerate, upload, delete a usage), archive and delete. It mirrors the Characters tab.
- The panel editor gets an **Items** picker under the cast picker: item, ready usage, held by (a cast member or nobody), action.

## 8. Rules carried over from characters

Delete is refused while a panel uses the item or the usage (archive instead). A usage's `pending` becomes `failed` when the project opens. Upload accepts png, jpg and webp. A failed image never replaces a ready one. Names are unique (case-insensitive) among active items.

## 9. Decisions made without asking (please review)

1. **Separate `ItemService`**, modeled on `CharacterService` rather than a shared generic base. Refactoring the character service and its failure-injection tests is risk with no user-visible gain.
2. **Action usages show gray hands and forearms only**, not a person. A full mannequin, or the owner character, would leak into panels or tie the usage to one holder. The panel prompt and the checklist both say gray hands must never be drawn.
3. **Item references come after the cast and before the previous panel.** Identity of people matters most, and the previous panel is the cheapest to lose. With the default cap of 4, the doc tells the agent to keep the cast to 2 when an item matters.
4. **One entry per item per panel.** Two copies of the same item in one panel are out of scope.
5. **`heldBy` must be a cast member of the same panel**, or null.
6. **Existing projects keep their edited docs.** `install` only adds missing files, so an old project gets `item-creation.md` but keeps its old `AGENTS.md` and checklist until the user runs **Reset docs**. The tools themselves work regardless.
7. **"Create the image of every usage when needed" is the agent's job.** When a panel needs a way of using an item that has no usage yet, the agent creates the usage (and waits for its image) before it draws the panel. In the manual panel editor you pick from existing usages, and you add new ones in the Items tab. Nothing is generated silently in the middle of a panel draw.
8. **No item-name versus character-name clash check.** The doc tells the agent to give items distinctive names ("Kestrel blaster", not "blaster").
