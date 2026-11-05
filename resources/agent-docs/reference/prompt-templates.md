# Prompt Templates

This is a reference for the exact prompts the app builds from your fields. You never write these prompts yourself: the app composes them when you call `create_panel`, `regenerate_panel`, `edit_panel_image`, `create_character`, `create_variation`, `regenerate_variation`, `create_item`, `create_item_usage` or `regenerate_item_usage`. Read this doc to understand why an image came out the way it did, and to write fields that read well inside the prompt.

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
| {m} | The number of the previous panel's reference image. |
| {continuityNotes} | The panel's `continuityNotes`. |
| {item.name}, {item.appearanceLock} | The name and item lock of an item attached to the panel (only in the panel prompt with items, below). |
| {k} | The number of that item's reference image. |
| {usage.name}, {usage.delta} | The name and delta of the usage the panel picks for the item. |
| {item.action} | The `action` of the panel's `items` entry: what the item itself does in this frame. |

Two optional sentences end the `[STYLE]` line, each after a space. A panel gets at most one:

- Tall panel (`aspect` 1:2 or 1:3, always faded, even when borderless): `Tall panel: keep the top fifth and bottom fifth plain background (sky, floor, darkness), so they can fade out.`
- Borderless panel (`frame` borderless, not tall): `Art runs to the edges, no frame.`

How the template bends:

- **[CHARACTERS]** has one line per cast entry, in cast order. With an empty cast, nothing follows the [CHARACTERS] line.
- **Empty parts are left out** of a cast line. A variation with no delta reads "Look: Base." (no dash). An empty `action` leaves out "Action: ...", An empty `expression` leaves out "Expression: ...", an empty `position` leaves out "Position: ..." (the default is center).
- **No reference image:** when the variation has no ready image, or its image was dropped for the reference limit, "(reference image {n})" reads "(no reference image)".
- **[CONTINUITY]** appears only when the previous panel in the episode has a ready image. Without it (first panel of an episode, or a previous panel with no ready image), your `continuityNotes` are not in the prompt at all. An empty `continuityNotes` leaves the line ending at "consistent."
- **[FIX]** is added as a last line only when the app redraws a panel after a failed consistency check: "[FIX] Fix these consistency issues: {issue 1}; {issue 2}".
- **Dialogue is never in the prompt.** It is drawn over the image by the app.
- **Periods are added for you.** The app writes a period after the variation look, the action, the expression and the position. End `delta`, `action` and `expression` without a period, or the prompt gets "..".

Reference images, in this order:

1. each cast member's variation image, in cast order;
2. the image of the usage each attached item uses, in panel order (only when the panel has items);
3. the user's layout sketch (only when the panel has one);
4. the previous panel's current image.

The image model accepts a limited number of reference images (set per model in Settings → Models, 4 by default). When there are more, the previous panel's image is dropped first, then the sketch, then items from the end of the list, then cast members from the end of the list; a dropped entry's line reads "(no reference image)", and a dropped sketch takes its [LAYOUT] line with it. This is why the most important character goes first, why 3 foreground characters is the maximum, and why a panel where an item matters keeps its cast to 2.

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

Reference images sent: 1 = Jin's base image, 2 = Mina's school-uniform image, 3 = the blaster's "Firing" image, 4 = the previous panel's current image. With a cap of 3, the previous panel is dropped first: the [CONTINUITY] line then reads "the previous panel (no reference image)". With a cap of 2, the blaster is dropped too: its line reads "- Kestrel blaster (no reference image): ..." and keeps its lock, but its look and use can drift.

### Panel Prompt with a layout sketch

The user can scribble a rough layout of the panel in editing mode (Sketch). When the panel has a sketch, a [LAYOUT] line follows the [CHARACTERS] lines (and [ITEMS], when there are items) and comes before [CONTINUITY]:

```
[LAYOUT] Follow the rough composition of the sketch (reference image {s}): where the figures and objects sit, their poses, the camera angle and the framing. It is a rough guide only: never copy its scribbled lines, flat colours or blank background, and draw everything in the style above.
```

- **Only a generation sends it.** `edit_panel_image` keeps the image's own composition, so an edit gets no sketch and no [LAYOUT] line.
- **The consistency check never sees it.** The checker compares the picture with the cast, the items and the previous panel; the sketch is a guide, not something to match.
- **Write the description to agree with it.** The sketch says where things are; the description says what happens. When they disagree, the image model has to guess.

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
- **User message:** these parts in this order: the images in the order they are attached (the cast members' variation images, then the usage images of the panel's items, then the previous panel, then the generated image last), the cast, the items (only when the panel has any), the panel description and the shot:

```
Images, in the order attached:
1. Reference: {name}
2. Reference: previous panel
3. Generated panel (the image to check)

Cast:
- {name} — {appearanceLock} — Look: {variation.name} — {variation.delta}

Panel description: {description}
Shot: {shot}
```

  The cast has one line per character, in cast order. A variation with no delta reads "Look: {variation.name}". A character whose reference image was not sent (the variation has no ready image, or it was dropped for the reference limit) ends the line with "(no reference image)" and has no entry in the image list. With an empty cast, "Cast:" is followed by "(none)". The Panel Prompt's dialogue, setting and continuity notes are not in this message.

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
Shot: {shot}
```

  The items block has one line per item, in panel order, and is left out when the panel has no items. A usage with no delta reads "Use: {usage.name}". "Held by:" is the holder's name or "nobody". An item whose reference image was not sent ends the line with "(no reference image)" and has no entry in the image list. References are matched to cast members and items by who they belong to, never by label, so an item may share a name with a character.
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
