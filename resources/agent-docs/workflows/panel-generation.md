# Panel Generation

## Purpose

This doc tells you how to draw a new panel with `create_panel` so that the right characters appear, they look like themselves, and the panel continues from the one before it. Read it before your first `create_panel` in a session. For shot and aspect choices, also read `reference/webtoon-style-guide`.

What the app does for you when you call `create_panel`:

1. It checks your input: every cast member is a roster character, not archived, with a variation that belongs to them and has a ready reference image; no one is cast twice; every speaker is a roster character; every roster name in the description is cast or declared off-panel.
2. It builds the image prompt: the style, your setting and description, and one line per cast member with their appearance lock, variation, action, expression and position. Dialogue is never in the prompt.
3. It sends reference images with the prompt: each cast member's variation image (in cast order), then the image of the usage of each attached item (in panel order), then the image the panel continues from, usually the previous panel's (see Using the Previous Panel).
4. It generates the image and stores it as a new version of the panel.
5. If a vision model is assigned, it checks the image against the references and redraws automatically when the check fails (see Reading the Consistency Check).

Your job is to give it the right cast, variations and words. Every id in this doc is an example.

## Pipeline

Follow these 10 steps for every new panel.

1. **Read the state.** Look at `<project_state>` and call `list_panels` for the episode (R4). If your model can see images, `view_panel_image` the last panel. Know where everyone is, what they wear and what just happened.
2. **Choose the beat.** The next `planned` beat (from `get_story`), or what the user asked for. One beat per panel (R5).
3. **Choose the cast.** Who is visible in this frame. At most 3 in the foreground. Named characters must be in the roster (R1); unnamed extras are described in words. If a roster item is used or shown, also decide its usage and holder (see Attaching Items).
4. **Choose variations.** Keep each character's variation from the previous panel, unless the story changes their look.
5. **Choose shot and aspect.** What the reader must see decides the shot; the pace decides the aspect.
6. **Write the description.** The camera first, then action and composition placed by landmarks (see Screen Direction); never appearance (R2), never text (R6).
7. **Write the location and continuity notes.** The place's `location`, and in `continuityNotes` the scene's Layout line and what else must match.
8. **Write the dialogue.** Speech, thought, narration and sound effects, in reading order.
9. **Call `create_panel`.** One call; it waits for the image.
10. **Read the result.** `status`, `warnings`, `check`. Fix or report (R11). Then `update_beat` the beat to `drawn`.

## Selecting the Cast

The cast is the `characters` list. One entry per visible named character:

```json
{"characterId": "chr_3e8a51c0d2", "variationId": "var_4c19d2e8a0", "action": "grips the overhead strap", "expression": "nervous", "position": "left"}
```

- `characterId`, `variationId`: copy them from `<project_state>` or `list_characters`.
- `action`: what this character does in this frame, a short phrase.
- `expression`: their face in this frame: "wide-eyed", "smiling softly", "crying". This is where per-panel emotions go, not in a variation.
- `position`: where they stand, in a few words: `left`, `center`, `right`, `background`, or something finer such as `far left, half in shadow`. Default `center`. Speech bubbles go to the side it names (`left` or `right`, else the centre). Give two characters different positions.
- Write `action` and `expression` as short phrases without a final period: the app adds one.

Rules:

- **Visible means cast.** If a named character can be seen, even small or from behind, cast them (R2). If they cannot be seen, do not cast them.
- **At most 3 in the foreground.** More faces means less likeness for each. Put a fourth person in `background`, or split the moment into two panels.
- **Order matters.** Put the most important character first. The image model accepts a limited number of reference images (often 4). When there are too many, the previous panel's image is dropped first, then items from the end, then cast members from the end of the list. With 3 cast members plus the previous panel you are at that limit; each attached item takes one more slot (see Attaching Items).
- **Unnamed extras are words.** "A tired bus driver in a gray uniform", "a crowd of commuters". Never give them names. If an extra becomes important and recurs, create them as a character first (R1; in user-led mode, ask first).
- **A scene with nobody in it** (an establishing shot, an object close-up) has `"characters": []`.

## Choosing Variations

1. **Keep what they wore.** In `recent_panels` each cast member shows the variation id they wear: `Mina (var_4c19d2e8a0)`. Use the same id in the next panel unless the story changes it.
2. **Change only for a story reason.** She changed clothes, it is a flashback (an `age` variation), she transformed (a `form` variation). Show the change happening, or start a new scene.
3. **Only ready variations.** The variation's status must be `ready`. If it is `failed`, run `regenerate_variation` first. If it does not exist yet and the look will recur, create it (`workflows/character-creation`).
4. **Each character's own variation.** A variation id belongs to one character. Copy it from that character's line.
5. **Default is Base.** For a character's first appearance with no special look, cast the variation named "Base".

## Using the Previous Panel

Each panel continues from one earlier image of its episode, which the app sends as the last reference image, with a [CONTINUITY] line. Which image depends on `location`: a short name for the place, written the same way in every panel set there ("stockroom", "night bus", "Mina's bedroom"; letter case and spacing do not matter).

- **No location** on the new panel or on the panel right before it: the panel right before, when it has a ready image. The line reads "Continues directly from the previous panel (reference image N). Keep setting layout, lighting, time of day and outfits consistent." followed by your `continuityNotes`.
- **The same location as the panel right before:** that panel, when it is an `establishing`, `wide` or `medium` shot. When it is a tight shot (`close-up`, `extreme-close-up`, `over-the-shoulder`) or an odd angle (`birds-eye`, `worms-eye`), the app goes back to the last open shot of this location instead: a close-up shows too little of the place, and a low angle shows it from a view the image model would copy. The line then reads "Same place as an earlier panel (reference image N). Keep the layout of the place and its landmarks consistent with it."
- **A different location from the panel right before:** the last panel of this location, so a return after a cutaway or a flashback keeps the place's layout. A location no earlier panel has gets no image: a new place never continues from the last one.
- **Nothing to continue from** (the first panel of an episode, no ready image): no image, and the [CONTINUITY] line holds only your `continuityNotes`, or is left out when they are empty.

Give every panel a location. Keep the same name for as long as the story stays in one place, and use a new name for a new place. Name the place, not the time or the mood: "stockroom", not "stockroom at night"; the time and light go in `setting`. `list_panels` shows each panel's `location`, and `recent_panels` shows it after the shot as `at stockroom`.

Writing `continuityNotes`:

- Start with the scene's Layout line (see Screen Direction), copied word for word.
- Then one or two sentences on what else must match: time of day, weather, light, props and where they are, held objects, injuries, outfit details.
- Good: "Layout: the bus stop sign is at the left edge of the frame; the road runs along the bottom. Same rainy dusk. Mina still holds the red umbrella in her right hand."
- Do not restate appearance (R2): the references and locks handle that.

Starting a new scene: give it a new location, so the app sends nothing from the old place. Use an establishing or wide shot for the first panel of a scene, and write the scene's layout there. A panel without a location still continues from the panel right before: then say so in the notes, "New scene: a different place and time from the previous panel; keep only the characters' looks."

Inserting between panels: `afterPanelId` puts the new panel after that panel (null puts it first). Continuity is then picked from the panels before the new one, as above, and the panels after it may continue from the new one the next time they are redrawn.

## Screen Direction

The image model sees only the frame, not the room. If the door is at the left of the frame in one panel and at the right in the next, the reader sees a different room, or people who jumped across it. So keep one screen direction for a whole scene (the 180° rule of film and comics):

1. **Write the scene's layout once, in frame terms.** On the first panel of a scene, usually the establishing or wide shot, say where the main landmarks are in the frame: "The back door is at the left edge of the frame, the metal shelves on the right, the barrel fire in the middle." Put it in the description, and as a sentence starting "Layout:" at the start of `continuityNotes`.
2. **Copy the Layout line into every later panel of the scene.** `list_panels` returns each panel's `continuityNotes`, and `recent_panels` shows them after `notes:`. Copy the line as it is, then add what else must match.
3. **Start the description with the camera:** where it is and what it faces. "Side view across the stockroom." "Low angle from the floor, facing the back door."
4. **Place people by landmarks**, not only by side: "Jin stands on the left, between the door and Mina." The cast `position` still names the side ("left"), which also puts that character's bubbles on that side.
5. **Announce a reverse shot.** When the camera turns around, the sides swap. Begin the description with it, and give the new sides: "Reverse shot from the doorway: the shelves are now on the left, the door behind the camera." An unannounced swap fails the consistency check.
6. **Look at the last wide shot.** If your model can see images, `view_panel_image` the scene's last wide or establishing panel before a tight one, not only the panel right before.

The consistency check reads the sides your description, setting and continuity notes give, and fails a panel that puts a landmark or a person on the other side.

## Shot and Aspect Selection

Pick the shot by what the reader must see:

| The reader must see | Shot |
|---|---|
| A new place, the start of a scene | `establishing` |
| Where people are in a space, a full action | `wide` |
| A character from the waist up, a conversation | `medium` |
| A face and its feeling | `close-up` |
| Eyes, a hand, a small object that matters | `extreme-close-up` |
| One character as the other sees them | `over-the-shoulder` |
| A map-like view, smallness, a fall | `birds-eye` |
| Power, threat, height, the sky | `worms-eye` |

Pick the aspect by pace (default: the project's default aspect, usually 2:3, when you leave `aspect` out):

| Aspect | Use for |
|---|---|
| `2:3` | Standard panel, most beats. |
| `3:4` | Slightly wider standard panel, two people talking. |
| `1:1` | Quick beats, reactions, inserts. |
| `9:16` | Tall drama: a reveal, a fall, a tall place, a slow emotional moment. |
| `4:3`, `16:9` | Wide places, groups, landscapes, panoramas. |

Do not repeat the same shot three times in a row. More in `reference/webtoon-style-guide`.

Layout is set with `beside`, `frame`, `gapAfter` and `gutter` (and the tall `1:2` and `1:3` aspects): quick exchanges go beside each other, clashes are borderless, action runs slanted; the rules are in the Panel Layout section of `reference/webtoon-style-guide`.

## Attaching Items

An item is a roster object with reference images (`workflows/item-creation`). A panel shows one by attaching it in `items`, one entry per item:

```json
{"itemId": "itm_3f9a1c0b7e", "usageId": "use_8d2e4a6c1f", "heldBy": "chr_9f61b2d47a", "action": "aimed down the aisle, muzzle glowing"}
```

- **Attach every item that is visible**, the way you cast every visible character. An item named in the description that is neither attached nor listed in `offPanelMentions` is rejected (R10).
- **Choosing the usage.** Ask what the item is doing in this frame and pick the usage that matches, from `list_items` or the `items:` lines of `<project_state>`. A usage is a way of using the item, not a moment: "Firing" fits any frame where it fires. The usage must have status `ready`. If none fits, create it first with `create_item_usage` and wait for its image: the panel draw never creates usages.
- **`heldBy`.** The character id of who holds the item, or `null` when nobody does (on a table, in the air, in a holster). The holder must be in the same panel's cast, so cast the holder first. The item's `ownerId` is only a hint: it does not put the character in the panel.
- **`action`.** What the item itself does in this frame, a short phrase without a final period. What the holder's body does goes in the cast entry's `action`.
- **Do not describe the item's looks** in the description (R2): its lock and its reference image carry them. Name it and say what happens: "Jin fires the Kestrel blaster down the aisle".
- **Gray hands.** The reference image of an action usage shows gray hands only to show the grip. The panel prompt asks the image model to draw the holder's own hands, and the consistency check fails a panel that shows gray hands.

The reference order is: cast variations, then items (in the order of `items`), then the previous panel. The image model takes a limited number of references (often 4). When there are too many, the previous panel is dropped first, then items from the end, then cast members from the end. A dropped item keeps its lock in the prompt but loses its reference image, so its look and use drift. When an item matters (the first time it fires, the reveal of an artifact), keep the cast to 2 characters, or use just the character who holds it. Two items in one panel use two slots: attach both only if the story needs both visible.

To change the usage or the holder of a drawn panel, send the whole `items` list again with `update_panel`, and add `"regenerate": true` to redraw it. A list that leaves an item out removes it.

## Writing the Description

The description is the [ACTION] line of the prompt. Write 1 to 3 sentences, about 20 to 60 words:

1. **Who does what:** "Mina pulls the cord to stop the bus."
2. **Composition:** where the camera is, and where things are in the frame, by landmarks: "Mina in the foreground on the left; through the window behind her, the full moon."
3. **Key background:** only what matters: "empty seats, flickering ceiling light".
4. **Mood and light:** "cold blue night light, quiet and tense".

Rules:

- **Names, not looks** (R2). Write "Mina", never "the girl with the black bob". The appearance comes from the lock. Do not describe hair, eyes, faces or clothes, except a change happening in this frame ("Mina pulls her hood up").
- **No text** (R6). No dialogue, no quotes, no signs or screens with words, no "speech bubble", no sound words. Say "a bus stop sign" or "a phone screen glowing", never what it says.
- **One beat** (R5). One action, or one action and its immediate reaction.
- **Concrete and visible.** "Mina flinches away from the window" draws; "Mina feels uneasy about her future" does not.
- **No negatives.** Image models often draw what you mention. Write "an empty bus", not "no people on the bus".
- **Roster names are checked.** Every roster name or alias in the description must be cast or in `offPanelMentions` (see Off-Panel Mentions).

Good:

```
Mina stands in the aisle of the empty bus, one hand on a pole, turning toward the back row where Jin sleeps against the window. Cold blue night light, city lights streaking past outside.
```

Bad, and why:

```
Mina, the girl with black hair and amber eyes in her yellow hoodie, says "Who are you?" to a mysterious boy. There is a sign that says LAST STOP.
```

- restates Mina's appearance (R2);
- dialogue in the picture and a sign with text (R6);
- "a mysterious boy" is Jin: he is visible, so cast him and name him.

## Dialogue and SFX

`dialogue` is a list in reading order. Each line:

```json
{"speakerId": "chr_3e8a51c0d2", "kind": "speech", "text": "This bus doesn't stop here."}
```

| `kind` | What it is | `speakerId` |
|---|---|---|
| `speech` | Said out loud (speech bubble). | the speaker's character id |
| `thought` | Thought (thought bubble). | the thinker's character id |
| `narration` | Caption box, the narrator's voice. | null |
| `sfx` | Sound effect lettering. | null |

Rules:

- **At most 2 bubbles** (speech or thought) per panel, and **at most 25 words per bubble**. More talk means more panels.
- A narration box and a short sound effect may come on top of that. Keep sfx to 1 or 2 words: "hsss", "thud", "ding".
- Write each character's lines in their `speechStyle` (`get_character` shows it).
- A speaker does not have to be visible. An off-panel voice keeps its speaker id; if the description names that character, list them in `offPanelMentions`.
- `speakerId` must be a roster character id, never a name. Unnamed extras speak through narration or are left silent.
- `"dialogue": []` for a silent panel. Silence is a pacing tool (see `reference/webtoon-style-guide`).
- Every line of `dialogue` is drawn over the image by the app. Never put the words in the description.

## Off-Panel Mentions

The app scans the description for every roster character's name and aliases (whole words, any letter case, "Jin's" counts as "Jin"). Each one it finds must be either in the cast or in `offPanelMentions`. If not, `create_panel` is rejected:

```
Mentioned but not attached: Jin. Attach them to characters or list them in offPanelMentions.
```

When the character is **visible**, cast them. When they are **not visible** but named (talked about, on the phone, their photo, their empty seat), list them:

```json
"offPanelMentions": ["Jin"]
```

- Use the character's name or one of their aliases; letter case does not matter.
- Only the description is checked. Dialogue may name anyone.
- Ask yourself whether the name is needed at all: "Mina stares at the empty back seat" draws the same as "Mina stares at Jin's empty seat".
- Archived characters are not checked and cannot be cast.

## Reading the Consistency Check

`create_panel` returns the new version (so do `regenerate_panel`, `update_panel` with `"regenerate": true`, and `edit_panel_image`):

```json
{"panelId": "pnl_0e9b3d61a7", "versionId": "ver_4a6d1f8e33", "status": "ready", "error": null, "imagePath": "panels/pnl_0e9b3d61a7/ver_4a6d1f8e33.png", "warnings": [], "check": {"passed": true, "issues": [], "skipped": false}}
```

Read it in this order:

1. **`status`.** `failed` means no new image: read `error`. The panel exists. Retry once with `regenerate_panel` (never with another `create_panel`). If it fails again, stop and report (R12).
2. **`warnings`.** Each one is a problem the app let through. Read it and fix it or tell the user.
3. **`check`.**
   - `null`: no check ran. Either no vision model is assigned, or the version is an image edit (edits are never checked). Nothing to do.
   - `"passed": true` with `"skipped": false`: the image matches the references. Good.
   - `"skipped": true`: the checker could not run, did not answer in time, or could not be read; the issue text says why, and `warnings` has a line about it. Treat the panel as unchecked. Do not retry for this. When the issue starts "Consistency check failed to run", the vision model itself failed (out of credit, signed out, unreachable) and the next panels will not be checked either: stop after this panel and tell the user, unless they told you to go on without checks. The panel's card shows "Not checked".
   - `"passed": false`: the image does not match. The app has already redrawn the panel automatically (once by default) with the issues as fix instructions, and this is the final attempt: the result shows the image that is current now. All attempts stay in the panel's history. (If the automatic redraw itself failed to render, the earlier image stays current, and the failed attempt is only in the history: read it with `get_panel`.)

When `"passed"` is `false`, decide by the issues:

| Issue is about | Fix with |
|---|---|
| A detail of one character: hair color, a missing scar, outfit color, wrong eye color | `edit_panel_image` with one instruction that names the character and the correct detail. |
| Text, letters or bubbles in the image | `edit_panel_image`: "Remove all text and lettering from the image" |
| The wrong number of people, a missing or extra character, the wrong character | Check your cast and description. Fix them with `update_panel` and `"regenerate": true`. |
| The setting or composition | `update_panel` with a clearer description or setting, and `"regenerate": true`. |
| Anything you cannot fix | Report it to the user, quoting the issues briefly. |

Make **one** manual fix per panel. A regenerated fix is checked again; an edit is not (its `check` is null), so if your model can see images, look at the edited image in the result. If the fix did not work, stop and report: the user can open the panel (click its card) to choose a version with the ‹ vN / M › switcher in the editor's header, ask its panel chat for an edit, or accept it.

## Examples

### Example 1: the next panel of a scene

State: the episode's last panel (pnl_1c7e5a20f4) is a close-up of Mina at the bus stop, in her school uniform (var_4c19d2e8a0), at night. The next planned beat is bt_3a9c1e7f52, "The night bus pulls up, its doors already open."

1. Read the recent panels:

```
list_panels {"episodeId": "epi_5d0c3b9a12", "last": 3}
```

2. The beat shows the bus arriving with Mina watching: one character, a wide shot to show the bus, standard aspect.
3. Draw:

```
create_panel {
  "episodeId": "epi_5d0c3b9a12",
  "description": "An old city bus glides up to the empty stop, its doors already open, warm light spilling onto the wet pavement. Mina stands at the edge of the curb on the right, watching it.",
  "setting": "Roadside bus stop at night, wet pavement, one flickering streetlight",
  "location": "bus stop",
  "shot": "wide",
  "characters": [{"characterId": "chr_3e8a51c0d2", "variationId": "var_4c19d2e8a0", "action": "stands at the curb, holding her bag strap", "expression": "surprised", "position": "right"}],
  "dialogue": [{"speakerId": null, "kind": "sfx", "text": "hsss"}],
  "continuityNotes": "Layout: the flickering streetlight is at the left edge of the frame; the road runs along the bottom. Same night as the previous panel."
}
```

4. Result: `"status": "ready"`, `"warnings": []`, `"check": {"passed": true, ...}`. Mark the beat:

```
update_beat {"beatId": "bt_3a9c1e7f52", "status": "drawn"}
```

### Example 2: two characters talking

Beat: "Jin wakes and asks Mina why she can see this bus." Both are visible; Jin's base (var_0a5e3f8c26) is ready.

```
create_panel {
  "episodeId": "epi_5d0c3b9a12",
  "description": "Jin sits up in the back row, half awake, looking at Mina, who stands in the aisle a few steps away. Empty seats between them, city lights streaking past the windows.",
  "setting": "Inside the night bus, back section, midnight",
  "location": "night bus",
  "shot": "medium",
  "aspect": "3:4",
  "characters": [
    {"characterId": "chr_9f61b2d47a", "variationId": "var_0a5e3f8c26", "action": "sits up in the back seat, one hand rubbing his eyes", "expression": "suspicious, sleepy", "position": "left"},
    {"characterId": "chr_3e8a51c0d2", "variationId": "var_4c19d2e8a0", "action": "stands in the aisle holding a pole", "expression": "startled", "position": "right"}
  ],
  "dialogue": [
    {"speakerId": "chr_9f61b2d47a", "kind": "speech", "text": "You can see this bus?"},
    {"speakerId": "chr_3e8a51c0d2", "kind": "speech", "text": "Seriously? It's a bus. Everyone can see it."}
  ],
  "continuityNotes": "Layout: the back row is on the left of the frame, the aisle runs to the right toward the driver. Same cold blue night light as the previous panel."
}
```

### Example 3: an establishing shot with nobody in it

First panel of a new scene, nobody visible. Its new location means nothing is sent from the last place, and its description sets the layout the scene keeps:

```
create_panel {
  "episodeId": "epi_5d0c3b9a12",
  "description": "A small hillside town at dawn, rows of tiled roofs, the pale moon still visible low over the river.",
  "setting": "Hillside town above a river, early dawn",
  "location": "hillside town",
  "shot": "establishing",
  "aspect": "16:9",
  "characters": [],
  "dialogue": [{"speakerId": null, "kind": "narration", "text": "The next morning."}],
  "continuityNotes": "Layout: the river runs along the bottom of the frame, the town climbs the hill to the right."
}
```

### Example 4: an off-panel mention

Beat: "Mina reads a message from Jin." Jin is not visible, but the description names him:

```
create_panel {
  "episodeId": "epi_5d0c3b9a12",
  "description": "Mina sits on her bed in the dark, her face lit by her phone screen as she reads a message from Jin.",
  "setting": "Mina's small bedroom at night, curtains open, moonlight on the floor",
  "location": "Mina's bedroom",
  "shot": "medium",
  "characters": [{"characterId": "chr_3e8a51c0d2", "variationId": "var_7b20c4e9f1", "action": "sits cross-legged on the bed, holding her phone", "expression": "anxious", "position": "center"}],
  "dialogue": [{"speakerId": "chr_9f61b2d47a", "kind": "speech", "text": "Don't take that bus again."}],
  "offPanelMentions": ["Jin"]
}
```

Jin's line is shown as a message bubble: a speaker does not have to be visible.

### Example 5: a rejected call and its fix

You sent a panel whose description says "Grandma waves from the doorway" with only Mina in the cast. The result:

```
Mentioned but not attached: Grandma Oksun. Attach them to characters or list them in offPanelMentions.
```

Grandma is visible in the doorway, so she must be cast. Add her entry (her base is var_6e1a3c5b97) and call `create_panel` again with the same other fields:

```json
{"characterId": "chr_2d4f6a8c01", "variationId": "var_6e1a3c5b97", "action": "waves from the doorway", "expression": "warm smile", "position": "background"}
```

A rejected call creates nothing, so calling `create_panel` again is right here. (A call that returned `"status": "failed"` did create the panel: retry that one with `regenerate_panel`.)

### Example 6: a failed check

The result of `create_panel` for pnl_0e9b3d61a7 has:

```json
"check": {"passed": false, "issues": ["Mina's hair is brown here but black in her reference image."], "skipped": false}
```

The app already redrew it once. This is a local detail, so make one edit:

```
edit_panel_image {"panelId": "pnl_0e9b3d61a7", "instruction": "Make Mina's hair black, matching her reference image"}
```

An edit is not checked by the app, so its `check` is null. If the result is `ready` (and, if you can see images, the hair now looks black), report the fix in one sentence. If the edit failed or the hair is still wrong, stop and tell the user: "Panel 6 still shows Mina with brown hair after an automatic retry and one edit. You can open the panel to pick another version, or ask its chat for an edit."

### Example 7: inserting a panel between two others

The user wants a reaction shot between panel 2 (pnl_1c7e5a20f4) and panel 3. Insert after panel 2:

```
create_panel {
  "episodeId": "epi_5d0c3b9a12",
  "afterPanelId": "pnl_1c7e5a20f4",
  "description": "Mina's eyes widen as warm headlights sweep across her face.",
  "setting": "Roadside bus stop at night",
  "location": "bus stop",
  "shot": "extreme-close-up",
  "aspect": "1:1",
  "characters": [{"characterId": "chr_3e8a51c0d2", "variationId": "var_4c19d2e8a0", "expression": "wide-eyed, lips parted", "position": "center"}],
  "dialogue": [],
  "continuityNotes": "Layout: the flickering streetlight is at the left edge of the frame; the road runs along the bottom. Headlights now add warm light from the left."
}
```

### Example 8: a reverse shot in the same place

The bus scene was set up with "Layout: the back row is on the left of the frame, the aisle runs to the right toward the driver." Now the reader must see the aisle from the back row, so the camera turns around:

```
create_panel {
  "episodeId": "epi_5d0c3b9a12",
  "description": "Reverse shot from the back row, looking down the aisle toward the front: Mina stands in the aisle in the middle of the frame, the empty driver's seat far behind her, city lights streaking past the windows on both sides.",
  "setting": "Inside the night bus, midnight",
  "location": "night bus",
  "shot": "medium",
  "characters": [{"characterId": "chr_3e8a51c0d2", "variationId": "var_4c19d2e8a0", "action": "holds a pole, turning back toward the camera", "expression": "wary", "position": "center"}],
  "dialogue": [],
  "continuityNotes": "Layout: the back row is on the left of the frame, the aisle runs to the right toward the driver. This panel is the reverse shot, from the back row."
}
```

The description announces the reverse shot and gives its own sides, so the check judges those. The next panel from the usual side copies the Layout line again, without the reverse-shot sentence.
