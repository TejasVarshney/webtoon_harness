# Item Creation

## Purpose

This doc tells you how to create and change items so an important object looks the same in every panel and is used the same way every time: what goes in an item sheet, how to write the item lock, how the reference images are made, and when a new way of using the item needs its own usage.

Read it before you call `list_items`, `get_item`, `create_item`, `update_item`, `create_item_usage` or `regenerate_item_usage`, and before you draw a panel that shows an item.

An **item** is a recurring object that must stay the same: a weapon, a gadget, an artifact, a vehicle. How consistency works:

1. Each item has an **item lock** (`appearanceLock`): one paragraph of visual description.
2. The lock is pasted, word for word, into every image prompt that shows the item.
3. Each item has a **base** reference image ("At rest"): the object alone, made from the lock. Every other **usage** gets its own reference image, made from the base image.
4. When a panel is drawn, the reference image of the usage the panel picks is sent to the image model with the prompt. The panel shows the item the way that image shows it, and uses it the way that image shows it.

A **usage** is one recurring way the item looks or is handled: a **state** (folded, glowing, broken) or an **action** (Firing, Swinging, Scanning). "Firing" always has the same grip, motion and effect because every panel that fires the item uses the same "Firing" image.

Every id in this doc is an example. Copy ids only from tool results.

## Item Sheet

These are the inputs of `create_item` (and the fields of `update_item`'s `patch`):

| Field | Required | What to write |
|---|---|---|
| `name` | yes | A distinctive name: "Kestrel blaster", not "blaster". Unique among the active items. |
| `appearanceLock` | yes | The visual paragraph (next section). |
| `aliases` | no | Other names the story uses for it, e.g. ["the Kestrel"]. |
| `ownerId` | no | The character id of who usually carries it, or null. Informational: the panel editor uses it as the default holder. |
| `notes` | no | Purpose, rules and origin: what it does in the story, what it cannot do, where it came from. |
| `generateBaseImage` | no | Default true. Set false only when the user wants to upload their own image: the base is then `failed` with "No image yet: upload one or regenerate" until they do. |

What each part is for:

- **notes** is never sent to the image model. You use it to write the story. Fill it: it is how future sessions know what the item is for and what its rules are (for example "the beam only works at night").
- **ownerId** must be a real character id, or the call is rejected with `Unknown character: ...`. It does not put the character in a panel and it does not make them hold the item: `heldBy` in the panel does that.
- **aliases** matter for panels: the app checks every panel description for each item's name and aliases (whole words, any case). An item named in a description must be attached to the panel or listed in `offPanelMentions`. So do not use common words as aliases ("the gun", "the box"); add an alias only if the story really calls the item that.

## Writing the Item Lock

The lock is one paragraph, **25 to 70 words**, of concrete visual facts in this **fixed order**:

1. overall shape and size, compared with a hand ("a hand and a half long", "palm-sized", "as tall as a door"),
2. materials,
3. colors,
4. markings (stripes, scratches, engraved patterns, wear),
5. lights and glow (where, what color),
6. distinctive parts (the few things that make it recognizable).

Rules:

- **Concrete tokens only.** Shapes, sizes, materials, colors: "matte graphite-gray alloy with brushed brass trim", not "cool futuristic metal".
- **Size against a hand.** The image model has no sense of scale; "a hand and a half long" keeps the item the same size in every panel.
- **No text on the item** (R6): no letters, numbers, labels, serial numbers, and no brand logos that contain letters. Use a symbol instead: "a brass crescent emblem".
- **No story or mood words:** not powerful, dangerous, ancient, cursed. Say what is visible.
- **No camera or image words:** not close-up, side view, background, lighting. The app adds those.
- **No style words:** not anime, realistic, watercolor. The project's style is added for you.
- **No name at the start.** The prompt already names the item before the lock.
- **Do not describe a usage in the lock.** The lock is the item at rest. Its glow while firing, its folded shape or its damage are usages.
- **Same words forever.** The lock is pasted verbatim; any change changes every future image (R3).

Good lock (66 words):

```
Compact pistol, a hand and a half long, boxy frame with a short rounded barrel. Matte graphite-gray alloy body, brushed brass trim, three thin brass stripes on the left of the slide. A thin cyan light strip runs along the top of the barrel and a small cyan dot glows at the muzzle. Fin-shaped rear sight, oversized round trigger guard, grip wrapped in dark teal cord.
```

Bad lock, and what is wrong with it:

```
The KESTREL laser blaster, a really cool futuristic weapon that looks dangerous and powerful. It has the KESTREL logo on the side and shoots blue beams.
```

- starts with the name; "cool", "dangerous", "powerful" are mood words, not visible facts;
- no size, no material, no colors, no markings, no parts: it is 25 words but says almost nothing;
- "the KESTREL logo" is text on the item (R6);
- "shoots blue beams" is a usage, not part of the item at rest.

Check before you call `create_item`:

- [ ] 25 to 70 words, one paragraph
- [ ] order: shape and size against a hand, materials, colors, markings, lights, distinctive parts
- [ ] every color named; the size is compared with a hand
- [ ] no text or logos with letters, no mood, camera or style words, no name at the start

## Base Reference Image

`create_item` creates the base usage (named "At rest") and, unless `generateBaseImage` is false, generates its image and waits. The image is the object alone, three-quarter view, centered on a plain light-gray background, with no people and no hands, made from the style and the lock (the exact prompt is in `reference/prompt-templates`).

The result looks like this:

```json
{"itemId": "itm_3f9a1c0b7e", "baseUsageId": "use_5b7d9e2f04", "baseStatus": "ready", "baseError": null, "imagePath": "items/itm_3f9a1c0b7e/use_5b7d9e2f04_8c1d3a.png"}
```

What to do with it:

- `baseStatus` `ready`: done. If your model can see images, the result shows you the picture: compare it with the lock.
- `baseStatus` `failed` with `baseError` "No image yet: upload one or regenerate": you passed `generateBaseImage: false`, so nothing went wrong and nothing is retried. The user uploads the image in the Items tab, or you call `regenerate_item_usage` once they want a generated one.
- `baseStatus` `failed` with any other error: the item exists, only the image is missing. Read `baseError`, then retry once with `regenerate_item_usage` using `baseUsageId`. If it fails again, stop and tell the user (R12). Never call `create_item` again: you would get "An item named ... already exists".
- The picture contradicts the lock (wrong color, a missing stripe): regenerate once. If it is wrong again, the lock is probably unclear. Show the user the line you would change and change the lock only after their yes (R3).

The base must be `ready` before any other usage can get its image (usage images are made from the base image).

## Usages

A usage is a named recurring way the item looks or is handled, with its own reference image.

| Kind | Use it for | Example name | Example delta |
|---|---|---|---|
| `state` | The object itself looks different: folded, charged, broken, glowing, open. Shown alone, without hands. | Folded | Barrel hinged back along the frame, trigger guard flat against the grip; the cyan light strip is dark |
| `action` | A way the item is handled: fired, swung, thrown, scanned. Shown with plain gray hands and forearms only. | Firing | Both hands grip it, right index finger on the trigger, arms straight; a thin cyan beam leaves the muzzle and the light strip glows bright |

The base usage "At rest" is created for you. You only create `state` and `action` usages.

How to write `delta`:

- **For an action, name three things: the grip, the motion and the visible effect.** "Both hands grip it, right index finger on the trigger" is the grip; "arms straight, slight recoil" is the motion; "a thin cyan beam leaves the muzzle" is the effect. Without all three the image model invents them differently each time.
- **For a state, say what changes** and what stays: "the cyan light strip is dark".
- Write only what differs from the base look. Do not repeat the lock.
- Same rules as the lock: concrete, no mood words, no camera words, no text.
- No final period: the app adds one after the delta.

Gray hands in an action image only show the grip. The panel draws the holder's own hands, never gray hands, so do not describe skin, sleeves or a person in the delta.

`create_item_usage` generates the image from the base image and waits. The result:

```json
{"usageId": "use_8d2e4a6c1f", "status": "ready", "error": null, "imagePath": "items/itm_3f9a1c0b7e/use_8d2e4a6c1f_91be03.png"}
```

`status` `failed` with "Base reference image is not ready": regenerate the base first (`regenerate_item_usage` with `baseUsageId`), then this usage. `failed` with "No image yet: upload one or regenerate" means you passed `generateImage: false`: wait for the user's upload or their go-ahead, and do not count it as a failure. Any other failure: retry once with `regenerate_item_usage`, then stop and report.

## Reusing Usages

Usage names are unique per item, and every duplicate is a second image of the same thing that may look different. So before you create a usage:

1. **List the item's usages first.** `list_items` shows every usage with its name, kind and status. `get_item` also shows each `delta`: use it whenever the names alone do not settle the question.
2. **Reuse the one whose action matches.** "Jin shoots the Kestrel" matches "Firing"; "Jin folds it away" matches "Folded". Compare meaning, not spelling. When a name could fit two usages, or you are not sure which one fits, call `get_item` and read the deltas of the usages before you decide whether to reuse one or create a new one.
3. **Create a usage only when no existing one fits.**

Never create "Shooting" when "Firing" exists. If you try to create a usage whose name is already taken, the call is refused with `Kestrel blaster already has a usage named "Firing": use that one`. Do what it says: use that usage's id in the panel. Do not retry with a slightly different name.

A usage is a way of using the item, not a moment. "Firing while kneeling" and "Firing in the rain" are the same usage "Firing": the kneeling and the rain go in the panel (the holder's `action`, the description, `continuityNotes`).

## When to Create an Item

Create an item when:

- it **recurs**: it will appear in 3 or more panels, or in more than one scene; or
- its **exact look or use matters** to the story: the murder weapon, the key artifact, the hero's signature gadget, the vehicle they drive every episode.

Do not create an item for:

| The object | Do this instead |
|---|---|
| A cup, a phone or a bag seen in one panel | Describe it in the description, or in the holder's `action`. |
| Ordinary clothes and accessories the character always wears | Part of the character's appearance lock or an outfit variation. |
| Furniture and background props | Describe them in the setting. |
| A one-time object nobody will look at closely | Describe it in the description. |

In user-led mode, an item that changes the plot (a new weapon, a key artifact) is a story decision (R7): suggest it, and create it when the user agrees or asked for it. A small prop that does not change the plot you may create yourself.

Give every item a **distinctive name**. The app finds an item in a description by its name and aliases (whole words), and an item named like a character, a place or a common word is matched in the wrong places. "Kestrel blaster", "Moon lantern" and "Harbor Key" are good; "blaster", "lantern" and "key" are not.

## Using Items in Panels

A panel attaches an item with an entry in `items`:

```json
{"itemId": "itm_3f9a1c0b7e", "usageId": "use_8d2e4a6c1f", "heldBy": "chr_9f61b2d47a", "action": "aimed down the corridor, muzzle glowing"}
```

- `itemId`, `usageId`: copy them from `list_items` or from the result of `create_item` / `create_item_usage`. The usage must belong to the item and have a ready image.
- `heldBy`: the character id of who holds it, or `null` when nobody does (on a table, flying through the air, in a holster). The holder must be in the same panel's cast: an id that is not in `characters` is rejected with "... is held by ..., who is not in the cast". Cast the holder first.
- `action`: what the item itself does in this frame, a short phrase without a final period: "aimed down the corridor, muzzle glowing". What the holder's body does goes in the cast entry's `action`.
- One entry per item per panel.

Steps for a panel that shows an item:

1. **Pick the usage.** What is the item doing? Choose the usage that matches (Reusing Usages). If none matches, create it now with `create_item_usage` and wait for it: the panel cannot use a usage whose image is not ready. The panel draw never creates usages for you.
2. **Attach it.** One `items` entry, with `heldBy` set to the holder (or null).
3. **Name it in the description.** Write "Jin fires the Kestrel blaster down the corridor": the item is attached, so the name is allowed. If the item is only talked about and not visible, put its name in `offPanelMentions` instead of attaching it (R10).
4. **Do not describe the item's looks.** The lock is added for you, like a character's (R2).

**Keep the cast to 2 when the item matters.** The image model accepts a limited number of reference images (often 4). They are sent in this order: cast variations, then items, then the previous panel. Two characters, one item and the previous panel make 4. With a bigger cast the previous panel is dropped first, then items from the end, then cast members from the end. A dropped item still has its lock in the prompt, but no reference image, so its look and use drift. When an item matters (the first time it fires, the reveal of an artifact), draw it with 2 characters at most, or with the one who holds it.

Two items in one panel: each takes one reference slot. Keep both only if the story needs both visible.

The consistency check judges each item's look and use against its reference, and gray hands in the picture count as a major problem. Read the `check` result like any other (R11).

## Updating Items

`update_item` takes `itemId` and a `patch`. Only the fields named in the patch change: `aliases` is a list, so the new list replaces the old one; `ownerId: null` clears the owner.

```
update_item {"itemId": "itm_3f9a1c0b7e", "patch": {"notes": "Jams when it overheats; the beam only works at night."}}
```

Changing the item lock (R3):

- Only when the user explicitly asks. A damaged or modified item for a while is a `state` usage, not a lock change.
- The result has the warning "appearanceLock changed: regenerate the base and every usage so new panels stay consistent." Do it: `regenerate_item_usage` for the base first, then for every other usage.
- Existing panels keep their old images. Tell the user, and offer to regenerate the panels that should show the new look.

Renaming is safe for panels (they store ids, not names). You cannot archive or delete an item. If the user wants one gone, tell them to archive it in the Items tab (an item used by panels cannot be deleted, only archived).

## Examples

### Example 1: a new signature item

User (user-led): "Jin carries a Kestrel blaster, a small brass-and-gray pistol with a cyan glow. Please make it."

The user asked for it, so create it now. Jin already exists (chr_9f61b2d47a), so he is the owner.

```
create_item {
  "name": "Kestrel blaster",
  "aliases": ["the Kestrel"],
  "ownerId": "chr_9f61b2d47a",
  "notes": "Jin's late sister's sidearm. Jams when it overheats; the beam only works at night.",
  "appearanceLock": "Compact pistol, a hand and a half long, boxy frame with a short rounded barrel. Matte graphite-gray alloy body, brushed brass trim, three thin brass stripes on the left of the slide. A thin cyan light strip runs along the top of the barrel and a small cyan dot glows at the muzzle. Fin-shaped rear sight, oversized round trigger guard, grip wrapped in dark teal cord."
}
```

Result: `baseStatus` `ready`. Add the item to the story bible if it matters to the plot (R9), then reply:

> Created the Kestrel blaster, carried by Jin. Its base reference image is ready.

### Example 2: a missing usage

The next beat: Jin fires the blaster down the bus aisle. `list_items` shows the Kestrel blaster has only "At rest", so "Firing" does not exist yet. Create it before the panel:

```
create_item_usage {"itemId": "itm_3f9a1c0b7e", "name": "Firing", "kind": "action", "delta": "Both hands grip it, right index finger on the trigger, arms straight with a slight recoil; a thin cyan beam leaves the muzzle and the light strip glows bright"}
```

Result: `status` `ready`, `usageId` use_8d2e4a6c1f. Use that id in the panel.

### Example 3: reuse, do not duplicate

Later: "Jin shoots again, in the rain." `list_items` shows the Kestrel blaster already has "Firing". Shooting is the same action, and the rain belongs in the panel. Do **not** call `create_item_usage` with "Shooting": it would be refused, and if it were not, the two images would drift apart. Use use_8d2e4a6c1f.

### Example 4: a panel with an item

Jin (chr_9f61b2d47a, wearing var_0a5e3f8c26) fires the blaster; Mina (chr_3e8a51c0d2, wearing var_4c19d2e8a0) ducks behind a seat. That is 2 cast members, 1 item and the previous panel: 4 references.

```
create_panel {
  "episodeId": "epi_5d0c3b9a12",
  "description": "Jin fires the Kestrel blaster down the dark bus aisle while Mina ducks behind a seat. A cyan beam cuts through the dim cabin.",
  "setting": "Inside the night bus, aisle, midnight",
  "shot": "medium",
  "aspect": "3:4",
  "characters": [
    {"characterId": "chr_9f61b2d47a", "variationId": "var_0a5e3f8c26", "action": "braces his feet in the aisle and fires", "expression": "grim", "position": "left"},
    {"characterId": "chr_3e8a51c0d2", "variationId": "var_4c19d2e8a0", "action": "ducks behind a seat, hands over her head", "expression": "frightened", "position": "right"}
  ],
  "items": [{"itemId": "itm_3f9a1c0b7e", "usageId": "use_8d2e4a6c1f", "heldBy": "chr_9f61b2d47a", "action": "aimed down the aisle, muzzle glowing"}],
  "dialogue": [{"speakerId": null, "kind": "sfx", "text": "ZZAAP"}],
  "continuityNotes": "Same night bus interior and dim light as the previous panel."
}
```

If the result is `Item mentioned but not attached: Kestrel blaster`, you forgot the `items` entry: add it (or list the name in `offPanelMentions` if it is only talked about) and call again.

### Example 5: a state usage

The story has Jin fold the blaster to hide it. It will be folded in several panels, so give it a usage:

```
create_item_usage {"itemId": "itm_3f9a1c0b7e", "name": "Folded", "kind": "state", "delta": "Barrel hinged back along the frame, trigger guard flat against the grip; the cyan light strip and muzzle dot are dark"}
```

### Example 6: a failed usage image

`create_item_usage` returned `"status": "failed", "error": "Base reference image is not ready"`. The usage exists. Regenerate the base first, then the usage:

```
regenerate_item_usage {"itemId": "itm_3f9a1c0b7e", "usageId": "use_5b7d9e2f04"}
```

Then the same for the failed usage's own id. If a call fails again, stop: "The blaster's Firing image failed twice (timeout). You can retry from the Items tab, or check the image model in Settings → Models."

### Example 7: not an item

User: "Draw Mina drinking from a paper cup."

A cup in one panel is not an item. Put it in the cast entry's `action`: `"action": "sips from a paper cup"` (see `workflows/panel-generation`).
