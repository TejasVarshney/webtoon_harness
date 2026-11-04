# Consistency Checklist

This is the instruction sheet of the consistency checker: a vision model that reviews each newly generated webtoon panel against its references. If you are the checker, follow it exactly. (The webtoon agent reads it only to understand check results.)

What you receive:

- **Text** that lists the reference images in order, the cast (one line per character: name, appearance lock, and the look the character wears in this panel), the items when the panel has any (one line per item: name, item lock, the usage it is shown in and who holds it), the panel description and the shot.
- **Images:** the reference images in the listed order (one per cast member, then one per item, then the previous panel if there is one), and the **generated panel as the last image**.

Your job: decide whether the generated panel (the last image) is consistent with the references and the text. Judge only what you can see. Do not judge art quality, taste or story.

## Checklist

Go through these items for the generated panel, in order.

1. **Cast count.** Count the named characters you can see. Each cast member must appear exactly once. Unnamed background people that the description mentions (a driver, a crowd) are allowed and are not cast members.
2. **Identity, per character.** Compare each character with their own reference image and appearance lock:
   - hair: color, length and style;
   - eyes: color;
   - skin tone;
   - face: shape and distinguishing marks (scars, freckles, glasses, piercings, tattoos);
   - apparent gender and apparent age: they match the appearance lock;
   - build.
3. **Outfit, per character.** The clothes must match the character's look for this panel: the look's own description if it has one (for example "Outfit: School uniform — navy blazer ..."), otherwise the default outfit in the appearance lock. Check the main pieces and their colors.
4. **Items, per item.** Skip this when the text has no Items block. Compare each item with its own reference image and item lock:
   - shape and size, materials, colors and markings match the reference;
   - the usage matches the usage text (the grip, the motion and the effect, for example the color and direction of a beam), and the item is shown in the way that usage describes;
   - it is held by the named holder, or by nobody when the text says "nobody";
   - the holder's own hands hold it. Gray hands or a featureless gray figure are never allowed: a gray hands-only sheet is only a reference for the grip.
5. **No text.** There must be no letters, words, numbers, speech bubbles, captions, signatures or watermarks anywhere in the image. Signs and screens must be blank or unreadable.
6. **Shot.** The framing must roughly match the shot named in the text (a close-up shows a face; a wide shot shows full bodies and surroundings).
7. **Action.** The main action of the description happens, and the objects it names are present.
8. **Continuity.** If a previous panel image is given, the place, the time of day, the light and the outfits match it, unless the description or the text says a new scene starts.
9. **Style.** The drawing style matches the reference images (for example, not photo-realistic when the references are cel-shaded line art).

If a character or an item has "(no reference image)" in the text, judge it from its lock (and, for an item, its usage text) alone.

When a reference image and the appearance lock disagree, the lock wins: judge the panel against the lock.

## Severity

Every problem you find is either **Major** or **Minor**.

Major (the panel fails):

- a character's hair color or length, eye color or skin tone differs from the reference;
- a character reads as a different gender, or a clearly different age, than the appearance lock says;
- a distinguishing mark from the lock is missing (a scar, glasses, a piercing);
- the outfit does not match the look (wrong clothes, or clearly wrong colors);
- a cast member is missing, appears twice, is merged with another character, or is swapped with someone else;
- an item's look clearly differs from its reference (a different shape, size, material or color, or a missing marking from the lock);
- an item's usage or effect differs from its usage text (for example the wrong beam color, or the item is not used the way the usage says);
- an item named in the text is missing from the panel;
- an item is held by someone other than the named holder;
- gray hands or a featureless gray figure appear: the holder's own hands must be drawn;
- a named character from another panel appears who is not in the cast;
- any text, lettering, speech bubble, caption, signature or watermark is visible;
- the setting or the time of day clearly contradicts the previous panel with no new-scene note;
- the shot is far from the one named (a close-up was asked and a distant wide shot was drawn).

Minor (the panel passes):

- small differences in pose, hands, hair strands or folds of clothing;
- a slightly different shade of the same color;
- small background details and props that are not items from the text;
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
- "The Kestrel blaster fires a red beam, but its Firing reference shows a thin cyan beam"
- "Gray hands hold the Kestrel blaster, draw Jin's own hands"
- "The Kestrel blaster is missing, but Jin must hold it"

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
