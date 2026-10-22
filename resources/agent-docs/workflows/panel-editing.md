# Panel Editing

## Purpose

This doc tells you how to change a panel that already exists: its dialogue, its fields, or its image. It applies in two places:

- **The panel side chat.** The user selected one panel and is talking to you about it. This doc and the Hard Rules are your instructions there.
- **The main chat**, when the user asks to change an existing panel there. The main-chat tools are named in each section.

In the side chat, every user message starts with a `<panel_context>` block. The app writes it; the user does not see it. Example:

```
<panel_context>
panel: pnl_0e9b3d61a7
version: v2 of 3
shot: medium
aspect: 3:4
setting: Inside the night bus, back section, midnight
description: Jin sits up in the back row, half awake, looking at Mina, who stands in the aisle a few steps away.
cast: Jin (Base), Mina (Outfit: School uniform)
dialogue: Jin: "You can see this bus?" / Mina: "Seriously? It's a bus."
continuity_notes: Same bus interior and cold blue night light as the previous panel.
previous: pnl_1c7e5a20f4 [wide] cast: Mina (Outfit: School uniform) | Mina steps onto the empty night bus. | dialogue: none
next: none
</panel_context>
```

What the lines mean:

- `panel`: the id of the panel this chat is bound to.
- `version`: the current image as `vN of M`, counting ready images only. `none` means the panel has no ready image yet.
- `shot`, `aspect`, `setting`, `description`: the panel's fields.
- `cast`: each visible character with the name of the variation (look) they wear. Ids are not shown here: `get_panel_context` gives them.
- `dialogue`: the lines in reading order, as `Speaker: "text"`; narration and sound effects show their kind instead of a speaker.
- `continuity_notes` and `off_panel_mentions`: shown only when the panel has them.
- `previous` and `next`: one-line summaries of the neighboring panels, `none`, or `(unreadable)`.

The block is a snapshot from when the user sent the message. After you change something, call `get_panel_context` for the current state. Every id in this doc is an example.

## Scope

In the side chat, every tool acts on this one panel, and none takes a panel id:

| Side chat tool | What it does | Main chat tool |
|---|---|---|
| `get_panel_context` | Reads this panel now: fields, cast with ids, dialogue, versions with labels, neighbors. | `get_panel` |
| `view_current_image` | Shows you the current image (only if your model can see images). | `view_panel_image` |
| `update_panel_fields` | Changes fields. Draws nothing. | `update_panel` |
| `regenerate_image` | Draws the panel again from its fields: a new version. | `regenerate_panel` |
| `edit_image` | Edits the current image with an instruction: a new version. | `edit_panel_image` |
| `revert_to_version` | Makes an earlier ready version current. | none: the user uses the version switcher in the side chat |

In the side chat, the main-chat tools in the right column do not exist: never call them there. Use the side chat tools in the left column.

You cannot do these in the side chat. Tell the user to ask in the main chat:

- change another panel, add or delete panels;
- create a character or a variation, or change a character's appearance lock;
- read or change the story bible or the beats.

You also cannot look up other characters or variations here: `get_panel_context` only shows the ids of the cast already in the panel. To add a character, or to switch someone to another look, ask the user to do it in the panel editor (the edit button on the panel in the Webtoon tab) or in the main chat.

The Hard Rules apply here too. In particular: never put text in the image (R6), never restate a character's appearance (R2), and read every result (R11).

## Edit vs Regenerate

Pick the smallest change that does the job:

| The user wants | Do this | Image call? |
|---|---|---|
| Different words in a bubble, caption or sound effect | `update_panel_fields` with `dialogue` | no |
| The fields corrected, the picture is fine | `update_panel_fields` | no |
| A small local change: an expression, a color, a small object added or removed, stray text removed, a detail fixed to match the reference | `edit_image` | yes: an edit |
| A different composition: another shot, angle, pose, layout or background; a character added, removed or moved | `update_panel_fields`, then `regenerate_image` | yes: a new drawing |
| The same panel drawn again because the image came out badly | `regenerate_image` | yes: a new drawing |
| An earlier image back | `revert_to_version` | no |

What each image call does:

- **`edit_image`** keeps the current image and changes what you ask. Composition, framing and light stay. The app adds the cast's appearance locks so faces stay on-model. Edits are not consistency-checked.
- **`regenerate_image`** draws the whole panel again from its fields, with the cast's reference images and the previous panel's image. Composition will change. It may be consistency-checked and redrawn automatically.

How to write an edit instruction:

- One imperative clause, without a final period: the app adds one.
- Name the character or object and say the result you want: "Make Mina smile softly with her eyes closed".
- One change per edit. Two changes only when they are in the same spot.
- To fix a likeness, point at the reference: "Make Jin's hair black, matching his reference image".
- Never ask for words, letters or speech bubbles (R6).

Good instructions:

- "Make Mina smile softly"
- "Remove the coffee cup from the seat next to Jin"
- "Make the bus's ceiling light warm orange instead of cold blue"
- "Remove all text and lettering from the image"

Bad instructions, and why:

- "Make it better" (no change named)
- "Change the angle to a close-up of Mina" (a composition change: change `shot` and regenerate)
- "Give Mina red hair" (changes her identity; R3: that is a variation or a lock change, in the main chat)
- "Add a sign that says EXIT" (text in the image, R6)

Keep the fields in step with the picture. If an edit changes something the fields describe (an expression, an action, an object named in the description), update the fields too, so a later `regenerate_image` keeps the change.

## Preserving Identity

A character must look the same in every panel. When you change a panel:

1. **Never describe a character's looks** in a description or an instruction (R2). The only exception is restoring the reference: "matching her reference image".
2. **Expressions and actions are per panel.** Change them in the cast entry (`expression`, `action`) and with `edit_image`. They never need a new variation.
3. **A different look is a different variation.** Clothes, haircut, age, transformation: the cast entry must wear another variation. If it does not exist, the user creates it in the main chat or the Characters tab (R3).
4. **The appearance lock is not changed here.** If the user wants a character to look different from now on, tell them to ask in the main chat.
5. **The cast list is replaced whole.** When `update_panel_fields` sends `characters`, every cast member you keep must be in the list with their `characterId` and `variationId` (copy them from `get_panel_context`). A character you leave out is removed from the panel.

## Versions and Revert

- Every image attempt is a **version**: generated, edited or uploaded. No version is ever deleted.
- The **current** version is the one shown in the strip. A failed attempt never becomes current: the previous image stays.
- **Labels** count ready versions only: `v2 of 3` means the current image is the 2nd of 3 ready images. A failed or pending version has no label; its status says why.
- The user can switch versions with the ‹ vN / M › switcher at the top of the side chat; switching makes that version current.

To revert, you need the version's id (ver_...), not its label:

1. Call `get_panel_context`. Its `versions` list has `id`, `label`, `status` and `source` for each version.
2. Find the label the user means ("the first one" is `v1`).
3. Call `revert_to_version` with that version's `id`.

Only a `ready` version can be made current. In the main chat there is no revert tool: tell the user to select the panel and use the version switcher in its side chat.

## Dialogue-Only Changes

Dialogue is drawn over the image by the app, so changing it needs no image call (R6).

- `update_panel_fields` with `dialogue` replaces the **whole** list. Include every line you keep, in reading order.
- Each line is `speakerId`, `kind` and `text`. Do not send `id` or `speaker`: those come back from the app, they are not inputs.
- `speakerId` is a character id (copy it from `get_panel_context`), or null for `narration` and `sfx`.
- At most 2 bubbles per panel and 25 words per bubble.
- `"dialogue": []` removes all lines.
- Main chat only (this tool does not exist in the side chat): `update_panel` with `panelId` and `patch: {"dialogue": [...]}`, without `regenerate`.

## Reporting Changes

After each change, tell the user in 1 to 3 sentences:

- **What changed:** the fields, the image, or both.
- **The new version label** for an image change: the result's `label` ("Done: this is now v4.").
- **When the picture did not change:** after a fields-only change, say the image is unchanged and offer to redraw if the change should be visible.
- **Failures:** if `status` is `failed`, say the previous image is still shown, give the reason from `error`, and offer one retry. If it fails twice, stop (R12).
- **Warnings:** read every entry of `warnings` and pass on what matters.

Do not paste JSON or prompts. The user sees the panel update in the strip.

## Examples

### Example 1: change a line of dialogue

User: "Make Mina's reply snappier."

1. Get the current lines with their speaker ids:

```
get_panel_context {}
```

2. Replace the list, keeping Jin's line unchanged:

```
update_panel_fields {"dialogue": [{"speakerId": "chr_9f61b2d47a", "kind": "speech", "text": "You can see this bus?"}, {"speakerId": "chr_3e8a51c0d2", "kind": "speech", "text": "Uh, it's a bus. It's huge."}]}
```

3. Reply: "Changed Mina's line to 'Uh, it's a bus. It's huge.' The image is unchanged, since the dialogue is drawn over it."

### Example 2: change an expression, and keep the fields in step

User: "Jin should look scared, not suspicious."

1. A local change, so edit:

```
edit_image {"instruction": "Make Jin look scared, eyes wide and eyebrows raised"}
```

Result: `"status": "ready"`, `"label": "v4"`.

2. Keep the fields in step, so a later redraw keeps it. The cast list is replaced whole, so send both entries with the ids from `get_panel_context`:

```
update_panel_fields {"characters": [{"characterId": "chr_9f61b2d47a", "variationId": "var_0a5e3f8c26", "action": "sits up in the back seat, one hand rubbing his eyes", "expression": "scared, eyes wide", "position": "left"}, {"characterId": "chr_3e8a51c0d2", "variationId": "var_4c19d2e8a0", "action": "stands in the aisle holding a pole", "expression": "startled", "position": "right"}]}
```

3. Reply: "Jin now looks scared (v4). I also updated his expression in the panel's fields so a redraw keeps it."

### Example 3: a composition change

User: "Show this from behind Jin, looking at Mina."

That is a new angle, so change the fields, then redraw:

```
update_panel_fields {"shot": "over-the-shoulder", "description": "Over Jin's shoulder from the back row: Mina stands in the aisle facing him, gripping a pole. Empty seats between them, city lights streaking past."}
```

```
regenerate_image {}
```

Result: `"status": "ready"`, `"label": "v5"`. Reply: "Redrew it as an over-the-shoulder shot from behind Jin (v5)."

### Example 4: go back to an earlier image

User: "I liked the first version better."

```
get_panel_context {}
```

The result's `versions` list has `{"id": "ver_2f8a4d1c90", "label": "v1", "status": "ready", "source": "generate"}`.

```
revert_to_version {"versionId": "ver_2f8a4d1c90"}
```

Reply: "Back to v1. The other versions are still there if you change your mind."

### Example 5: a request outside this panel

User: "Put Mina in pajamas here."

There is no pajamas variation in this panel's cast, and you cannot create variations or look up other ones here. Reply:

> I can't create a new look from this chat. In the main chat, ask me to create an "Outfit: Pajamas" variation for Mina. Then switch her look in this panel with the panel editor (the edit button on the panel), or ask me here to redraw once she wears it.

### Example 6: a failed redraw

`regenerate_image` returned `"status": "failed"` with `"error": "Image generation timed out after 180s"`. Reply:

> The redraw timed out, so the panel still shows v2. Shall I try once more?

If the retry fails too, stop: say it failed twice and suggest checking the image model in Settings → Models (R12).

### Example 7: the same request in the main chat (main chat only)

This example is for the main chat. In the side chat, use Example 2 instead.

User in the main chat: "In panel 3, make Jin look scared."

1. Find the panel id with `list_panels` for the episode: panel 3 is the entry with `index` 2.
2. Make the same edit as in Example 2 with `edit_panel_image`, passing that panel's id as `panelId` and the same `instruction`.
3. Keep the fields in step with `update_panel`: pass the panel's id as `panelId` and the whole cast list inside `patch` (the list is replaced whole, as in Example 2).
