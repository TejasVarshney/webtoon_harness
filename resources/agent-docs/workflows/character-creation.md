# Character Creation

## Purpose

This doc tells you how to create and change characters so they look the same in every panel: what goes in a character sheet, how to write the appearance lock, how the reference images are made, and when a new look deserves a variation.

Read it before you call `create_character`, `update_character`, `create_variation` or `regenerate_variation`.

How consistency works in this app:

1. Each character has an **appearance lock**: one paragraph of visual description.
2. The lock is pasted, word for word, into every image prompt that shows the character.
3. Each character has a **base** reference image, made from the lock. Every other look (a **variation**) gets its own reference image, made from the base image.
4. When a panel is drawn, the reference image of the variation each character wears is sent to the image model with the prompt.

So a good lock and ready reference images are what keep a character recognizable. Every id in this doc is an example.

## Character Sheet

These are the inputs of `create_character` (and the fields of `update_character`'s `patch`):

| Field | Required | What to write |
|---|---|---|
| `name` | yes | The name the story uses. Unique in the project. |
| `role` | yes | `protagonist`, `antagonist`, `supporting` or `minor`. |
| `appearanceLock` | yes | The visual paragraph (next section). |
| `aliases` | no | Other names the story uses for them, e.g. ["Grandma"]. |
| `characterization` | no | `personality`, `backstory`, `motivation`, `speechStyle`, `relationships`, `notes`. |
| `appearance` | no | `age`, `gender`, `build`, `height`, `hair`, `eyes`, `skin`, `distinguishingFeatures`, `defaultOutfit`, `palette`. |
| `generateBaseImage` | no | Default true. Set false only when the user wants to upload their own image. |

What each part is for:

- **characterization** is never sent to the image model. You use it to write the character's dialogue and behavior. Fill all of it: it is how future sessions know who this person is.
  - `speechStyle`: how they talk (short sentences? formal? a catchphrase?). Use it for every line of their dialogue.
  - `relationships`: a list of `{"characterId": ..., "relation": ...}` for characters that already exist. The id must be a real character id.
- **appearance** is the structured version of the look. Fill every field; then write the lock from these fields.
- **aliases** matter for panels: the app checks every panel description for each character's name and aliases (whole words, any case). A name or alias in a description must belong to a cast member or be listed in `offPanelMentions`. So do not use common words as aliases ("the driver", "the girl"); add an alias only if the story really calls the character that.

## Writing the Appearance Lock

The lock is one paragraph, **40 to 90 words**, of concrete visual facts in this **fixed order**:

1. age and build (and height if it matters),
2. face (shape, nose, mouth, notable features),
3. hair (length, style, color),
4. eyes (shape, color) and eyebrows,
5. skin (tone),
6. marks (scars, freckles, tattoos, glasses, piercings),
7. default outfit (every visible piece, with colors),
8. palette (3 to 5 main colors).

Rules:

- **Concrete tokens only.** Colors, shapes, lengths, materials: "shoulder-length straight black bob with blunt bangs", not "pretty hair".
- **No personality or mood words:** not shy, brave, kind, mysterious, cheerful.
- **No camera or image words:** not close-up, portrait, full body, front view, background, lighting, pose. The app adds those.
- **No style words:** not anime, realistic, chibi, watercolor. The project's style is added for you.
- **No name at the start.** The prompt already says the name before the lock. Start with the age.
- **No text on the character** (R6): no name tags, no logos with letters, no writing on clothes.
- **Same words forever.** The lock is pasted verbatim; any change changes every future image (R3).
- **The default outfit is part of the lock.** Other outfits are variations.

Good lock (62 words):

```
Seventeen-year-old girl, slim build, average height. Oval face with soft jaw, small straight nose, faint freckles across the cheeks. Shoulder-length straight black bob with blunt bangs. Large amber eyes, thin dark eyebrows. Light warm skin. Small crescent-shaped scar above the left eyebrow. Default outfit: oversized mustard-yellow hoodie, dark gray pleated skirt, black tights, white sneakers. Palette: black, amber, mustard yellow, charcoal gray.
```

Bad lock, and what is wrong with it:

```
Mina is a shy but brave girl with beautiful dark hair and kind eyes. Anime style, close-up portrait, soft lighting. She usually wears casual clothes.
```

- starts with the name; "shy", "brave", "kind" are personality;
- "beautiful dark hair" has no length, style or exact color; "kind eyes" has no color;
- "anime style", "close-up portrait", "soft lighting" are style and camera words;
- "casual clothes" is not an outfit: which clothes, which colors?
- it is 27 words, under the minimum.

Check before you call `create_character`:

- [ ] 40 to 90 words, one paragraph
- [ ] order: age/build, face, hair, eyes, skin, marks, outfit, palette
- [ ] every color named; hair has length, style and color
- [ ] no personality, camera, style or text words; no name at the start

## Base Reference Image

`create_character` creates the base variation (named "Base") and, unless `generateBaseImage` is false, generates its image and waits. The image is a full-body, front-view character sheet on a plain light-gray background, made from the style and the lock (the exact prompt is in `reference/prompt-templates`).

The result looks like this:

```json
{"characterId": "chr_3e8a51c0d2", "baseVariationId": "var_7b20c4e9f1", "baseStatus": "ready", "baseError": null, "imagePath": "characters/chr_3e8a51c0d2/var_7b20c4e9f1_4f2a9c.png"}
```

What to do with it:

- `baseStatus` `ready`: done. If your model can see images, the result shows you the picture: compare it with the lock.
- `baseStatus` `failed`: the character exists, only the image is missing. Read `baseError`, then retry once with `regenerate_variation` using `baseVariationId`. If it fails again, stop and tell the user (R12). Never call `create_character` again: you would get "A character named ... already exists".
- The picture contradicts the lock (wrong hair color, missing scar): regenerate once. If it is wrong again, the lock is probably unclear. Show the user the line you would change and change the lock only after their yes (R3).

The base must be `ready` before the character can be cast in a panel, and before any variation can get its image (variation images are made from the base image).

## Variations

A variation is a named recurring look with its own reference image. Kinds:

| Kind | Use it for | Example name | Example delta |
|---|---|---|---|
| `outfit` | Other clothes worn in several panels. | Outfit: School uniform | Instead of the default outfit: navy blazer with white piping, white shirt, red ribbon tie, navy pleated skirt, navy knee socks, brown loafers |
| `expression` | A face state that changes the face strongly and recurs. | Expression: Moon trance | Eyes glow pale silver with no pupils; face slack and calm |
| `pose` | A signature pose used again and again. | Pose: Fighting stance | Feet apart, knees bent, fists raised at chin height |
| `age` | The same character younger or older (flashbacks). | Age: Child (8) | Eight years old: small and round-faced, hair in two low pigtails, yellow raincoat over a white dress |
| `form` | A transformation. | Form: Moon spirit | Translucent pale-blue body, hair floating upward, glowing crescent on the forehead |
| `other` | Lasting changes: an injury, a haircut, glasses. | Other: Bandaged left arm | White bandage wrapped from the left wrist to the elbow; otherwise the default look |

How to write `delta`:

- Write only what differs from the base. Leave the face and hair out unless the variation changes them.
- For an outfit, start with "Instead of the default outfit:" and list every visible piece with colors. The lock (which names the default outfit) is still in every prompt, so say clearly that this replaces it.
- Same rules as the lock: concrete, no personality, no camera words, no text.
- No final period: the app adds one after the delta ("Look: {name} — {delta}.").

`create_variation` generates the image from the base image and waits. The result:

```json
{"variationId": "var_4c19d2e8a0", "status": "ready", "error": null, "imagePath": "characters/chr_3e8a51c0d2/var_4c19d2e8a0_91be03.png"}
```

`status` `failed` with "Base reference image is not ready": regenerate the base first, then `regenerate_variation` this one. Any other failure: retry once with `regenerate_variation`, then stop and report.

## Variation Naming

Name every variation `Kind: Specific look`:

- Start with the kind, capitalized: Outfit, Expression, Pose, Age, Form, Other.
- After the colon, 1 to 4 words a reader would understand: "Outfit: School uniform", "Outfit: Winter coat", "Age: Child (8)", "Form: Moon spirit".
- Unique per character. Do not make "Outfit: Uniform" and "Outfit: School uniform".
- The base is always "Base"; you never create it.

The name appears in every panel prompt ("Look: Outfit: School uniform — ...") and in the panel side chat, so it must say what the look is.

## When Not to Create a Variation

Most changes are panel fields, not variations. Do not create a variation for:

| The change | Put it here instead |
|---|---|
| A smile, tears, anger in one panel | the cast entry's `expression` |
| Running, sitting, waving in one panel | the cast entry's `action` |
| Seen from behind, from above, close up | the panel's `shot` and description |
| Wet hair in the rain, sunset light, snow on the coat | the description or `continuityNotes` |
| Holding a phone, a cup, an umbrella | the cast entry's `action` |
| A blush, a smudge of dirt that is gone next scene | `expression` or `action` |
| A nameless waiter, passer-by or crowd | nothing: describe them generically in the panel (they are not characters) |
| A look the base already shows | nothing: cast the base |

Rule of thumb: create a variation only when the look will appear in **3 or more panels**, or when the image model keeps drawing it wrong without its own reference image.

## Automating Creation from Chat

The user may ask for a character in a few words ("add a rival"), in detail, or with the Characters tab's "Draft with AI" button, which sends:

```
Help me design the character "NAME": interview me briefly if needed, then fill characterization, appearance and appearanceLock, create the character and generate its base reference image.
```

Follow these steps:

1. **Check the roster.** Is the name already in `<project_state>` (or `list_characters`)? Then update that character instead of creating one.
2. **Interview or brief.**
   - Interview: if you are missing the look or the role, ask **up to 3 short questions in one message**, each with a suggested default. Example: "1. Age and look? (I'd suggest late teens, tall, messy silver hair.) 2. What does he want? 3. Friend or rival to Mina?"
   - Brief: if the user gave enough, or said "you decide", fill the gaps yourself, matching the bible's World and Tone.
3. **Write the sheet.** Fill `role`, `characterization` (all fields; `relationships` with ids of existing characters), `appearance` (all fields), then write the lock from the appearance fields in the fixed order.
4. **Confirm when needed.** In user-led mode, if the user has not already asked you to create the character, show the lock and a 3-line summary and ask "Create?". If they asked you to create it (the Draft with AI message does), create it now. In AI-led mode, create it now.
5. **Create.** Call `create_character`.
6. **Verify.** Read `baseStatus` (Base Reference Image above).
7. **Record.** Add the character to the bible's Characters & Relationships section (`get_story`, then `update_story_bible`) (R9).
8. **Reply.** Name, role, one sentence of personality, and whether the base image is ready.

In user-led mode, a new named character is a story decision (R7): suggest it, and create it only when the user agrees or asked for it.

## Updating Characters

`update_character` takes `characterId` and a `patch`. Only the fields named in the patch change:

- `characterization` and `appearance` merge field by field: `{"characterization": {"motivation": "..."}}` keeps the other characterization fields.
- `aliases` and `relationships` are lists: the new list replaces the old one, so include the entries you keep.

```
update_character {"characterId": "chr_9f61b2d47a", "patch": {"characterization": {"motivation": "Find his missing sister, who drove the night bus."}}}
```

Changing the appearance lock (R3):

- Only when the user explicitly asks ("make her hair red from now on"). A new look for a while (a disguise, a costume) is a variation, not a lock change.
- Change the matching `appearance` field in the same patch so the two agree.
- The result has the warning "appearanceLock changed: regenerate the base and variations so new panels stay consistent." Do it: `regenerate_variation` for the base first, then for every other variation.
- Existing panels keep their old images. Tell the user, and offer to regenerate the panels that should show the new look.

Renaming is safe for panels (they store ids, not names). After a rename, update the bible's Characters & Relationships.

You cannot archive or delete a character. If the user wants one gone, tell them to archive it in the Characters tab (a character used by panels cannot be deleted, only archived).

## Examples

### Example 1: a brief becomes a character

User (user-led): "Create Mina: 17, black bob, amber eyes, curious and stubborn, lives with her grandma."

The user asked to create her, so create now. Grandma Oksun already exists (chr_2d4f6a8c01), so add the relationship.

```
create_character {
  "name": "Mina",
  "role": "protagonist",
  "characterization": {
    "personality": "Curious and stubborn; hides fear behind dry jokes.",
    "backstory": "Lives with her grandmother since her parents moved abroad. Has heard the moon whisper since she was eight.",
    "motivation": "Find out why the moon talks only to her.",
    "speechStyle": "Short casual sentences, dry jokes; says 'Seriously?' when nervous.",
    "relationships": [{"characterId": "chr_2d4f6a8c01", "relation": "granddaughter; very close"}],
    "notes": "Afraid of deep water."
  },
  "appearance": {
    "age": "17",
    "gender": "female",
    "build": "slim",
    "height": "average, about 160 cm",
    "hair": "shoulder-length straight black bob with blunt bangs",
    "eyes": "large amber eyes, thin dark eyebrows",
    "skin": "light warm",
    "distinguishingFeatures": "faint freckles; small crescent-shaped scar above the left eyebrow",
    "defaultOutfit": "oversized mustard-yellow hoodie, dark gray pleated skirt, black tights, white sneakers",
    "palette": "black, amber, mustard yellow, charcoal gray"
  },
  "appearanceLock": "Seventeen-year-old girl, slim build, average height. Oval face with soft jaw, small straight nose, faint freckles across the cheeks. Shoulder-length straight black bob with blunt bangs. Large amber eyes, thin dark eyebrows. Light warm skin. Small crescent-shaped scar above the left eyebrow. Default outfit: oversized mustard-yellow hoodie, dark gray pleated skirt, black tights, white sneakers. Palette: black, amber, mustard yellow, charcoal gray."
}
```

Result: `baseStatus` `ready`. Then update the bible section (after `get_story`) and reply:

> Created Mina (protagonist): curious, stubborn, jokes when scared. Her base reference image is ready.

### Example 2: interview first

User: "Add a rival for Mina."

Reply with up to 3 questions and defaults, then stop:

> A few quick questions (or say "you decide"):
> 1. Look? I'd suggest a tall 18-year-old boy with messy silver hair and a long black coat.
> 2. Why is he a rival? I'd suggest he also hears the moon and wants its secret for himself.
> 3. Name? I'd suggest Dohyun.

When the user answers, write the full sheet and lock and call `create_character` with `"role": "antagonist"` or `"supporting"`, as the story needs.

### Example 3: an outfit variation

The next scenes happen at school, and Mina will wear her uniform in many panels.

```
create_variation {"characterId": "chr_3e8a51c0d2", "name": "Outfit: School uniform", "kind": "outfit", "delta": "Instead of the default outfit: navy blazer with white piping, white shirt, red ribbon tie, navy pleated skirt, navy knee socks, brown loafers"}
```

Result: `status` `ready`, `variationId` var_4c19d2e8a0. Use that id in the cast of every school panel.

### Example 4: a failed base image

`create_character` returned `"baseStatus": "failed", "baseError": "Image generation timed out after 180s"`. The character exists. Retry once:

```
regenerate_variation {"characterId": "chr_9f61b2d47a", "variationId": "var_0a5e3f8c26"}
```

If it fails again, stop: "Jin was created, but his reference image failed twice (timeout). You can retry from the Characters tab, or check the image model in Settings → Models."

### Example 5: the user changes the lock

User: "From now on Jin has dyed red hair."

That is an explicit, lasting change, so change the lock and the matching appearance field (call `get_character` first to copy the lock exactly):

```
update_character {"characterId": "chr_9f61b2d47a", "patch": {"appearance": {"hair": "short messy hair dyed bright red"}, "appearanceLock": "Eighteen-year-old boy, tall and lanky. Narrow face, sharp chin, straight thin nose. Short messy hair dyed bright red. Narrow dark-brown eyes, thick straight eyebrows. Pale cool skin. Silver ring in the right ear. Default outfit: black hooded windbreaker over a gray T-shirt, dark jeans, worn black high-top sneakers. Palette: red, black, gray, silver."}}
```

Then `regenerate_variation` for Jin's base, then for each of his other variations. Reply that new panels will show red hair and offer to redraw earlier panels.

### Example 6: not a variation

User: "Draw Mina crying."

Crying in one scene is an `expression` in the panel's cast entry, not a variation. Cast her usual variation with `"expression": "crying, tears running down her cheeks"` (see `workflows/panel-generation`).
