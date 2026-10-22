# Panel Generation

## Purpose

This doc tells you how to draw a new panel with `create_panel` so that the right characters appear, they look like themselves, and the panel continues from the one before it. Read it before your first `create_panel` in a session. For shot and aspect choices, also read `reference/webtoon-style-guide`.

What the app does for you when you call `create_panel`:

1. It checks your input: every cast member is a roster character, not archived, with a variation that belongs to them and has a ready reference image; no one is cast twice; every speaker is a roster character; every roster name in the description is cast or declared off-panel.
2. It builds the image prompt: the style, your setting and description, and one line per cast member with their appearance lock, variation, action, expression and position. Dialogue is never in the prompt.
3. It sends reference images with the prompt: each cast member's variation image (in cast order), then the previous panel's current image.
4. It generates the image and stores it as a new version of the panel.
5. If a vision model is assigned, it checks the image against the references and redraws automatically when the check fails (see Reading the Consistency Check).

Your job is to give it the right cast, variations and words. Every id in this doc is an example.

## Pipeline

Follow these 10 steps for every new panel.

1. **Read the state.** Look at `<project_state>` and call `list_panels` for the episode (R4). If your model can see images, `view_panel_image` the last panel. Know where everyone is, what they wear and what just happened.
2. **Choose the beat.** The next `planned` beat (from `get_story`), or what the user asked for. One beat per panel (R5).
3. **Choose the cast.** Who is visible in this frame. At most 3 in the foreground. Named characters must be in the roster (R1); unnamed extras are described in words.
4. **Choose variations.** Keep each character's variation from the previous panel, unless the story changes their look.
5. **Choose shot and aspect.** What the reader must see decides the shot; the pace decides the aspect.
6. **Write the description.** Action and composition, never appearance (R2), never text (R6).
7. **Write continuity notes.** What must match the previous panel.
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
- `position`: `left`, `center`, `right` or `background`. Default `center`. Give two characters different positions.
- Write `action` and `expression` as short phrases without a final period: the app adds one.

Rules:

- **Visible means cast.** If a named character can be seen, even small or from behind, cast them (R2). If they cannot be seen, do not cast them.
- **At most 3 in the foreground.** More faces means less likeness for each. Put a fourth person in `background`, or split the moment into two panels.
- **Order matters.** Put the most important character first. The image model accepts a limited number of reference images (often 4). When there are too many, the previous panel's image is dropped first, then cast members from the end of the list. With 3 cast members plus the previous panel you are at that limit.
- **Unnamed extras are words.** "A tired bus driver in a gray uniform", "a crowd of commuters". Never give them names. If an extra becomes important and recurs, create them as a character first (R1; in user-led mode, ask first).
- **A scene with nobody in it** (an establishing shot, an object close-up) has `"characters": []`.

## Choosing Variations

1. **Keep what they wore.** In `recent_panels` each cast member shows the variation id they wear: `Mina (var_4c19d2e8a0)`. Use the same id in the next panel unless the story changes it.
2. **Change only for a story reason.** She changed clothes, it is a flashback (an `age` variation), she transformed (a `form` variation). Show the change happening, or start a new scene.
3. **Only ready variations.** The variation's status must be `ready`. If it is `failed`, run `regenerate_variation` first. If it does not exist yet and the look will recur, create it (`workflows/character-creation`).
4. **Each character's own variation.** A variation id belongs to one character. Copy it from that character's line.
5. **Default is Base.** For a character's first appearance with no special look, cast the variation named "Base".

## Using the Previous Panel

The previous panel is the panel right before the new one in the episode: the last panel, or the panel named in `afterPanelId`.

When the previous panel has a ready image, the app:

- sends that image as the last reference image, and
- adds a [CONTINUITY] line to the prompt: "Continues directly from the previous panel (reference image N). Keep setting layout, lighting, time of day and outfits consistent." followed by your `continuityNotes`.

When there is no previous panel (the first panel of an episode), or it has no ready image, there is **no** [CONTINUITY] line and your `continuityNotes` are **not used**. Put details that must hold into `setting` and `description` instead.

Writing `continuityNotes`:

- One or two sentences on what must match: time of day, weather, light, props and where they are, held objects, injuries, outfit details.
- Good: "Same rainy dusk and wet street as the previous panel. Mina still holds the red umbrella in her right hand."
- Do not restate appearance (R2): the references and locks handle that.

Starting a new scene: the app still sends the previous panel and asks to continue from it. Say so in the notes: "New scene: a different place and time from the previous panel; keep only the characters' looks." Use an establishing or wide shot for the first panel of a scene.

Inserting between panels: `afterPanelId` puts the new panel after that panel (null puts it first). Continuity is then taken from that panel, and the panel after the new one will continue from the new one the next time it is redrawn.

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

## Writing the Description

The description is the [ACTION] line of the prompt. Write 1 to 3 sentences, about 20 to 60 words:

1. **Who does what:** "Mina pulls the cord to stop the bus."
2. **Composition:** where things are in the frame: "Mina in the foreground on the left; through the window behind her, the full moon."
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
   - `"skipped": true`: the checker could not run or could not be read; the issue text says why. Treat the panel as unchecked. Do not retry for this.
   - `"passed": false`: the image does not match. The app has already redrawn the panel automatically (once by default) with the issues as fix instructions, and this is the final attempt: the result shows the image that is current now. All attempts stay in the panel's history. (If the automatic redraw itself failed to render, the earlier image stays current, and the failed attempt is only in the history: read it with `get_panel`.)

When `"passed"` is `false`, decide by the issues:

| Issue is about | Fix with |
|---|---|
| A detail of one character: hair color, a missing scar, outfit color, wrong eye color | `edit_panel_image` with one instruction that names the character and the correct detail. |
| Text, letters or bubbles in the image | `edit_panel_image`: "Remove all text and lettering from the image" |
| The wrong number of people, a missing or extra character, the wrong character | Check your cast and description. Fix them with `update_panel` and `"regenerate": true`. |
| The setting or composition | `update_panel` with a clearer description or setting, and `"regenerate": true`. |
| Anything you cannot fix | Report it to the user, quoting the issues briefly. |

Make **one** manual fix per panel. A regenerated fix is checked again; an edit is not (its `check` is null), so if your model can see images, look at the edited image in the result. If the fix did not work, stop and report: the user can choose a version in the panel side chat, edit it there, or accept it.

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
  "shot": "wide",
  "characters": [{"characterId": "chr_3e8a51c0d2", "variationId": "var_4c19d2e8a0", "action": "stands at the curb, holding her bag strap", "expression": "surprised", "position": "right"}],
  "dialogue": [{"speakerId": null, "kind": "sfx", "text": "hsss"}],
  "continuityNotes": "Same night, same bus stop and flickering streetlight as the previous panel."
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
  "continuityNotes": "Same bus interior and cold blue night light as the previous panel."
}
```

### Example 3: an establishing shot with nobody in it

First panel of a new scene, nobody visible:

```
create_panel {
  "episodeId": "epi_5d0c3b9a12",
  "description": "A small hillside town at dawn, rows of tiled roofs, the pale moon still visible low over the river.",
  "setting": "Hillside town above a river, early dawn",
  "shot": "establishing",
  "aspect": "16:9",
  "characters": [],
  "dialogue": [{"speakerId": null, "kind": "narration", "text": "The next morning."}],
  "continuityNotes": "New scene: a different place and time from the previous panel."
}
```

### Example 4: an off-panel mention

Beat: "Mina reads a message from Jin." Jin is not visible, but the description names him:

```
create_panel {
  "episodeId": "epi_5d0c3b9a12",
  "description": "Mina sits on her bed in the dark, her face lit by her phone screen as she reads a message from Jin.",
  "setting": "Mina's small bedroom at night, curtains open, moonlight on the floor",
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

An edit is not checked by the app, so its `check` is null. If the result is `ready` (and, if you can see images, the hair now looks black), report the fix in one sentence. If the edit failed or the hair is still wrong, stop and tell the user: "Panel 6 still shows Mina with brown hair after an automatic retry and one edit. You can pick or edit a version in its side chat."

### Example 7: inserting a panel between two others

The user wants a reaction shot between panel 2 (pnl_1c7e5a20f4) and panel 3. Insert after panel 2:

```
create_panel {
  "episodeId": "epi_5d0c3b9a12",
  "afterPanelId": "pnl_1c7e5a20f4",
  "description": "Mina's eyes widen as warm headlights sweep across her face.",
  "setting": "Roadside bus stop at night",
  "shot": "extreme-close-up",
  "aspect": "1:1",
  "characters": [{"characterId": "chr_3e8a51c0d2", "variationId": "var_4c19d2e8a0", "expression": "wide-eyed, lips parted", "position": "center"}],
  "dialogue": [],
  "continuityNotes": "Same night and streetlight as the previous panel; headlights now add warm light from the left."
}
```
