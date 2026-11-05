# Panel Editing Mode — Design Spec

Extends `2026-10-21-webtoon-ai-harness-design.md` and builds on panel shapes (`feat/panel-shapes`). Everything not said here works as those say.

## 1. Requirement

User's words: "When I click on a panel, we will go into editing mode and whole panel will be shown at the left side. I can edit text in the bubble, and place where I can put it. Also at right side there will be a chat option where i can interact with ai agent. And also I can edit/add/delete characters items and other things inside this new feature."

**Success:** click a card in the strip; the panel fills the left of the sheet with its lettering, the panel's chat is on the right. Double-click a bubble and retype it; drag it to a new spot; add a character and an item to the cast; ask the chat to fix a line. Go back: the strip shows the new text, in the new spot, and the card the user left from.

## 2. Decisions

| Question | Decision |
|---|---|
| Where editing mode lives | It covers the white sheet (chat and visualizer). The sessions sidebar and top bar stay. Back, or Esc, returns to the strip. |
| Saving | Every change saves on its own, sending only the field that changed. The agent's edits show live. |
| Characters and items | This panel's cast and items: add, remove, variation/usage, action, expression, position, held by. New roster characters and items are still made in their tabs. |
| Bubble placement | Drag anywhere, or nudge with the arrow keys. "Reset to auto" returns a bubble to the automatic layout. Unplaced bubbles keep today's layout. |
| What opens the editor | A click (or Enter) on a card, and a chat thumbnail (`showPanel`). Both already set `selectedPanelId`; editing mode is `selectedPanelId !== null`. |
| The old pieces | The side chat under the main chat goes; its thread moves to the editor's right column. The card's pencil and the edit-mode dialog go; the create dialog (the "+") stays. |

## 3. Data model

```
BubblePlacement = { x: number, y: number }   // the bubble's centre, as fractions 0–1 of the panel's width and height

DialogueLine  += placement: BubblePlacement | null       default null (automatic)
DialogueDraft += placement?: BubblePlacement | null      undefined: inherit (see below); null: automatic

VisualFields  = { description, setting, shot, aspect, characters, items }   // what the picture shows
PanelVersion  += drawnFrom: VisualFields | null          default null
```

- Stored panels and versions without the new fields load with `null`, and look as before.
- **Placement inheritance** (`PanelService.update`): a patched line whose `placement` is `undefined` takes the placement of the stored line at the same index, or `null` when there is none. `null` is kept as `null`. `create` turns `undefined` into `null`. This keeps placed bubbles placed when the agent rewrites a line's text, since agents send the whole dialogue array.
- `DialogueDraftSchema` must declare `placement` as `.nullable().optional()` with no default. A default would turn "inherit" into "automatic" when IPC parses the patch.
- `drawnFrom` is set when a version is recorded (generate, edit, upload) to `visualFields(panel)` at that moment.
- `staleVisualFields(panel): (keyof VisualFields)[]`, in `@shared/visual-fields`, lists the fields that differ from the current version's `drawnFrom`. It returns `[]` when there is no current version or its `drawnFrom` is `null`. `aspect` is compared through `drawAspect`. Layout fields (frame, beside, gapAfter, gutter), dialogue and placement are never visual: changing them never makes the image stale and never starts a redraw.

## 4. The screen

```
┌ sidebar ┬─────────────────────── sheet ───────────────────────────────┐
│         │ ← Strip  Panel 4 of 12  ‹ ›       ‹ v2/3 ›  Upload…  Regenerate│
│         │ [notice: Cast changed since this image was drawn.]  │ Panel chat│
│         │ ┌─────────── stage (panel's gutter colour) ───────┐ │           │
│         │ │            the panel, lettered, editable        │ │ messages  │
│         │ └─────────────────────────────────────────────────┘ │           │
│         │ Lines · Cast · Items · Scene                        │           │
│         │ (the open tab's controls)                           │ composer  │
└─────────┴─────────────────────────────────────────────────────┴───────────┘
```

- **Placement in the DOM.** `ThreePaneLayout` takes an `overlay` node, drawn inside `.sheet` over the panes (`position: absolute; inset: 0`, opaque). While it shows, the panes under it get `inert`. They stay mounted, so the strip keeps its scroll, the main chat its draft, and the card the user came from is focused again on Back.
- **Columns.** A horizontal `react-resizable-panels` group: the editor 64% (min 40%), the chat 36% (min 26%). The left column scrolls; the header stays at its top.
- **Header.** "← Strip" (Back), the title `Panel N of M` (h1), ‹ › to the previous and next panel of the episode (they set `selectedPanelId`, so the strip remembers the last one), then the `VersionSwitcher`, "Upload image…" and "Regenerate". Regenerate is the one filled button (near-black `--primary`).
- **Stale notice.** When `staleVisualFields` is not empty, one notice under the header, in the warning pill tokens: `{Fields} changed since this image was drawn.` Then a "Regenerate" text button. `{Fields}` joins the labels Description, Setting, Shot, Aspect, Cast, Items with ", " and " and ", first letter upper-case, the rest lower-case.
- **Stage.** The panel on a field of its own gutter colour (white or black), centred, as big as fits the column's width and at most 62% of the window height. It is drawn by the same component and CSS as the card (`PanelArt`). It is laid out at the strip's reference row width, `STAGE_ROW_PX = 560`, times its row share, and scaled up with a transform, so the lettering is the size it is on the strip. Placement fractions are exact at every size.
- **Tabs** under the stage, using the existing `.tab-bar` look: **Lines** (the default), **Cast** (`CastPicker`), **Items** (`ItemPicker`), **Scene** (description, setting, shot, aspect, and the layout group from the old dialog). Selecting a bubble on the stage opens Lines and scrolls to its row.
- **Chat column.** The panel's thread (`panel:<id>`) and composer, as the side chat had them. Header: "Panel chat".

## 5. Bubbles on the stage

- **Select:** click a bubble. It gets a 2px `--accent` outline, offset 3px. Click the empty stage or press Esc to clear it.
- **Edit text:** double-click a bubble, or press Enter on a selected one. A textarea replaces the bubble's text in place, in the bubble's own lettering. Enter commits, Shift+Enter is a new line, Esc cancels, blur commits. A commit with empty text keeps the old text (deleting is the Delete key or button).
- **Move:** press on a bubble and drag. The drag starts after 3px of movement, so a click still selects. The bubble follows the pointer, keeping the offset where it was grabbed, and floats (`--float-shadow`) while dragged. It is clamped so the whole bubble stays inside the panel. Release commits its placement. An automatic bubble dragged becomes placed.
- **Nudge:** arrow keys move a selected bubble 0.01 of the panel, or 0.05 with Shift. Saved 300ms after the last key.
- **Delete:** Delete or Backspace on a selected bubble (not while editing text), or the row's Remove in Lines.
- **Add:** double-click empty stage. A new line goes there, spoken by the first cast member (`speech`), or narration when the cast is empty, and opens for typing at once. It is saved only when its text is committed non-empty; otherwise it disappears. Lines also has "Add line", which adds an automatic one.
- **Reset to auto:** in the line's row in Lines, shown only for placed lines. It saves `placement: null`.
- **Rendering** (strip and stage alike): `DialogueOverlay` draws placed lines in their own absolute layer, at `left: x·100%`, `top: y·100%`, `translate(-50%, -50%)`. Shape and tail come from `layoutBubbles` as today. Unplaced lines keep the flow and the sound-effect layer.
- **No AI:** editing, moving, adding or deleting a bubble never calls a model. It saves the panel's dialogue and nothing else: no chat run, no redraw, no image edit.
- **Lines tab rows:** speaker, kind, text (a textarea), "Reset to auto" when placed, Remove. Its empty state keeps the frame and says: `No lines yet. Double-click the panel to place one.`

## 6. Saving

- `useFieldAutosave(panel, field)` gives each field a local draft. A change saves after `AUTOSAVE_MS = 600` of quiet, and on blur, Back, ‹ › and unmount. It sends `{ [field]: value }` through `usePanelsStore.updatePanel`. While nothing is pending, the field shows the store's value, so agent edits appear.
- **Dialogue saves are built at send time** from the store's current panel. Take its lines (without ids), change the one line, and send the whole array. Line ids change on every dialogue save, so the editor tracks the selected bubble by index, never by id. If the line at that index no longer has the speaker, kind and text it had when the drag or text edit began, nothing is sent and the Lines tab says: `This line changed while you were editing it.`
- A save the service refuses keeps the draft and shows the error in its tab, with "Undo my change" (restores the store value). Warnings show in the tab as a quiet list until the next save.

## 7. The agent

- `update_panel_fields` and `get_panel_context` (side chat), `get_panel` and `update_panel` (main chat), and the Claude Code MCP tools that wrap them all show each line's `placement`. The `update_panel_fields` dialogue description adds: `placement is the bubble's centre as fractions of the panel (x across, y down), or null for automatic; leave it out to keep the line's current placement.`
- `<panel_context>` shows a placed line as `Speaker: "text" @0.62,0.18` (two decimals).
- `workflows/panel-editing.md`: Purpose says the user opened the panel in editing mode. Dialogue-Only Changes gains a paragraph on placement: keep the user's placements, and set one only when the user asks for a spot.

## 8. Look (app-screen rules)

The app is the framed-sheet style. The editor takes its tokens from `styles.css` and adds no colour. The accent is only on the selected bubble and the active tab. Surfaces are separated by 1px `--border` or one tone step. Shadows only on what floats (a dragged bubble). Icons are 15–16px lucide outlines in `--muted`, never in a tinted box. Words of the trade: Lines, Cast, Items, Scene, Lettering.

## 9. Amendments (rulings during implementation)

Where the sections above and these differ, these win.

- **R1, one save queue per panel (§6).** Every save of a panel goes through one queue (`panel-save-queue.ts`), shared by the stage and every tab. Each save is built when its turn comes, from the last save's result when the store has not caught up. Items are saved before characters, because the service refuses a cast that drops someone who still holds an item.
- **R2, where save messages show (§6).** The conflict copy and refused dialogue saves show in the Lines tab, once. A stage action that produces one opens Lines. Each tab shows only the warnings of the last save it made.
- **R3, scrolling to a line (§4).** The tabs scroll inside their own area. Selecting a bubble scrolls only that area to its row, so the stage and an open bubble never move.
- **R4, the split (§4).** The tabs keep at least 240px. The stage's height is `max(160px, min(62vh, what is left of the column after 256px))`. In a short window (1100×720) the tabs are the larger block.
- **R5, Lines rows (§5).** Each row puts Speaker, Kind and Text on one line, then Reset to auto (placed lines only) and Remove. At narrow widths the text wraps under the selects.
- **R6, the header (§4).** It may wrap to two rows at narrow widths. Nothing in it is dropped.
- **R7, Regenerate and Upload (§4, §6).** Both wait until the panel's queued saves settle, and do nothing after a refused one, so an image is never drawn from fields that have not been saved.
- **R8, focus (§2).** Opening the editor puts the focus on Back. Back puts it on the card the user left from.
