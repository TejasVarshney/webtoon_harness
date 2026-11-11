# Prompt Templates

This is a reference for the exact prompts the app builds from your fields. You never write these prompts yourself: the app composes them when you call `create_panel`, `regenerate_panel`, `edit_panel_image`, `create_character`, `create_variation`, `regenerate_variation`, `create_item`, `create_item_usage`, `regenerate_item_usage`, `create_location`, `create_location_state` or `regenerate_location_state`. Read this doc to understand why an image came out the way it did, and to write fields that read well inside the prompt.

Placeholders are in braces. Every other character, including punctuation, is exactly what the app sends.

## Panel Prompt

Used for every generated panel image (`create_panel`, `regenerate_panel`, `update_panel` with `"regenerate": true`, and `regenerate_image` in the panel chat):

```
[STYLE] {stylePreset}. Vertical-scroll webtoon panel, {aspect} aspect ratio, {shot} shot. No text, no speech bubbles, no captions, no watermark.
[SETTING] {setting}
[ACTION] {description}
[CHARACTERS]
- {name} (reference image {n}): {appearanceLock} Look: {variation.name} — {variation.delta}. Action: {action}. Expression: {expression}. Position: {position}.
[CONTINUITY] Continues directly from the previous panel (reference image {m}). Keep setting layout, lighting, time of day and outfits consistent. {continuityNotes}
```

Where each part comes from:

| Placeholder | Source |
|---|---|
| {stylePreset} | The project's style (the `style` line of `<project_state>`). |
| {aspect} | The panel's draw aspect, e.g. 2:3 (1:2 and 1:3 are drawn at 9:16). |
| {shot} | The panel's `shot`, written exactly as stored: "close-up shot", "extreme-close-up shot", "birds-eye shot". |
| {setting} | The panel's `setting`. |
| {description} | The panel's `description`. |
| {name} | The cast member's character name. |
| {n} | The number of that character's reference image (see Reference images below). |
| {appearanceLock} | The character's appearance lock, verbatim. |
| {variation.name}, {variation.delta} | The name and delta of the variation the character wears in this panel. |
| {action}, {expression}, {position} | The cast entry's fields. |
| {m} | The number of the reference image the panel continues from: the previous panel, or an earlier panel in the same place. |
| {continuityNotes} | The panel's `continuityNotes`. |
| {item.name}, {item.appearanceLock} | The name and item lock of an item attached to the panel (only in the panel prompt with items, below). |
| {k} | The number of that item's reference image. |
| {usage.name}, {usage.delta} | The name and delta of the usage the panel picks for the item. |
| {item.action} | The `action` of the panel's `items` entry: what the item itself does in this frame. |

Two optional sentences end the `[STYLE]` line, each after a space. A panel gets at most one:

- Tall panel (`aspect` 1:2 or 1:3, always faded, even when borderless): `Tall panel: keep the top fifth and bottom fifth plain background (sky, floor, darkness), so they can fade out.`
- Borderless panel (`frame` borderless, not tall): `Art runs to the edges, no frame.`

How the template bends:

- **[CHARACTERS]** has one line per cast entry, in cast order. With an empty cast, nothing follows the [CHARACTERS] line. When character sheets are packed onto one image, a sentence follows it on the same line (see Panel Prompt with packed character sheets).
- **Empty parts are left out** of a cast line. A variation with no delta reads "Look: Base." (no dash). An empty `action` leaves out "Action: ...", An empty `expression` leaves out "Expression: ...", an empty `position` leaves out "Position: ..." (the default is center).
- **No reference image:** when the variation has no ready image, or its image was dropped for the reference limit, "(reference image {n})" reads "(no reference image)".
- **[CONTINUITY]** depends on the image the panel continues from (`workflows/panel-generation`, Using the Previous Panel, says how the app picks it):
  - **The previous panel:** the line shown above, with your `continuityNotes` after it. An empty `continuityNotes` leaves the line ending at "consistent."
  - **An earlier panel in the same place**, when the panel has a `location` and the panel right before is a tight shot of that place or another place:

    ```
    [CONTINUITY] Same place as an earlier panel (reference image {m}). Keep the layout of the place and its landmarks consistent with it. {continuityNotes}
    ```

  - **None** (the first panel of an episode, a previous panel with no ready image, or a `location` no earlier panel has): the line holds only your notes, and is left out when they are empty:

    ```
    [CONTINUITY] {continuityNotes}
    ```
- **[FIX]** is added as a last line only when the app redraws a panel after a failed consistency check: "[FIX] Fix these consistency issues: {issue 1}; {issue 2}".
- **Dialogue is never in the prompt.** It is drawn over the image by the app.
- **Periods are added for you.** The app writes a period after the variation look, the action, the expression and the position. End `delta`, `action` and `expression` without a period, or the prompt gets "..".

Reference images, in this order:

1. each cast member's variation image, in cast order (packed sheets share one image, in the place of the first of them);
2. the location's picture (only when the panel has a location with a ready picture; see Panel Prompt with a location);
3. the image of the usage each attached item uses, in panel order (only when the panel has items);
4. the user's layout sketch (only when the panel has one);
5. the panels the user chose as references (only when the panel has some with a picture; see Panel Prompt with chosen panels);
6. the image the panel continues from: the previous panel's current image, or an earlier panel's in the same place.

The image model accepts a limited number of reference images (set per model in Settings → Models, 4 by default). When there are more, the app first packs character sheets: it draws the sheets of the last cast members side by side on one image, each under the character's name, and sends them as one reference image. It packs as few as it takes (at least 2, at most 4), so the first characters keep a sheet of their own (see Panel Prompt with packed character sheets). If there are still too many, or the packed image cannot be drawn, the previous panel's image is dropped first, then the chosen panels from the end, then the sketch, then items from the end of the list, then the location's picture, then cast members from the end of the list; a dropped entry's line reads "(no reference image)", and a dropped sketch takes its [LAYOUT] line with it, and chosen panels that were dropped are left out of the [REFERENCE PANELS] line. A packed sheet is drawn smaller than a sheet of its own, and small details can drift between neighbors. This is why the most important character goes first, why 3 foreground characters is the maximum, and why a panel where an item matters keeps its cast to 2.

Worked example. The project style is the default, Jin wears his base variation (no delta) and Mina wears "Outfit: School uniform"; the previous panel has a ready image:

```
[STYLE] Clean full-color Korean webtoon style, crisp line art, soft cel shading, expressive faces. Vertical-scroll webtoon panel, 3:4 aspect ratio, medium shot. No text, no speech bubbles, no captions, no watermark.
[SETTING] Inside the night bus, back section, midnight
[ACTION] Jin sits up in the back row, half awake, looking at Mina, who stands in the aisle a few steps away. Empty seats between them, city lights streaking past the windows.
[CHARACTERS]
- Jin (reference image 1): Eighteen-year-old boy, tall and lanky. Narrow face, sharp chin, straight thin nose. Short messy black hair. Narrow dark-brown eyes, thick straight eyebrows. Pale cool skin. Silver ring in the right ear. Default outfit: black hooded windbreaker over a gray T-shirt, dark jeans, worn black high-top sneakers. Palette: black, gray, silver, dark brown. Look: Base. Action: sits up in the back seat, one hand rubbing his eyes. Expression: suspicious, sleepy. Position: left.
- Mina (reference image 2): Seventeen-year-old girl, slim build, average height. Oval face with soft jaw, small straight nose, faint freckles across the cheeks. Shoulder-length straight black bob with blunt bangs. Large amber eyes, thin dark eyebrows. Light warm skin. Small crescent-shaped scar above the left eyebrow. Default outfit: oversized mustard-yellow hoodie, dark gray pleated skirt, black tights, white sneakers. Palette: black, amber, mustard yellow, charcoal gray. Look: Outfit: School uniform — Instead of the default outfit: navy blazer with white piping, white shirt, red ribbon tie, navy pleated skirt, navy knee socks, brown loafers. Action: stands in the aisle holding a pole. Expression: startled. Position: right.
[CONTINUITY] Continues directly from the previous panel (reference image 3). Keep setting layout, lighting, time of day and outfits consistent. Same bus interior and cold blue night light as the previous panel.
```

Reference images sent: 1 = Jin's base image, 2 = Mina's school-uniform image, 3 = the previous panel's current image.

### Panel Prompt with items

When the panel has `items`, an [ITEMS] block follows the [CHARACTERS] lines and before [CONTINUITY]:

```
[STYLE] {stylePreset}. Vertical-scroll webtoon panel, {aspect} aspect ratio, {shot} shot. No text, no speech bubbles, no captions, no watermark.
[SETTING] {setting}
[ACTION] {description}
[CHARACTERS]
- {name} (reference image {n}): {appearanceLock} Look: {variation.name} — {variation.delta}. Action: {action}. Expression: {expression}. Position: {position}.
[ITEMS] Draw each item exactly as its reference image shows it, and use it exactly as its reference shows. Gray hands in an item reference only show the grip: draw the holder's own hands, never gray hands.
- {item.name} (reference image {k}): {item.appearanceLock} Use: {usage.name} — {usage.delta}. Held by: {name}. Action: {item.action}.
[CONTINUITY] Continues directly from the previous panel (reference image {m}). Keep setting layout, lighting, time of day and outfits consistent. {continuityNotes}
```

How the item lines bend:

- **One line per `items` entry**, in panel order. The [ITEMS] block is left out when the panel has no items.
- **The item lock is always in the line**, even when the reference image is dropped for the limit.
- **Use:** is the usage's name and delta. A usage with no delta reads "Use: {usage.name}." (no dash).
- **Held by:** is the holder's character name, or "nobody" when `heldBy` is null.
- **Action:** is left out when the entry's `action` is empty.
- **No reference image:** when the usage has no ready image, or its image was dropped for the reference limit, "(reference image {k})" reads "(no reference image)".
- The gray hands in an action usage's reference only show the grip. The [ITEMS] sentence tells the image model to draw the holder's own hands instead.

Worked example. Jin fires the Kestrel blaster (usage "Firing") while Mina ducks; with both locks, the item, and the previous panel, that is 4 reference images:

```
[STYLE] Clean full-color Korean webtoon style, crisp line art, soft cel shading, expressive faces. Vertical-scroll webtoon panel, 3:4 aspect ratio, medium shot. No text, no speech bubbles, no captions, no watermark.
[SETTING] Inside the night bus, aisle, midnight
[ACTION] Jin fires the Kestrel blaster down the dark bus aisle while Mina ducks behind a seat. A cyan beam cuts through the dim cabin.
[CHARACTERS]
- Jin (reference image 1): Eighteen-year-old boy, tall and lanky. Narrow face, sharp chin, straight thin nose. Short messy black hair. Narrow dark-brown eyes, thick straight eyebrows. Pale cool skin. Silver ring in the right ear. Default outfit: black hooded windbreaker over a gray T-shirt, dark jeans, worn black high-top sneakers. Palette: black, gray, silver, dark brown. Look: Base. Action: braces his feet in the aisle and fires. Expression: grim. Position: left.
- Mina (reference image 2): Seventeen-year-old girl, slim build, average height. Oval face with soft jaw, small straight nose, faint freckles across the cheeks. Shoulder-length straight black bob with blunt bangs. Large amber eyes, thin dark eyebrows. Light warm skin. Small crescent-shaped scar above the left eyebrow. Default outfit: oversized mustard-yellow hoodie, dark gray pleated skirt, black tights, white sneakers. Palette: black, amber, mustard yellow, charcoal gray. Look: Outfit: School uniform — Instead of the default outfit: navy blazer with white piping, white shirt, red ribbon tie, navy pleated skirt, navy knee socks, brown loafers. Action: ducks behind a seat, hands over her head. Expression: frightened. Position: right.
[ITEMS] Draw each item exactly as its reference image shows it, and use it exactly as its reference shows. Gray hands in an item reference only show the grip: draw the holder's own hands, never gray hands.
- Kestrel blaster (reference image 3): Compact pistol, a hand and a half long, boxy frame with a short rounded barrel. Matte graphite-gray alloy body, brushed brass trim, three thin brass stripes on the left of the slide. A thin cyan light strip runs along the top of the barrel and a small cyan dot glows at the muzzle. Fin-shaped rear sight, oversized round trigger guard, grip wrapped in dark teal cord. Use: Firing — Both hands grip it, right index finger on the trigger, arms straight with a slight recoil; a thin cyan beam leaves the muzzle and the light strip glows bright. Held by: Jin. Action: aimed down the aisle, muzzle glowing.
[CONTINUITY] Continues directly from the previous panel (reference image 4). Keep setting layout, lighting, time of day and outfits consistent. Same night bus interior and dim light as the previous panel.
```

Reference images sent: 1 = Jin's base image, 2 = Mina's school-uniform image, 3 = the blaster's "Firing" image, 4 = the previous panel's current image. With a cap of 3, Jin's and Mina's sheets are packed onto reference image 1, and the blaster and the previous panel become 2 and 3. With a cap of 2, the previous panel is dropped too: the [CONTINUITY] line then reads "the previous panel (no reference image)". With a cap of 1, the blaster is dropped as well: its line reads "- Kestrel blaster (no reference image): ..." and keeps its lock, but its look and use can drift.

### Panel Prompt with packed character sheets

When the references are over the image model's limit and at least 2 cast members have a ready image, the sheets of the last cast members are packed onto one image. The pack takes the place of its first member, a sentence follows [CHARACTERS], and each packed member's line names its sheet:

```
[STYLE] {stylePreset}. Vertical-scroll webtoon panel, {aspect} aspect ratio, {shot} shot. No text, no speech bubbles, no captions, no watermark.
[SETTING] {setting}
[ACTION] {description}
[CHARACTERS] Reference image {p} holds {count} character sheets, each labeled with the person's name, only to show what each person looks like: never copy its layout, background, poses or labels.
- {name} (reference image {n}): {appearanceLock} Look: {variation.name} — {variation.delta}. Action: {action}. Expression: {expression}. Position: {position}.
- {name} (reference image {p}, the sheet labeled {name}): {appearanceLock} Look: {variation.name} — {variation.delta}. Action: {action}. Expression: {expression}. Position: {position}.
- {name} (reference image {p}, the sheet labeled {name}): {appearanceLock} Look: {variation.name} — {variation.delta}. Action: {action}. Expression: {expression}. Position: {position}.
[CONTINUITY] Continues directly from the previous panel (reference image {m}). Keep setting layout, lighting, time of day and outfits consistent. {continuityNotes}
```

{p} is the number of the packed image and {count} the number of sheets on it.

- **As few as it takes.** Each sheet packed with another frees one slot, so the app packs just enough of the last ready cast members to fit the limit, at least 2 and at most 4. A location's ready picture counts toward the limit like an item. With 4 references allowed, 3 cast members, an item and the previous panel pack the last two characters; 4 cast members, an item, a sketch and the previous panel pack all four. When even 4 on one image leave more cast than slots (a limit of 1 or 2 with a big cast), the first ones are packed instead, and the last ones are dropped.
- **Layout.** Two sheets sit side by side; three or four fill a 2 × 2 grid, left to right, then top to bottom, in cast order (three leave the last corner blank). A white band above each sheet holds the character's name in large bold type. The name is only on the reference image: the panel itself is still drawn with no text.
- **Only character sheets are packed,** and only for a generation. Item images and a location's picture are never packed, and an edit drops references over its limit as before.
- **The packed image is stored in the panel's folder** and reused by every redraw with the same sheets and names. A version's reference images list it like any other.
- If the packed image cannot be drawn, the panel is drawn without it, dropping references as described above.

Worked example. With 4 references allowed, Jin, Mina and Dohyun are cast, Jin holds the Kestrel blaster, and the previous panel has a ready image. That is 5 references, so Mina's and Dohyun's sheets are packed: 1 = Jin's image, 2 = one image with Mina's sheet on the left and Dohyun's on the right, 3 = the blaster's image, 4 = the previous panel. The [CHARACTERS] line reads "[CHARACTERS] Reference image 2 holds 2 character sheets, ...", Jin's line reads "- Jin (reference image 1): ...", and Mina's reads "- Mina (reference image 2, the sheet labeled Mina): ...".

### Panel Prompt with a location

When the panel has a `location`, a [LOCATION] line follows the [SETTING] line:

```
[SETTING] {setting}
[LOCATION] {location.name} (reference image {l}): {location.layout} State: {state.name} — {state.delta}. Camera: its main angle, so every landmark stays on the side of the frame the layout gives. The reference shows the empty place from its main camera angle, only for its architecture and where its landmarks are, not its lighting: the light and the time of day come from the setting and the state. Draw it from this panel's camera and shot, with the cast in it.
[ACTION] {description}
```

- **{location.name}, {location.layout}** are the saved location's name and layout. **{l}** is the number of its picture: it is claimed right after the cast, so its number follows the cast's even though the line comes first.
- **The picture** is the state's own picture when it has a ready one, else the base picture: the state's words then carry the change. With no ready picture (or one dropped for the reference limit), the marker reads "(no reference image)" and the last two sentences, about the reference, are left out.
- **State:** a panel in the base state ("Default") has no "State: ..." sentence. A state with no delta reads "State: {state.name}."
- **Camera:** `main` (or empty) gives the sentence above. `reverse` gives:

  ```
  Camera: reverse angle, facing the other way, so the landmarks the layout puts on frame-left are on frame-right and the other way round.
  ```

  Any other words give "Camera: {camera}." (a final period of yours is not doubled).
- `edit_panel_image` sends no location picture and no [LOCATION] line: an edit keeps the image's own place.

### Panel Prompt with a layout sketch

The user can scribble a rough layout of the panel in focus mode (Sketch). When the panel has a sketch, a [LAYOUT] line follows the [CHARACTERS] lines (and [ITEMS], when there are items) and comes before [CONTINUITY]:

```
[LAYOUT] Follow the rough composition of the sketch (reference image {s}): where the figures and objects sit, their poses, the camera angle and the framing. It is a rough guide only: never copy its scribbled lines, flat colours or blank background, and draw everything in the style above.
```

- **Only a generation sends it.** `edit_panel_image` keeps the image's own composition, so an edit gets no sketch and no [LAYOUT] line.
- **The consistency check never sees it.** The checker compares the picture with the cast, the items and the previous panel; the sketch is a guide, not something to match.
- **Write the description to agree with it.** The sketch says where things are; the description says what happens. When they disagree, the image model has to guess.

### Panel Prompt with chosen panels

The user can shift-select panels on the strip and draw a panel with them as reference, and can give one panel a style or a prompt of its own. When the panel has chosen panels with a picture, one [REFERENCE PANELS] line follows [LAYOUT] (or the [CHARACTERS] and [ITEMS] lines, without a sketch) and comes before [CONTINUITY]:

```
[REFERENCE PANELS] Reference image {r} is a panel the user chose: match its characters, art style, palette and setting. Never copy its composition.
```

With several, it reads "Reference images {r1} and {r2} are panels the user chose: match their characters, art style, palette and setting. Never copy their composition." and, with three or more, "{r1}, {r2} and {r3}". Only the panels that were sent are numbered.

- **Only a generation sends them.** `edit_panel_image` keeps the image's own composition, so an edit gets no chosen panels and no [REFERENCE PANELS] line.
- **A chosen panel that is gone, or has no picture, is skipped.** The draw goes on without it.
- **The consistency check never sees them.** They are guides for the look, not something to match.
- **A style of the panel's own replaces {stylePreset} in the [STYLE] line.** The project's style is untouched.
- **A prompt of the panel's own is sent instead of the whole composed prompt**, with the same reference images and the [FIX] line after a failed check. The Scene tab says when a panel has one. The tools do not set any of these three: they are the user's choices.

## Base Reference Prompt

Used for a character's base variation (`create_character`, and `regenerate_variation` on the base). No reference image is sent; the image is upright (2:3).

```
Character reference sheet. {stylePreset}. Full body, front view, neutral expression, standing straight, plain light-gray background, even studio lighting, no text. {appearanceLock}
```

The lock is the only part you control, so it must carry the whole look (see `workflows/character-creation`). Camera, pose and background words are already in the prompt: keep them out of the lock.

## Variation Prompt

Used for every other variation (`create_variation`, `regenerate_variation`). The character's base image is sent as the one reference image; the image is upright (2:3).

```
Character reference sheet. {stylePreset}. Full body, front view, plain light-gray background, no text. {appearanceLock} Variation: {variation.name} — {variation.delta}. Keep face, hair, body and colors identical to the reference image except for the variation.
```

- The full lock is in this prompt too, including the default outfit. That is why an outfit delta starts with "Instead of the default outfit:".
- Unlike the panel prompt, this one always writes " — " and the delta, so always give a delta, written without a final period.
- If the base image is not ready, no prompt is sent: the variation fails with "Base reference image is not ready".

## Item Reference Prompt

Used for an item's base usage "At rest" (`create_item`, and `regenerate_item_usage` on the base). No reference image is sent; the image is square (1:1).

```
Item reference sheet. {stylePreset}. The object alone, three-quarter view, centered, plain light-gray background, even studio lighting, no people, no hands, no text. {item.appearanceLock}
```

The lock is the only part you control, so it must carry the whole look (see `workflows/item-creation`). Camera, background and "no people" are already in the prompt: keep them out of the lock.

## Item Usage Prompt

Used for every other usage (`create_item_usage`, `regenerate_item_usage`). The item's base image is sent as the one reference image; the image is square (1:1). The kind of the usage picks the wording.

A `state` usage (the object itself looks different) is shown alone, without hands:

```
Item reference sheet. {stylePreset}. The object alone, three-quarter view, plain light-gray background, no people, no hands, no text. {item.appearanceLock} State: {usage.name} — {usage.delta}. Keep shape, size, materials, colors and markings identical to the reference image except for the state.
```

An `action` usage (a way the item is handled) is shown with plain gray hands and forearms only:

```
Item usage reference sheet. {stylePreset}. Plain light-gray background, no text. {item.appearanceLock} Usage: {usage.name} — {usage.delta}. Show only plain gray hands and forearms, cropped at the elbow, with no face, body, clothing or jewelry, so the sheet shows only the grip, the motion and the effect. Keep shape, size, materials, colors and markings identical to the reference image.
```

- The full lock is in both prompts. Do not repeat it in the delta: write only what differs from the base.
- Both always write " — " and the delta, so always give a delta, written without a final period.
- For an action, the delta must name the grip, the motion and the visible effect: the gray hands show only the grip, and the image model invents whatever the delta leaves out.
- Gray hands are only a way to show the grip. The panel prompt tells the image model to draw the holder's own hands instead, and the consistency check treats gray hands in a panel as a Major problem.
- If the base image is not ready, no prompt is sent: the usage fails with "Base reference image is not ready".

After a failed sheet check, the redraw appends ` Important details: {issues joined by "; "}.` to the sheet prompt (any of the four above).

## Location Reference Prompt

Used for a location's base picture (`create_location`, and `regenerate_location_state` on the base state). Drawn at 4:3, with no reference image:

```
Location reference picture. {stylePreset}. The empty place, wide shot from its main camera angle at eye level, in even neutral light with no lamps or ceiling lights switched on, no people, no animals, no text. {location.name}. Layout from this angle: {location.layout}
```

After a failed picture check, the redraw adds a space and "Important details: {issue 1}; {issue 2}." at the end, as for character sheets.

## Location State Prompt

Used for a state's own picture (`create_location_state` with `generateImage`, and `regenerate_location_state` on a state). The base picture is sent as the one reference image:

```
Location reference picture. {stylePreset}. The empty place, wide shot from its main camera angle at eye level, in even neutral light with no lamps or ceiling lights switched on, no people, no animals, no text. {location.name}. Layout from this angle: {location.layout} State: {state.name} — {state.delta}. Keep the layout, landmarks, architecture and camera angle identical to the reference image except for the state.
```

## Panel Edit Prompt

Used for `edit_panel_image` and the panel chat's `edit_image`. The panel's current image is sent first ("the first image"), followed by the cast members' variation images in cast order and the usage images of the panel's items in panel order (no previous panel). It uses the model assigned to the image-edit role.

```
Edit the first image: {instruction}. Keep everything else unchanged — composition, framing, lighting, art style — and keep these characters on-model: {name}: {appearanceLock} No text, no speech bubbles.
```

- With several cast members, each one adds "{name}: {appearanceLock}" in cast order, separated by a space.
- When the panel has items, the item locks are added after the characters, before "No text":

```
Edit the first image: {instruction}. Keep everything else unchanged — composition, framing, lighting, art style — and keep these characters on-model: {name}: {appearanceLock} and keep these items on-model: {item.name}: {item.appearanceLock} No text, no speech bubbles.
```

  Each item adds "{item.name}: {item.appearanceLock}" in panel order, separated by a space.
- The app writes the period after {instruction}: write the instruction as one clause with no final period.
- The edit keeps the composition. To change the composition, change the fields and regenerate instead.
- Edited versions are not consistency-checked.

## Consistency Check Prompt

When a model is assigned to the vision role (Settings → Models), the app checks every newly generated panel image (not edits, not uploads) with that model:

- **System prompt:** the project's `reference/consistency-checklist` doc, word for word. Editing that doc changes how the checker judges.
- **User message:** these parts in this order: the images in the order they are attached (the cast members' variation images, or a packed image of several of them, then the usage images of the panel's items, then the image the panel continues from, then the generated image last), the cast, the items (only when the panel has any), the panel description, the setting, the shot and the continuity notes (only when the panel has any):

```
Images, in the order attached:
1. Reference: {name}
2. Reference: previous panel
3. Generated panel (the image to check)

Cast:
- {name} — {appearanceLock} — Look: {variation.name} — {variation.delta}

Panel description: {description}
Setting: {setting}
Shot: {shot}
Continuity notes: {continuityNotes}
```

  The cast has one line per character, in cast order. A variation with no delta reads "Look: {variation.name}". A character whose reference image was not sent (the variation has no ready image, or it was dropped for the reference limit) ends the line with "(no reference image)" and has no entry in the image list. With an empty cast, "Cast:" is followed by "(none)". The "Continuity notes:" line is left out when the panel has none. The image the panel continues from is listed as "Reference: previous panel", or as "Reference: earlier panel in the same place" when it is an earlier one. The Panel Prompt's dialogue is not in this message.

  With items, the image list gains one entry per item that has a reference image, after the cast and before the previous panel, and an "Items:" block follows the cast:

```
Images, in the order attached:
1. Reference: {name}
2. Reference: {item.name}
3. Reference: previous panel
4. Generated panel (the image to check)

Cast:
- {name} — {appearanceLock} — Look: {variation.name} — {variation.delta}

Items:
- {item.name} — {item.appearanceLock} — Use: {usage.name} — {usage.delta} — Held by: {name}

Panel description: {description}
Setting: {setting}
Shot: {shot}
Continuity notes: {continuityNotes}
```

  The items block has one line per item, in panel order, and is left out when the panel has no items. A usage with no delta reads "Use: {usage.name}". "Held by:" is the holder's name or "nobody". An item whose reference image was not sent ends the line with "(no reference image)" and has no entry in the image list. References are matched to cast members and items by who they belong to, never by label, so an item may share a name with a character.

  With a location, its picture is listed right after the cast, and a "Location:" line follows the cast (and the items, when there are any):

```
Images, in the order attached:
1. Reference: {name}
2. Reference: {location.name} (the empty place, main camera angle)
3. Reference: previous panel
4. Generated panel (the image to check)

Cast:
- {name} — {appearanceLock} — Look: {variation.name} — {variation.delta}

Location: {location.name} — Layout: {location.layout} — State: {state.name} — {state.delta} — Camera: {camera}

Panel description: {description}
Setting: {setting}
Shot: {shot}
Continuity notes: {continuityNotes}
```

  A state with no delta reads "State: {state.name}". An empty camera reads "Camera: main". A location whose picture was not sent ends the line with "(no reference image)" and has no entry in the image list.

  When character sheets were packed onto one image (see Panel Prompt with packed character sheets), that image is one entry in the list, naming whose sheet is where. Its members count as sent, so their cast lines have no "(no reference image)":

```
Images, in the order attached:
1. Reference: {name}
2. Reference: character sheets, each labeled with the person's name: {name} (left), {name} (right)
3. Reference: previous panel
4. Generated panel (the image to check)

Cast:
- {name} — {appearanceLock} — Look: {variation.name} — {variation.delta}
- {name} — {appearanceLock} — Look: {variation.name} — {variation.delta}
- {name} — {appearanceLock} — Look: {variation.name} — {variation.delta}

Panel description: {description}
Setting: {setting}
Shot: {shot}
Continuity notes: {continuityNotes}
```

  With three or four sheets on the image, the places read "top left", "top right", "bottom left" and "bottom right".
- **Images:** the reference images in the same order, then the generated image last. All are downscaled to at most 1568 px on the long edge.
- **Expected answer:** one JSON object, `{"passed": true|false, "issues": ["…"]}`, as the checklist's Output Format says.

What the app does with the answer:

1. It reads the first JSON object in the reply, with or without a code fence. It needs a boolean `passed` and a list of strings `issues`.
2. If it cannot read one, the check counts as passed and skipped, with the issue "Checker response could not be parsed".
3. If the vision model call fails, the check counts as passed and skipped, with the issue "Consistency check failed to run: {message}". If it does not answer in time (180 seconds, unless the vision model's endpoint sets another timeout), the same, with the issue "Consistency check timed out after {seconds}s". Stopping the run during a check also counts as skipped, with "Consistency check failed to run: Cancelled".
4. The result is stored as the version's `check`: `passed`, `issues` and `skipped`.
5. When `passed` is false (and not skipped), the app redraws the panel with the Panel Prompt plus "[FIX] Fix these consistency issues: {issues joined by "; "}", up to the project's consistency retries (1 by default). Each redraw is checked in turn. A failed answer that names no issue is redrawn without the [FIX] line.
6. Every attempt stays in the panel's history. The current image becomes the last attempt that passed or, if none passed, the last attempt that rendered. A redraw that fails to render never replaces the image that is current.

So the issues the checker writes become fix instructions for the image model: they must be short, concrete and about what is visible (see `reference/consistency-checklist`).
