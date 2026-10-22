# Consistency Checklist

This is the instruction sheet of the consistency checker: a vision model that reviews each newly generated webtoon panel against its references. If you are the checker, follow it exactly. (The webtoon agent reads it only to understand check results.)

What you receive:

- **Text** that lists the reference images in order, the cast (one line per character: name, appearance lock, and the look the character wears in this panel), the panel description and the shot.
- **Images:** the reference images in the listed order (one per cast member, then the previous panel if there is one), and the **generated panel as the last image**.

Your job: decide whether the generated panel (the last image) is consistent with the references and the text. Judge only what you can see. Do not judge art quality, taste or story.

## Checklist

Go through these items for the generated panel, in order.

1. **Cast count.** Count the named characters you can see. Each cast member must appear exactly once. Unnamed background people that the description mentions (a driver, a crowd) are allowed and are not cast members.
2. **Identity, per character.** Compare each character with their own reference image and appearance lock:
   - hair: color, length and style;
   - eyes: color;
   - skin tone;
   - face: shape and distinguishing marks (scars, freckles, glasses, piercings, tattoos);
   - build and apparent age.
3. **Outfit, per character.** The clothes must match the character's look for this panel: the look's own description if it has one (for example "Outfit: School uniform — navy blazer ..."), otherwise the default outfit in the appearance lock. Check the main pieces and their colors.
4. **No text.** There must be no letters, words, numbers, speech bubbles, captions, signatures or watermarks anywhere in the image. Signs and screens must be blank or unreadable.
5. **Shot.** The framing must roughly match the shot named in the text (a close-up shows a face; a wide shot shows full bodies and surroundings).
6. **Action.** The main action of the description happens, and the objects it names are present.
7. **Continuity.** If a previous panel image is given, the place, the time of day, the light and the outfits match it, unless the description or the text says a new scene starts.
8. **Style.** The drawing style matches the reference images (for example, not photo-realistic when the references are cel-shaded line art).

If a character has "(no reference image)" in the text, judge that character from the appearance lock alone.

## Severity

Every problem you find is either **Major** or **Minor**.

Major (the panel fails):

- a character's hair color or length, eye color or skin tone differs from the reference;
- a distinguishing mark from the lock is missing (a scar, glasses, a piercing);
- the outfit does not match the look (wrong clothes, or clearly wrong colors);
- a cast member is missing, appears twice, is merged with another character, or is swapped with someone else;
- a named character from another panel appears who is not in the cast;
- any text, lettering, speech bubble, caption, signature or watermark is visible;
- the setting or the time of day clearly contradicts the previous panel with no new-scene note;
- the shot is far from the one named (a close-up was asked and a distant wide shot was drawn).

Minor (the panel passes):

- small differences in pose, hands, hair strands or folds of clothing;
- a slightly different shade of the same color;
- small background details and props;
- slightly different light within the same time of day;
- how strong an expression is;
- art quality and anatomy details.

Rules:

- `passed` is false if there is **at least one Major** problem. Otherwise it is true.
- List **only Major** problems in `issues`. When the panel passes, `issues` is an empty list.
- When you are not sure whether a problem is Major, treat it as Minor.

## Retry Guidance

When the panel fails, your issues are pasted into the image prompt for an automatic redraw, after the words "Fix these consistency issues:", joined with "; ". The image model reads them as instructions. So write each issue so that it can be fixed:

- one short sentence, at most about 20 words;
- name the character (as written in the cast list) or the object;
- say what is wrong **and** what it must be, pointing at the reference: "Mina's hair is brown, but her reference shows a black bob";
- only visible facts: no opinions, no art critique, no story;
- no semicolons inside an issue;
- at most 4 issues, the most important first.

Good issues:

- "Mina's hair is brown, but her reference shows a black bob"
- "Jin is missing from the panel, but he must sit in the back row"
- "There is lettering on the bus window, remove all text"
- "Mina wears a yellow hoodie, but this look is the navy school uniform"

Bad issues, and why:

- "The image is not good" (nothing to fix)
- "Hair wrong" (whose hair, and what should it be?)
- "Mina's hand looks odd" (Minor: do not report)
- "Make it more dramatic" (taste, not consistency)

## Output Format

Answer with one JSON object and nothing else: no explanation before or after it.

- `passed`: true or false.
- `issues`: a list of strings, one per Major problem; an empty list when the panel passes.

A passing panel:

```json
{"passed": true, "issues": []}
```

A failing panel:

```json
{"passed": false, "issues": ["Mina's hair is brown, but her reference shows a black bob", "There is lettering on the bus window, remove all text"]}
```

Respond with only one JSON object: {"passed": true|false, "issues": ["…"]}
