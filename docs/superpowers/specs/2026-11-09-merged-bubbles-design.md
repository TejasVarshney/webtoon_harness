# Merged bubbles, bubble padding and three new shapes

Date: 2026-11-09. Status: awaiting review.

## Intent

A letterer drags one speech bubble onto another and the two become a single balloon with one continuous outline, the
way comics join two lines from one beat. Each bubble also gets a control for the room between its text and its
outline. The Shape picker gains the three looks from the reference image that the app cannot draw today: a fringed
oval, a solid dark burst and a curly frame.

Decided with the user:

- Merging is automatic on any overlap. There is no toggle and no per-speaker rule.
- Padding means the space between text and outline, set per bubble.
- The three new shapes are part of this work.

Success looks like this: two overlapping bubbles of the same look show no line through the overlap, in the editor, the
strip and an exported image. Every bubble that overlaps nothing looks exactly as it does today.

## 1. Merging

### Which bubbles merge

Two placed bubbles merge when their boxes overlap and they have the same **merge key**: shape, fill, outline colour and
outline width, each resolved through `bubbleDefaults`. Grouping is transitive, so A touching B and B touching C is one
group.

- Mergeable shapes: `speech`, `whisper`, `shout`, `thought`. `caption`, `sfx` and the new shapes have no merge key.
- Bubbles with different keys stack as they do today, since nothing says which colour should win.
- Only bubbles with a placement take part. The automatic layout is a column with gaps, so its bubbles cannot overlap.
- Box overlap is enough, with no finer shape test: two bubbles whose boxes touch but whose shapes do not are drawn the
  same either way.

### How a group is drawn

All of a group's outlines are drawn first and all of its fills on top, so each fill covers the outline crossing it.
`BubbleBody` already draws a thought cloud this way. No polygon union and no new dependency.

This cannot be done inside each bubble: `translate` makes every `.bubble-placed` its own stacking context, so one
bubble's outline cannot sit under another's fill. A shared layer does it:

```
.dialogue-overlay
  .dialogue-flow
  .dialogue-sfx
  svg.dialogue-merge     <- new: only when a group exists
  .dialogue-placed
```

`svg.dialogue-merge` fills the overlay, ignores the pointer, and is drawn in px at the overlay's own scale. For each
group, in dialogue order, it paints every member's outline pass and then every member's fill pass.

Each member's `.bubble` gets the class `bubble-merged`, which makes its border and background transparent and hides its
`.bubble-body`. The border keeps its width and the padding is untouched, so the box does not change size. Measuring
cannot feed back into itself, and the width handles, `tailWedge` and the CSS tails all stay correct. The bubble's text,
handles and tail still render in its own element, above the layer, so no bubble's fill can cover another's text.

| Shape | Outline pass | Fill pass | Against today's drawing |
|---|---|---|---|
| speech | Ellipse filling the box, in the outline colour | Ellipse inset by the outline width, in the fill | Exact |
| whisper | Ellipse stroke centred in the border, dashed `4 3` (the tail's dash) | Same inset ellipse | Dash spacing differs slightly from CSS `dashed` |
| thought | `THOUGHT_CIRCLES` with the outline | The same circles in the fill | Exact |
| shout | `SHOUT_POINTS` stroked at 3x the outline width | The polygon in the fill, no stroke | Visible weight is unchanged; the outer edge sits 0.75x the outline width further out |

`BubbleBody.tsx` exposes its art by pass so the layer reuses the same points and circles. Shout and thought use a nested
`<svg>` at the member's box with `preserveAspectRatio="none"`, as they do today.

### Measuring

A hook in `DialogueOverlay` measures the placed bubbles the way `useBubbleBox` does: on every commit in a layout effect,
and from a `ResizeObserver` on the overlay and each placed bubble, dividing out the stage's scale. It stores the result
only when it changed. The layout effect runs before paint, so bubbles merge live during a drag with no flash of the
unmerged look, and an export has the layer before capture. A late font load is picked up by the observer. jsdom has no
layout, so every box is empty, nothing overlaps and existing tests see no change. The hook has to be called above the
overlay's early return.

`src/renderer/src/components/visualizer/bubble-merge.ts` holds the pure parts, with no React:

- `mergeKey(shape, style): string | null`
- `mergeGroups(boxes): number[][]`, connected components of overlapping boxes with equal keys. Touching edges do not
  count as overlap.

### What stays the same, and accepted limits

- Each line stays its own data. Nothing new is stored, and dragging a bubble clear of the group undoes the merge.
- Selecting, typing in, resizing and dragging work per bubble as they do now.
- Tails stay in each bubble's element. A tail that crosses a neighbouring member draws over its fill. Rare, left as it is.
- With automatic merging, one bubble of the same look cannot sit in front of another.
- An unmerged bubble overlapping a merged group always paints above the group, because the layer sits under
  `.dialogue-placed`. Today that order follows the dialogue.

## 2. Padding

- `BubbleStyleSchema` gains `padding: z.number().min(0.3).max(2).optional()`, a multiplier of the shape's own padding.
- `bubbleDefaults` gains `padding: 1`, so `withStyleChange` drops it at 100%.
- `bubbleStyleProps` sets `--bubble-padding`.
- Each shape's `padding` rule multiplies both lengths by `var(--bubble-padding, 1)`: speech and whisper (1em, 1.35em),
  shout (1.7em, 1.9em), thought (1.9em, 2.4em), caption (0.5em, 0.75em), and the new shapes.
- `BubbleStyleBlock` adds a **Padding** slider after Size: 30 to 200, step 5, reading `100%`. Hidden for `sfx`, which has
  no box. It uses the existing `.bubble-style-slider` markup.
- A bubble with a set `width` keeps that width and its text rewraps. Thought's `min-width` is unchanged.

## 3. New shapes

`BubbleShapeSchema` gains `fringe`, `burst` and `curly`. They are reached only through `style.shape`; `bubbleShape` never
picks them from a line's kind or text, and the Add Bubble menu is unchanged.

| Id | Picker label | Look | Colours | Outline width slider |
|---|---|---|---|---|
| `fringe` | Fringe | A fill-coloured oval inside a ring of thin radiating spikes | Spikes in the outline colour, oval in the fill | Hidden: the spikes have no stroke |
| `burst` | Dark burst | A solid spiky oval | Defaults `fill: #111111`, `color: #ffffff`. Stroked in the outline colour | Shown |
| `curly` | Curly | A rectangle whose edge is a chain of small round loops | Closed path, filled and stroked | Shown |

- `fringe` and `burst` follow the shout's pattern: a fixed point list in a `viewBox`, `preserveAspectRatio="none"`. Their
  points come from a deterministic function, so every render and export is identical.
- `curly` must not be stretched, or its loops turn oval on a wide bubble. `curlyFramePath(width, height, loop)` builds the
  path from the measured box, with the loop count on each side rounded so that whole loops fit. Its size follows the em.
  `useBubbleBox` moves to its own file so `curly` and `BubbleTailArt` share it.
- Padding starts at: `fringe` 1.9em 2.2em, `burst` 1.7em 1.9em, `curly` 1.3em 1.6em.
- No tails. `hasTail` stays false for all three, which hides the Tail controls and the tail art. `layoutBubbles` returns
  `tail: 'none'` for any shape without a tail while keeping the speaker's side. A stored tail is kept on the line, so
  switching back to a tailed shape restores it.
- `bubbleDefaults` covers each new shape, and the stylesheet's defaults stay in step with it.

## 4. The in-app agent

Schema changes reach its tools on their own. These descriptions list the keys by hand and gain `padding`:

- `src/main/agent/tools/panel-tools.ts`, two descriptions
- `src/main/agent/tools/panel-chat-tools.ts`, one description
- `resources/agent-docs/workflows/panel-editing.md`, which also gains the three shape ids and padding's range

`src/main/domain/prompts.ts` lists no style keys, so `prompt-templates.md` does not change.

## 5. Testing

Unit:

- `bubble-merge.test.ts`: overlapping and merely touching boxes, transitive groups, different keys, shapes with no key,
  a key resolved from defaults matching one set explicitly.
- `bubble-style.test.ts`: `--bubble-padding`, padding dropped at its default, the new shapes' defaults.
- `bubble-layout.test.ts`: the new shapes get `tail: 'none'` and keep the speaker's side.
- `curlyFramePath`: whole loops on each side, and a closed path at small and wide sizes.
- `BubbleStyleBlock.test.tsx`: the Padding slider, its absence for `sfx`, the new picker buttons, the outline width
  slider hidden for `fringe`.
- `schemas.test.ts`: padding's bounds and the new shape ids.

`npm run check` passes.

In the built app, by screenshot:

- Two overlapping bubbles of each of `speech`, `whisper`, `shout` and `thought` show one outline.
- Merging appears live during a drag, and dragging clear restores two bubbles.
- A bubble overlapping nothing is pixel-identical to the same panel on `origin/main`.
- Each new shape at a narrow and a wide width, and padding at 30% and 200%.
- An export with lettering on contains the merged outline.

## Out of scope

- A setting to turn merging off.
- Merging different shapes or colours together.
- Tails joining the merged outline where they cross a neighbour.
- The new shapes in the Add Bubble menu.
