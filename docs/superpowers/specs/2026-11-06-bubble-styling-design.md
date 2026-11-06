# Bubble Styling — Design Spec

Extends `2026-11-03-panel-editing-design.md`. Everything not said here works as that says.

## 1. Requirement

User's words: "Now I want bubble text customization. I can make my own. I can edit it and I can change the text and give styles to it. I can change where the points of bubble is pointing."

**Success:** open a panel and press **Add bubble**, choose Shout, and type a line. Change its font, size and colours under its row in Lines, and watch the stage change as each control moves. Drag the dot at the end of its tail onto the speaker's mouth. Move the bubble: the tail still points at the mouth. Go back to the strip and export: both draw it the same. Ask the chat to reword the line: the words change and the look stays.

## 2. Decisions

| Question | Decision |
|---|---|
| "Make my own" | A visible **Add bubble** button on the stage, with a menu of the six shapes. Double-clicking the panel still adds a bubble. Saved presets are not part of this work (section 7). |
| What can be styled | Per line: shape, font, size, bold, italic, capitals, alignment, text colour, fill, outline colour, outline width. A whole line has one look: no styling of single words. |
| What is stored | Only what differs from the shape's default. A line nobody styled stores `style: null` and draws exactly as it does today. |
| Where the controls are | In the Lines tab, under the selected line's row. Only one row shows them at a time. No new tab. |
| Saving | As the row's other fields: 600 ms after the last change, at once when the row is left. The stage shows the change at once, before it is saved. No Save button. |
| Pointing the tail | A dot at the tail's tip on the selected bubble: drag it, or focus it and use the arrow keys. Double-click returns it to automatic. Auto and None buttons sit in the style block. |
| What the tip is tied to | The panel, not the bubble. Moving the bubble leaves the tip where it is, because a tail points at a character. |
| Which shapes have a tail | Speech, shout, whisper: a wedge. Thought: three puffs. Caption and sound effect: none. A stored tail survives a change to those shapes and returns when the shape comes back. |
| How the tail is drawn | Measured, not from stored data alone (section 4.3). |
| Fonts | Bundled only, since the policy loads nothing from the network: Comic Neue, Bangers, and new Patrick Hand, Anton, Lora, Special Elite (Latin subsets, OFL or Apache). |
| The agent | Same fields, same inheritance as `placement`. Style never reaches an image prompt: `prompts.ts` reads no dialogue, and images hold no text. |
| IPC | None new. All of this travels in the `dialogue` of `panels:update`. |

## 3. Data model

```
BubbleShape = 'speech' | 'shout' | 'whisper' | 'thought' | 'caption' | 'sfx'
BubbleFont  = 'comic' | 'bangers' | 'hand' | 'impact' | 'serif' | 'typewriter'

BubbleStyle = {                  // every key optional; only what differs from the shape's default
  shape, font,
  size,                          // 0.5 to 3, a multiplier of the lettering's size
  bold, italic, caps,            // booleans
  align,                         // 'left' | 'center' | 'right'
  color, fill, stroke,           // '#rrggbb'
  strokeWidth                    // 0 to 6, CSS px at the lettering's scale
}

BubbleTail = 'none' | { x, y }   // the tip, as fractions 0 to 1 of the panel's width and height

DialogueLine  += style: BubbleStyle | null   default null
                 tail:  BubbleTail  | null   default null (automatic)
DialogueDraft += style?: BubbleStyle | null  undefined: inherit; null: clear
                 tail?:  BubbleTail  | null  undefined: inherit; null: automatic
```

- Stored panels without the new fields load with `null` and look as before.
- **Inheritance** (`PanelService.update`): as for `placement`, a patched line whose `style` or `tail` is `undefined` takes the value of the stored line at the same index. `null` stays `null`. `create` turns `undefined` into `null`. This keeps a look on its line when an agent rewords it.
- `DialogueDraftSchema` declares both as `.nullable().optional()` with no default. A default would turn "inherit" into "clear" when IPC parses the patch.
- `toDrafts` (renderer) always sends both fields, `null` included. Otherwise deleting a middle bubble would make later lines inherit the look of whichever line used to sit at their new index.

## 4. Drawing

### 4.1 Style to CSS

`bubbleStyleProps(style)` turns a style into inline properties on the `.bubble` element. It sets nothing when `style` is null.

- `--bubble-size`, multiplied inside each shape's existing `font-size: calc(clamp(..) * var(--lettering))`, so a size change keeps the lettering's scaling.
- `--bubble-fill`, `--bubble-stroke`, `--bubble-stroke-width`, `--bubble-color`, read by the shape rules and defaulting to today's values.
- `font-family`, `font-weight`, `font-style`, `text-transform`, `text-align`.

`bubbleDefaults(shape)` is the one place that knows each shape's default look. The style block reads it to show current values, and `withStyleChange` uses it to keep stored styles sparse.

### 4.2 Bodies

The shout and thought bodies are SVG data URIs in `styles.css`, with their colours written into them, so a variable cannot reach them. They become inline SVG (`BubbleBody`) with the same viewBoxes and the same points, painted from the same variables. Speech, whisper and caption stay CSS. The automatic wedges read the same variables.

### 4.3 The tail

An automatic tail stays today's CSS wedge. A pointed tail is an SVG child of the bubble (`BubbleTailArt`), an open path `root end → tip → root end` with a fill. It sits above the body and below the text, so its fill covers the outline between the root's ends: an open root with no seam.

It needs the bubble's box to find the outline, so it reads the bubble's and the overlay's boxes before paint, and again when either resizes (the pattern of `useStageFit`). Boxes are in screen px and divided by the overlay's on-screen scale, so stage zoom does not matter. Only a bubble with a pointed tail, or the selected bubble on the stage, measures anything.

**Why not from stored data alone.** A wedge drawn from the bubble's centre needs no measuring, and was prototyped side by side with this one. Its width at the outline is `base × (1 − r / length)`, so a short tail, the commonest kind, comes out as a sliver, and the outline crosses its root as a seam. Measuring gives about the same root width at any length, widening slightly as the tail gets longer, and no seam. It also works on a bubble still in the automatic layout, so nothing has to be pinned first. The export already waits for fonts and two frames before it captures. `2026-11-06-bubble-styling-prototype.png` shows both methods, and `2026-11-06-bubble-styling-prototype.html` draws them.

**Trap confirmed in the prototype:** Chromium does not paint a `0 × 0` SVG even with `overflow: visible`, so the SVG is `1 × 1`, at the bubble's centre, and its coordinates are px from that centre.

The tail is inside `.dialogue-overlay`, so "Without lettering" leaves it out and slanted frames clip it as they clip the lettering.

## 5. The screen

Follows the app's existing look (`styles.css` tokens, IBM Plex, 32 px controls, radius 6, no shadows at rest, the accent only on what is selected or being dragged). The panel's art stays the loudest thing on the stage, and the stage is the block's live preview.

**Style block**, full width under the selected row, three wrapped lines with 12 px labels in sentence case:

```
Shape  [Auto][oval][spikes][dashes][cloud][box][SFX]     Tail  [Auto][None]  Drag the dot on the panel to point it.
Font   [Comic Neue v]   Size ---o---- 120%   [B][I][AA]   [left][centre][right]
Text colour [#]   Fill [#]   Outline [#]   Outline width --o--- 2 px                      Reset style
```

- Shape buttons draw the shape itself at small size, with its name as the accessible name and tooltip.
- Every control shows the current look (`bubbleDefaults` under `style`), so nothing reads as blank.
- Sliders and native colour inputs cannot produce an invalid value, so the block has no error state of its own. A refused save shows where dialogue refusals already show, with "Undo my change".
- Tail is hidden for caption and sound effect. Fill and Outline width are hidden for sound effect.
- A pointed tail shows `Points at 25% across, 50% down.` in place of the hint, with neither button pressed.
- Reset style shows only on a styled line.

**The dot:** 14 px on screen at every zoom, with a 24 px hit area. Filled accent with a white ring once pointed. Hollow at the tip of an automatic tail, or below a bubble with no tail, where dragging it creates a pointed tail. A tip inside the bubble's body draws no tail, and the dot stays so it can be pulled out.

**Add bubble:** a button beside the zoom bar, opening a menu upward: Speech, Shout, Whisper, Thought, Caption, Sound effect. Choosing one places the bubble and opens its text. A bubble left empty is dropped, as today.

| Choice | Kind | Speaker | Stored style |
|---|---|---|---|
| Speech | speech | first of the cast, or none | null |
| Shout | speech | first of the cast, or none | `{ shape: 'shout' }` |
| Whisper | speech | first of the cast, or none | `{ shape: 'whisper' }` |
| Thought | thought | first of the cast, or none | null |
| Caption | narration | none | null |
| Sound effect | sfx | none | null |

## 6. The agent

- The tool schemas pick up both fields through `PanelDraftSchema.shape.dialogue`. The three dialogue descriptions (`panel-tools.ts` twice, `panel-chat-tools.ts` once) gain a sentence on them.
- `get_panel_context` lists each line's fields by hand, so it gains `style` and `tail`. Neighbour summaries stay text only.
- `panel-editing.md`, "Dialogue-Only Changes", gains the fields and the rule: leave them out to keep them, send them when reordering, set them only when the user asks. Existing projects keep their old copy of the doc until Reset all to defaults, so server inheritance is the real protection.

## 7. Not in this work

Saved presets, a default look per character, per-word styling, curved tails, several tails on one bubble, rotation, imported fonts, more shapes, reordering lines, duplicating a bubble, undo and redo.
