# Undo and redo on the strip

Date: 2026-11-12. Branch `feat/strip-undo`, from `origin/main`.

## 1. Goal

The strip is free-form: panels are dragged, resized, arranged by Layout, cropped and reframed, bubbles go anywhere, and the background is edited. None of that can be taken back. One Layout click moves a panel and every panel after it, and a stray drag rewrites a placement.

After this work, Ctrl+Z on the strip takes back the user's last change to what the strip shows, and Ctrl+Shift+Z or Ctrl+Y puts it back. Two buttons in the episode bar do the same and name the step.

## 2. What is recorded

A change the user makes to what the strip shows, wherever it is made (the strip, a tool popover, or focus mode):

| Kind | Made by | Label |
| --- | --- | --- |
| Place | A drag (one panel or a selection), the resize handle, a run of nudges, a Layout arrangement, the width and side buttons | move, resize, layout |
| Fields | `aspect` (shape), `frame` and `cut`, `dialogue` (a bubble moved, resized, retyped, restyled, re-tailed, added, removed, merged) | shape, frame, lettering |
| Background | The Background editor, including a picked image | background |
| Picture | Crop, picking a version in Versions, Upload image, when the panel had a current version before | crop, picture |

Not recorded: deleting a panel (it is in the OS trash, and the dialog already asks), adding a panel, Redraw and any generation (Versions has every picture), the sketch (it has its own undo), the other panel fields (description, cast, items, location and so on, which the strip does not show), and anything the in-app agent or the Claude Code link changes.

## 3. Rules

1. **One gesture, one step.** A drag, a nudge run and a Layout click are each one save already. Field saves of the same panel and the same fields that land within 800 ms of the last merge into one step (a slider or a color picker), keeping the first `before` and the last `after`.
2. **History is per episode, in memory.** It is gone when the project closes or another opens. At most 100 steps; the oldest goes first. A new recorded change empties redo.
3. **Undo never overwrites a change it did not record.** Before a step is applied, what it touches must still be as the step left it (`after` for undo, `before` for redo). If it is not (the agent drew a panel, another edit landed), nothing is written, that episode's history is emptied, and the bar says so.
4. **A step for a panel that is gone is dropped** when the panel is deleted.
5. **One at a time.** An undo or redo first waits for the panel saves still queued, then runs alone; the buttons and keys do nothing while one runs. A step the service refuses stays where it was, and the bar shows the error.
6. **Undo restores exactly what was stored.** A panel that was unplaced (`placement: null`, flowing) is unplaced again, and the episode's order is the order it had. Freezing the panels at their old boxes is not an undo.

## 4. Main process

`panels:place` freezes every panel and rewrites the episode's order (`planPlacement`), and it only takes non-null placements, so the renderer cannot undo it with what exists.

- A layout is `{ order: string[]; placements: Record<string, PanelPlacement | null> }`: the episode's panel ids in order and each one's stored placement.
- `panels:place` answers `{ before, after }`, the layouts read and written inside the episode's placing queue. The renderer cannot snapshot these itself: its loads are latest-wins and two drags can be in flight.
- New channel `panels:restoreLayout` `{ projectId, episodeId, layout }`. It writes each panel's placement as given, `null` included, and then the order, in the same per-episode queue as `place`, with the same lock rule (one panel at a time under its own lock, then the episode's, never together) and one `panel.changed` at the end. It refuses a layout whose `order` is not exactly the episode's current panel ids, and a panel of another episode. Added to `IpcContract` and `channelSet`, input checked with `parseInput`.
- `panel-service.ts` is at 492 of 500 lines. The placing code moves to its own module with the restore, as `panel-usage.ts` did.

Field, background and picture steps need no new channel: `panels:update`, `episodes:setBackground` and `panels:revert` already write a given value. Three things to check before relying on them, and to fix or leave unrecorded if they do not hold:

- A restored `dialogue` array carries every look field explicitly (`null` included), and line ids are inherited by index (`withId(line, current.dialogue[i])`). Whatever names a line by id (merged groups, the selected line) must survive an undo of a removed or added line.
- A background image that was replaced must still be on disk when undo points back at it.
- Crop can change the panel's `aspect`. Undo of a crop restores both the version and the aspect.

## 5. Renderer

- `stores/strip-history-store.ts`: the stacks, `record`, `undo`, `redo`, `canUndo`, `canRedo`, the labels of the next steps, the notice, and `busy`. A step is data (`kind`, ids, `before`, `after`, `label`), not closures.
- Recording sits where the user's saves already pass, so the agent's changes never reach it: `placePanels` (from the `{ before, after }` it now gets back), `queuePanelSave` (the panel it built from and the panel the save returned, for the four fields that changed), `setBackground` and `pickBackgroundImage`, and `cropPanelImage`, `revertPanel` and `uploadPanelImage`. An undo or redo applies through paths that do not record.
- Episode bar: **Undo** and **Redo** icon buttons (`aria-label` "Undo" and "Redo"). The title names the step, "Undo move (Ctrl+Z)" and "Redo layout (Ctrl+Shift+Z)", or "Nothing to undo" and "Nothing to redo" when disabled. The stale notice reads "Can't undo: the strip changed since." (or "Can't redo: ...") and goes with the next recorded change.
- Keys, on the Webtoon strip only: Ctrl+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo (Cmd on macOS). They are left alone while typing in a field or editing a bubble's text, while a modal dialog or the Background editor is open (the panel tools' popovers do not block them, so a Layout click is undone with Layout still open), in focus mode (the sketch has its own Ctrl+Z), on the Generate page, in Settings and on the other tabs.
- The window's Edit menu is Electron's `role: 'editMenu'`, whose Undo has the same accelerator. Text fields must keep their own undo, and Ctrl+Z with no field focused must reach the strip. This is proved in the real app by the e2e test, and the menu is changed only if it does not hold.
- After a step, its panel is scrolled into view when it is off screen. The selection is not changed.

## 6. Tests

- Unit: the history store (record, undo, redo, the cap, redo emptied by a new change, merge within 800 ms, per episode, emptied on project change, the stale rule, a deleted panel's steps dropped, one at a time, a refused step kept).
- Main: `restoreLayout` puts back `null` placements and the order, refuses a wrong `order` and a foreign panel, and runs in turn with `place`; `place` answers the layouts it read and wrote. The IPC handler refuses bad input.
- Renderer: the buttons' state and titles, and which keys are taken where.
- E2E `tests/e2e/strip-undo.spec.ts` on the mock: drag a panel, Ctrl+Z, and every panel's `placement` on disk is `null` again with the old order; Ctrl+Shift+Z places it again; a Layout arrangement is undone in one step; a bubble move is undone; Ctrl+Z in a text field changes no panel; a relaunch starts with nothing to undo.
- `README.md` gets an Undo paragraph under "The strip".

## 7. Out of scope

Undo of delete, add and redraw; history that survives a restart; undo in focus mode's own keys; undo of the agent's changes; a visible history list.
