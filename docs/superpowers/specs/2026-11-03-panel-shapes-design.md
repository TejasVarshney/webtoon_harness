# Panel Shapes — Design Spec

Extends `2026-10-21-webtoon-ai-harness-design.md` and builds on the manhwa bubbles (`feat/manhwa-bubbles`). Everything not said here works as those say.

## 1. Requirement

User's words: panel shapes "as close as it in the manhwas"; side by side "default and user can edit it and make it according to themself".

Source: the story-panels test (`E:\claude\manhwa-benchmark\story-panels\results.md`), gaps 3 and 4:

- Every panel is a bordered rectangle at full strip width, and the tallest is 9:16. The reference draws clashes borderless or slanted, descents very tall (1:2–1:3), and quick exchanges as small panels side by side.
- Every gutter is the same. The reference uses long white gaps for time passing and black gutters inside dark scenes.

**Success:** the 22-panel story episode, re-shot with layouts set, shows the talk as side-by-side rows, the clash borderless or slanted, the descent as a tall faded panel, and the dungeon on a black band.

## 2. Decisions taken in brainstorming

| Question | Decision |
|---|---|
| Tall panels (no model draws taller than 2:3 / 9:16) | Draw at 9:16 and fade the top and bottom into the gutter. Nothing is cropped away. |
| Small panels | Side by side, 2–3 per row. The agent's default for quick exchanges. The user edits every panel's layout freely. |
| Where the layout lives | Fields on each panel. The panel order stays the only order. No separate layout document, no free placement. |

## 3. Data model (`src/shared/schemas.ts`)

```
PanelAspect   = '1:1' | '2:3' | '3:4' | '9:16' | '4:3' | '16:9' | '1:2' | '1:3'   // adds 1:2, 1:3
PanelFrame    = 'bordered' | 'borderless' | 'slanted'
PanelGap      = 'tight' | 'normal' | 'long'
PanelGutter   = 'white' | 'black'

Panel += {
  frame:    PanelFrame   default 'bordered'
  beside:   boolean      default false
  gapAfter: PanelGap     default 'normal'
  gutter:   PanelGutter  default 'white'
}
```

- Stored panels without these fields load with the defaults, so existing projects look exactly as before.
- `PanelDraftSchema` takes all four as optional, and the service fills in the defaults. `PanelPatchSchema` follows from the draft as today.
- `Project.defaultAspect` accepts the new aspects too, since it is the same enum.
- `drawAspect(aspect: PanelAspect): DrawAspect` in `src/shared/` maps `1:2` and `1:3` to `9:16`, and every other aspect to itself. `DrawAspect` is the old six-value enum. Providers and the image request use `DrawAspect`, never `PanelAspect`.

## 4. The strip

### 4.1 Rows: `layoutStrip(panels)`

A pure function in `src/renderer/src/components/visualizer/strip-layout.ts`:

```
layoutStrip(panels: Panel[]): StripRow[]
StripRow = { panels: Panel[]; gapAfter: PanelGap; gutter: PanelGutter; slants: Record<panelId, 'left' | 'right'> }
```

Rules, applied in strip order:

1. A panel with `beside: true` joins the previous row if that row has fewer than 3 panels. Otherwise it starts a new row.
2. The first panel always starts a row, whatever its `beside` says.
3. A row's `gapAfter` and `gutter` are its **last** panel's.
4. Slanted panels alternate their slant direction (`left`, `right`, `left`, …), counted over the slanted panels of the whole strip, so a run of them zig-zags.

Deleting, moving or inserting a panel needs no repair. The rows are rebuilt from the order on every render.

### 4.2 Drawing

- **Row:** width `min(100%, 440px)`, the current card width. The panels in a row share one height, and each panel's width is proportional to its aspect ratio (flex-grow = width ÷ height of its aspect). A fixed 6px gap separates panels in a row.
- **Gutter band:** a row and the gap after it are drawn on the row's gutter colour, edge to edge across the strip's width. Consecutive black rows form one dark band. White is the strip's current page colour.
- **Gap after:** tight 8px, normal 28px (today's), long 120px. The "+" insert button stays in every gap, whatever its size.
- **Bordered:** today's inked frame.
- **Borderless:** no ink. The image edges fade into the gutter colour over about 6% of each side (a CSS mask).
- **Slanted:** inked frame, with the top and bottom edges cut by a `clip-path` polygon. The offset is 4% of the panel's width, and the direction comes from `slants`. The ink follows the cut: the outline is drawn as a second clipped layer behind the image.
- **1:2 and 1:3:** the panel box has the panel's aspect. The 9:16 image fills its width, centred vertically, and its top and bottom fade into the gutter colour over the extra height plus 10% of the image. No ink frame, whatever `frame` says.
- **Data attributes on each card**, for tests and the e2e: `data-frame`, `data-beside`, `data-gutter`, `data-gap`, `data-slant`. On each row: `data-row-size`.

### 4.3 Lettering in narrow panels

Bubble sizes use `cqw` on `.panel-media` today, so in a row of three the text would shrink to a third. The size container moves to the **row**: `.strip-row { container-type: inline-size }`, and `.panel-media` stops being a container. A single-panel row is exactly as wide as its panel, so full-width panels look as they do now. Bubble `max-width`s become percentages of the overlay (the panel), so a bubble never spills out of a narrow panel. Anything that shows a panel outside a strip row (if any) wraps it in a `.strip-row` too, so the lettering is sized the same there.

## 5. The agent

### 5.1 Tools

- `create_panel`, `update_panel` (`patch`) and the panel chat's `update_panel_fields` take `frame`, `beside`, `gapAfter` and `gutter`, and the new aspects, all optional, with one-line `describe()` texts.
- `list_panels` returns the four fields.
- The `recent_panels` snapshot line shows the layout after the shot: `[close-up, 2:3, beside]`. It shows only the values that differ from the defaults, plus the aspect: `[wide, 16:9, borderless, gap long, gutter black]`.
- A change to `frame`, `beside`, `gapAfter` or `gutter` alone never needs a redraw. The same goes for an aspect change whose `drawAspect` is unchanged (9:16 ↔ 1:2 ↔ 1:3). `update_panel` with `regenerate: false` already keeps the image, so this is guidance in the docs, not new code.

### 5.2 Guidance (`resources/agent-docs`)

`reference/webtoon-style-guide.md` gets a **Layout** section, and `workflows/story-direction.md` points at it:

- **Quick exchanges:** shot, reverse shot and reaction go **beside each other by default**, 2–3 to a row, as close-ups or medium shots at 2:3 or 9:16. A row is one exchange, and a new speaker topic starts a new row.
- **Clashes and wide establishing shots:** borderless.
- **Action runs (blows, dodges, chases):** slanted.
- **Descents, falls, tall structures, reveals from above or below:** 1:2 or 1:3.
- **Time passing, scene changes:** `gapAfter: long` on the last panel before the change.
- **Dark places (dungeon, night, a void):** `gutter: black` on every panel of the scene.
- **Rapid fire within one moment:** `gapAfter: tight`.

`AGENTS.md` lists the new inputs on `create_panel`, `update_panel` and `update_panel_fields`. The workflow-docs lint test keeps the tool lists and docs in agreement.

## 6. Image generation

- `ImageRequest.aspect` becomes a `DrawAspect`. `PanelService` passes `drawAspect(panel.aspect)`.
- `aspectToOpenAISize` takes `DrawAspect`, which is unchanged. The bridge goes through the same OpenAI path.
- Gemini gets `aspect_ratio: drawAspect`.
- The `[STYLE]` line in `prompts.ts` names the draw aspect, and adds:
  - for `1:2`/`1:3`: `Tall panel: keep the top fifth and bottom fifth plain background (sky, floor, darkness), so they can fade out.`
  - for `borderless`: `Art runs to the edges, no frame.`
- `reference/prompt-templates.md` documents both lines.
- The consistency checker is unchanged. Its prompt sees the same text the image model saw.

## 7. Editing it yourself

- **Panel editor:** a **Layout** group under Shot/Aspect:
  - **Frame** select: bordered, borderless, slanted. Disabled, with the note "Tall panels fade instead of a frame", when the aspect is 1:2 or 1:3.
  - **Aspect** select, with 1:2 and 1:3 added.
  - **Beside the previous panel** checkbox.
  - **Gap after** select: tight, normal, long.
  - **Gutter** select: white, black.

  The editor saves these with the rest of the panel. Changing only layout fields saves without a redraw, like a dialogue-only change today.
- **Card toolbar:** a **Beside previous** toggle button (a columns icon, `aria-pressed`). It saves `beside` at once through the existing update path and never redraws. It is disabled on the first panel.
- Panels the user adds start with the defaults: full width, bordered, normal gap, white gutter.

## 8. Edge cases

| Case | Behavior |
|---|---|
| `beside` on the first panel | Drawn as its own full-width row. The value is kept, so a move can use it later. |
| A 4th `beside` in a row | Starts a new row (rule 1). |
| Tall panel inside a row | Allowed. It is narrow and tall, and the other panels in the row grow to its height. |
| `frame` on a tall panel | Ignored when drawing (it always fades). The value is kept. |
| Panel with no image yet, or failed | Gets the same box, frame and row placement. The empty or failed status shows inside it. |
| Narrow window | A row stays a row and shrinks with the strip. |
| Old project | Loads with the defaults. Nothing moves. |

## 9. Testing

- `strip-layout.test.ts`: single rows, a row of 2 and of 3, a 4th `beside` starting a new row, the first panel's `beside` ignored, gap and gutter taken from the last panel of a row, slant alternation across rows, an empty strip.
- `schemas.test.ts`: an old panel parses with the four defaults, the new aspects parse, and bad values are refused.
- `aspect` tests: `drawAspect` for all eight aspects. The OpenAI size and the Gemini `aspect_ratio` for 1:2 and 1:3 come out as 9:16.
- `prompts.test.ts`: the tall-panel line and the borderless line appear only when they should, and the `[STYLE]` line names the draw aspect.
- `panel-service.test.ts`: the defaults are filled in on create, a patch of layout fields only keeps the image, and the image request uses the draw aspect.
- Tool tests: `create_panel`/`update_panel`/`update_panel_fields` take the fields, `list_panels` returns them, and the snapshot line shows the short layout.
- `workflow-docs.lint.test.ts` stays green with the new inputs documented.
- `PanelEditorDialog.test.tsx`: the Layout group round-trips, and Frame is disabled for tall aspects.
- `PanelCard.test.tsx` / `WebtoonPane.test.tsx`: the data attributes, row grouping in the DOM, and the Beside toggle (pressed state, disabled on the first panel, saves `beside` without a redraw).
- e2e: the panels spec still passes.
- **Real check:** set layouts on the 22-panel story episode (`manhwa-benchmark/run/story-panels.spec.ts`, a new `STAGE=layout` that patches the fields through the store, then `STAGE=shoot`). Send the before/after strips and update `results.md` gaps 3–4 and the scores.

## 10. Out of scope

- Insets (a small panel overlapping a corner of the previous one).
- Free placement, dragging panel widths, custom slant angles.
- Panels that break their frame (a character leaping out of the border).
- Moving bubbles off faces (still open from the bubbles work).
- The autopilot's beat planner (gap 5) and "must show" details (gap 6).

## 11. Amendments (rulings during implementation)

Where the sections above and these differ, these win.

- **R0, the "+" (§4.2).** The insert "+" sits only in the gaps between rows, never between the panels of one row, and once at the end of the strip.
- **R2, the white gutter (§4.2).** White is the strip's page colour, `var(--raised)`, not `#fff`. Black stays `#000`.
- **R3, the normal gap (§4.2).** Normal is 48px, today's gap, not 28px. Tight (8px) and long (120px) are as written.
- **R4, lettering in a row (§4.3).** Lettering is sized by the row, scaled by `max(share, 0.65)`, where a panel's share is its aspect ratio divided by the sum of the ratios in its row. A row of one has share 1, so a full-width panel is lettered as before.
- **R5, the tall fade (§4.2).** The 9:16 image is masked to fade over 10% of its own height at the top and at the bottom; the box's extra height around the centred image is plain gutter.
- **R6, the editor (§7).** The edit dialog lives in the strip (`WebtoonStrip`), not in the card: saving `beside` moves a card to another row and rebuilds it, and a dialog inside it would vanish with its warnings. The card only asks the strip to open it (`onEdit`).
- **R7, the slant offset (§4.2).** The offset is 4% of the panel's own width (`4cqw` of the row, times the panel's share), not of the row's.
