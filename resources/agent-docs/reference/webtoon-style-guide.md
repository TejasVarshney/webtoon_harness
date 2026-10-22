# Webtoon Style Guide

This is a reference for the visual choices of a panel: format, aspect, shot, pacing, dialogue and color. Use it with `workflows/panel-generation` whenever you pick a `shot` or an `aspect`, or write dialogue.

## Format

- A webtoon is one long vertical strip, read on a phone by scrolling down. One panel at a time fills most of the screen.
- Panels sit in a single column, top to bottom, in episode order. There are no side-by-side panels and no page layout.
- Every image is drawn **without text** (R6). The app draws the dialogue over the image as HTML: speech and thought bubbles on the left, narration as a full-width caption box, sound effects as large centered lettering.
- The bubbles stack from the **top** of the panel downward. When a panel has dialogue, keep faces and the key action out of the top quarter of the frame: put sky, ceiling, wall or empty background there. Say it in the description when it matters: "Mina in the lower half of the frame, the night sky above her".
- The project's `style` (from `<project_state>`) is added to every prompt. Never add style words of your own (anime, realistic, watercolor) to a description.

## Panel Aspects

`aspect` is the panel's width:height. Leave it out to use the project default (usually 2:3).

| Aspect | Shape | Use it for | Avoid it for |
|---|---|---|---|
| `2:3` | Upright | The standard panel. Most beats: one or two characters doing something. | Wide groups, landscapes. |
| `3:4` | Slightly upright | Two people talking face to face; a small group in a room. | Tall reveals. |
| `1:1` | Square | Quick beats: a reaction, an insert of an object, a fast exchange. Several in a row feel fast. | Establishing a place. |
| `9:16` | Tall | Drama in height: a reveal at the bottom, a fall, a tall building, a figure under a huge sky, a slow emotional pause. | Conversations (too much empty space). |
| `4:3` | Wide | A room with several people, a street, a car interior. | Single faces. |
| `16:9` | Very wide | Landscapes, panoramas, a big crowd, an establishing shot of a town. | Close-ups. |

Rules of thumb:

- Most panels in an episode are `2:3` or `3:4`. Use the others on purpose.
- A `9:16` panel slows the reader down: save it for 1 or 2 key moments per episode.
- A run of `1:1` panels speeds the reader up: use it for action, comedy and panic.
- Wide panels (`4:3`, `16:9`) are rare in a vertical strip; use them for places and groups.

## Shot Vocabulary

`shot` is how far the camera is and where it looks from. The value is used as written in the prompt ("close-up shot").

| Shot | What it shows | Use it when | Example description start |
|---|---|---|---|
| `establishing` | A whole place, people tiny or absent. | A new scene, place or time. The first panel of an episode or scene. | "A small hillside town at dawn..." |
| `wide` | Full bodies and their surroundings. | Where everyone is; a full action (running, falling, fighting). | "Mina runs across the empty platform..." |
| `medium` | Characters from the waist up. | Conversations; most acting. The default when unsure. | "Mina and Jin sit side by side on the bus..." |
| `close-up` | One face, head and shoulders. | A feeling; a reaction; an important line. | "Mina's face, lit by the moon..." |
| `extreme-close-up` | Eyes, a mouth, a hand, a small object. | Tension; a clue; the moment before a reveal. | "Mina's eyes widen..." |
| `over-the-shoulder` | One character seen past another's shoulder. | Confrontations; showing what one character sees of another. | "Over Jin's shoulder: Mina stands in the aisle..." |
| `birds-eye` | From high above, looking down. | Smallness, loneliness, a map of the place, a fall seen from above. | "From high above, the lone bus on a dark road..." |
| `worms-eye` | From low, looking up. | Power, threat, awe: a towering figure, a huge moon, a building. | "From the ground, Grandma towers in the doorway..." |

Good sequences:

- **Scene opening:** `establishing` → `wide` → `medium`.
- **Conversation:** `medium` (both) → `over-the-shoulder` (A seen past B) → `over-the-shoulder` (B seen past A) → `close-up` (the key line).
- **Reveal:** `close-up` (a reaction) → `extreme-close-up` (eyes) → `wide` or a tall `9:16` panel (what they see).
- **Action:** `wide` (the move) → `1:1` `close-up` (the impact or the face) → `wide` (the result).

Avoid the same shot three panels in a row; vary the distance to keep the strip alive.

## Pacing and Gutters

The space between panels (the gutter) is fixed in this app: you cannot make it bigger or smaller. Control pacing with what each panel shows:

- **One beat per panel** (R5). The reader gets one new thing per scroll.
- **To slow down:** a silent panel (`"dialogue": []`), a tall `9:16` panel, a wide establishing panel, or a close-up of a face holding a feeling.
- **To speed up:** several square `1:1` panels in a row, short lines, close and medium shots, sound effects.
- **To show time passing:** an establishing shot of the place at a new time of day, or a narration line ("Three days later.").
- **For a reveal:** build up in one panel (a reaction, a hand on a door handle), then put the reveal alone in the next panel, often tall.
- **For a cliffhanger:** end the episode on a face, a figure, or a line that raises a question. Do not explain it in the same panel.
- **Rhythm:** after 2 or 3 talking panels, add one panel without words (a reaction, the place, an object).

## Dialogue Conventions

Dialogue is data in the panel's `dialogue` list, drawn over the image by the app. It never goes into the description or the image (R6).

- **At most 2 bubbles** (`speech` or `thought`) per panel.
- **At most 25 words per bubble.** Shorter is better: 5 to 12 words reads best on a phone.
- **Reading order** is list order. The first line is drawn at the top.
- **One speaker per bubble.** A long speech becomes several panels: one bubble each, with the speaker's face or reactions.
- **`speech`** is said aloud; **`thought`** is inner voice (drawn as a cloud); both need the character's id as `speakerId`.
- **`narration`** is a caption box: time and place ("Midnight."), the narrator's voice, or a character's inner monologue in past tense. `speakerId` is null.
- **`sfx`** is sound lettering: 1 or 2 words, lower case or onomatopoeia ("thud", "ding", "hsss", "krrk"). `speakerId` is null. Use at most one per panel.
- **Voice:** write each character in their `speechStyle`. Two characters should not sound the same.
- **Punctuation:** "..." for trailing off, "—" for being cut off, "?!" for shocked questions. No ALL CAPS sentences except a one-word shout.
- **Silence is allowed.** A panel with no words is often the strongest one.

## Color and Lighting Continuity

The style preset fixes the drawing style; you keep color and light consistent through the fields:

- **Scene light:** decide the light once per scene (time of day, weather, the main light source and its color) and keep it in the `setting` of every panel of the scene: "Inside the night bus, midnight, cold blue ceiling light".
- **Continuity notes:** repeat the light in `continuityNotes` when it matters: "Same cold blue night light as the previous panel."
- **Changes on purpose:** when the light changes (headlights, a door opening, dawn), say what changes and from where: "warm headlights now light her face from the left".
- **Character colors come from the lock.** The lock's palette and the variation's delta give each character their colors. Never restate them in a description (R2). If an image gets a character's colors wrong, fix it with an edit ("matching her reference image") or a redraw, not by describing them.
- **Mood color:** a scene's palette can carry mood: cold blues for loneliness or night, warm oranges for safety or nostalgia, desaturated grays for flashbacks, a single strong red for danger. Name it in the description or setting once and keep it for the whole scene.
- **Flashbacks:** mark them clearly: an `age` variation for younger characters, a narration line ("Ten years ago."), and a setting note such as "faded, warm sepia light".

## Genre Notes

Use the bible's Tone section to decide the genre; these notes give typical choices.

- **Romance:** many `medium` and `close-up` shots; eyes and hands in `extreme-close-up`; soft warm light; silent beats after confessions; tall panels for the big moment.
- **Action:** `wide` shots for moves, `1:1` close-ups for impacts, `worms-eye` for a powerful opponent; motion and debris described in the description; short lines; sound effects.
- **Horror and thriller:** dark settings with one light source; `extreme-close-up` on eyes and details; slow build-ups of silent panels; the scare alone in a tall panel; cold or sickly colors.
- **Comedy:** fast `1:1` panels; exaggerated expressions in the cast `expression` field; a silent "reaction" panel after the punchline; bright even light.
- **Slice of life:** `establishing` shots of everyday places; `medium` shots of small actions; warm natural light; quiet panels.
- **Fantasy:** `establishing` and `16:9` panels to show the world; `worms-eye` for magic and monsters; the rules of magic kept as in the bible's World section; transformations as `form` variations.
- **Mystery:** clues shown in `extreme-close-up` inserts; the same object shown again later; narration for the detective's thoughts; cliffhangers on a discovered clue.
