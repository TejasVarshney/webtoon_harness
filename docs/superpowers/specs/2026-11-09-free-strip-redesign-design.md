# Free strip redesign

The whole renderer is reorganised around one surface: a free-form webtoon strip on the left and the AI chat on the right, entered from a home page. Panels and bubbles become objects the user places anywhere. New panels are made on a dedicated Generate page.

## What the user asked for

1. The app starts on a home page with previous projects and a way to create one. Creating or opening a project enters the harness. Another project is created or opened from a File dropdown.
2. Panels on the left, AI chatbot on the right. New session, previous sessions and bookmarks live in the chatbot. The sessions sidebar goes. A bookmark pins a whole session.
3. Editing tools sit in the panel view, so a panel is edited directly. Editing mode becomes focus mode.
4. The strip background is an endlessly changeable colour with many options: colour, gradient, image.
5. Panels are free to move anywhere inside the strip. Bubbles are free to move anywhere in the strip too.
6. Shift-click selects several panels. A Generate button appears, uses all selected images as references and goes to the Generate page.
7. The Generate page shows every character, item and location for selection, lets the user draw a reference, tweak the prompt and change the style for that panel. It has no AI chat.
8. User-led mode and everything related to it is removed.
9. Export stops strictly at the last panel.
10. New episodes can still be created. An episode's name cannot be edited once given at creation.

## Decisions taken without a reply (review these)

| Topic | Decision |
|---|---|
| Strip shape | Fixed 440 units wide (`STRIP_CSS_WIDTH`, what export already uses), unbounded downward. The pane around it is neutral so the strip's edges show. |
| Panel size | Panels move and resize; resize keeps the panel's aspect, because the image is drawn at that aspect. |
| Bubble ownership | A bubble stays owned by its panel: it can be dragged anywhere in the strip, on or off any panel, and it travels with its panel when that panel moves. Fully independent bubbles would break the agent's dialogue editing and lose their owner when a panel is deleted. |
| Episode name | Read literally: the title is fixed at creation and no surface edits it. |
| Generate result | A new panel placed right after the last selected panel, pushing later panels down. The page closes and the new panel is selected on the strip while it draws. |
| New panel button | Opens the Generate page with no references, replacing the blank-panel "+". The page also offers `Add blank panel` for sketching or uploading later. |
| Panel chat | Each panel keeps its own chat in focus mode. Only the Generate page is chat-free. |
| Launch | Always the home page; the last project no longer reopens. |
| Shortcuts | Ctrl+N is new session, Ctrl+Shift+N is new project. |
| Library tabs | Characters, Items, Locations and Story stay as tabs over the left pane, Webtoon first. |

## Data model

- `Panel.placement: { x, y, width } | null`, in strip units. `null` means flow placement.
- `Panel.referencePanelIds: string[]`, `Panel.styleOverride: string | null`, `Panel.promptOverride: string | null`. Defaults keep old files valid.
- `Episode.background: StripBackground | null`. `null` derives a background from legacy gutters.
- `BubblePlacement` loses its 0..1 bounds; values stay fractions of the owning panel.
- `SessionSummary.bookmarked: boolean`, from an appended `bookmark` record.
- `ProjectMeta.storyMode` goes. Zod strips the old key on read.
- `Panel.gutter` stays only so old files can be converted. Drafts, patches, the UI and agent tools drop it.

### Placement resolution

`resolveStrip(panels)` is pure and is the only place positions come from.

- Placed panels use their stored rectangle.
- Unplaced panels flow in episode order using today's rules: `beside` rows of up to three sharing the 440 width with a 6 unit gap, gaps of 8, 48 and 120 units for tight, normal and long.
- An unplaced panel starts below everything before it. Its height plus gap pushes every later placed panel down, so an agent inserting mid-strip never overlaps the user's arrangement.
- Every user move freezes the episode as drawn: each panel whose resolved rectangle differs from its stored one (unplaced, or pushed down by an insertion) gets the resolved one, then the moves apply.
- After a move, episode order is rewritten to reading order (top, then left), which is what previous-panel continuity and panel numbers follow.

### Background

Kinds: `solid`, `linear`, `radial`, `conic`, `image`. Gradients take any number of stops (at least two), any `#rrggbb` colour, an angle where it applies, and an optional `repeatEvery`. Images take `fit` (`width`, `tile`, `stretch`), `opacity` and a base colour. The editor offers free colour input plus preset swatches and gradients.

A gradient spans from the top to the bottom of the lowest panel, on screen and in export, so export never squashes it. Past that span the last stop's colour continues on screen.

Old episodes convert on read: one gutter colour becomes `solid`; mixed gutters become a hard-stop `linear` that keeps the black bands where they were.

## Surfaces

**Home.** `Your projects`, a card per project (newest first), `New project`. Project problems show here.

**Workspace.** Top bar with File menu (New project, Open project list, Home, Settings), project name, Style, Continue story. Left: tabs, episode bar, strip. Right: chat with New session, a session dropdown (Bookmarked, then Previous sessions), rename, delete and star.

**Strip.** Click selects and shows tools on the panel (Add bubble, Cast, Items, Scene, Redraw, Sketch, Focus, Delete). Drag moves, the corner handle resizes, arrows nudge (Shift for 10). Dragging any selected panel moves the whole selection rigidly. Double-click or Focus opens focus mode, which is today's editor. Bubbles are draggable on first press on any panel and may leave their panel.

**Selection bar.** Shift-click toggles panels into the selection and adds the previously selected one. The bar shows `Generate from N panel(s)`, counting panels with a ready image. Panels without one are not references.

**Generate page.** Replaces the workspace. Library column (all non-archived characters with variation, items with usage, locations with state and camera), centre (reference thumbnails, removable, plus a sketch canvas with the existing tools), right column (description, setting, shot, aspect, style, full prompt). The prompt shows the composed text and updates live until edited; then it is kept, with `Reset to automatic`. Style is the project's by default, or any library style, or typed text. `Generate` and `Add blank panel` finish. Back with unsaved work asks first.

## Generation

References are claimed: cast, location, items, sketch, selected panels, previous panel. Over the model's cap the previous panel goes first, then selected panels from the end. The page says how many selected panels will not be sent. Selected panels get their own prompt line, and the consistency checker ignores them as it ignores the sketch. A selected panel deleted before drawing is skipped. A custom prompt replaces the composed text, while the references are still sent; the Scene tab says so and offers to clear it.

## Export

Only finished panels draw, at their resolved positions. The output ends exactly at the bottom of the lowest finished panel; background and bubbles below it are cut.

## Removal

`StoryMode`, `story:setMode`, the toggle, `story_mode` in the system prompt and all User-led text in agent docs. Continue story is always available and its prompt loses "(AI-led)". Beside, gap, gutter and move up/down leave the UI, and `panels:move` goes.

## Not included

Zoom on the strip, bubbles shared between panels, agent tools for backgrounds or placement, opening an existing panel in the Generate page.
