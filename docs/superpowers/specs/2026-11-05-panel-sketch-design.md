# Panel sketch: new panels open in editing mode

Status: implemented on 2026-11-05.

## What changed

1. **No new-panel dialog.** The "+" between rows and at the end of the strip makes a blank panel at once. It has no image, an empty description and setting, a medium shot, the project's default aspect, and no cast, items or lines. The "+" then opens that panel in editing mode, which is the same `PanelWorkspace` a card opens. `PanelEditorDialog` and `DialogueEditor` are gone. A double click makes one panel, and a failure is shown under the "+".
2. **Sketch mode.** The editing stage can show a canvas at the panel's aspect, where the user scribbles a rough scene. Its tools are a pen, an eraser, three brush widths and Undo, in a rail at the stage's left edge.
   - **Any panel can be sketched.** On a panel with a picture, the picture shows faintly (35%) under the canvas, to trace over; **Picture** at the stage's top right hides and shows it. A panel without one sketches on white paper. The canvas holds the ink alone on transparent pixels, and the eraser takes ink away (`destination-out`), so the picture never gets into the sketch: a save draws the ink onto white paper first. A stored sketch that is loaded back has its white paper turned transparent again, each pixel keeping as much ink as it is dark.
   - **New sketch** at the stage's top right wipes every stroke and forgets the stored sketch, to start again. It is off while the canvas is blank, and Undo brings the strokes back.
   - **Shapes:** Line, Rectangle and Ellipse draw outlines in the pen's width. The shape follows the pointer while it is dragged. Shift snaps a line to 45° and makes a square or a circle. A click without a drag leaves nothing and no undo step.
   - **Zoom:** both stages, the panel's picture and the sketch, have a bar at their bottom right that zooms out, shows the zoom (a click on it goes back to the fit) and zooms in, in steps of a quarter from 50% to 400% of the fit. Ctrl and the wheel, or a trackpad pinch, zoom at the pointer. Past the fit the panel scrolls inside the stage, and the tool rail, actions and zoom bar stay where they are. The workspace keeps one zoom per open panel, so switching between picture and sketch keeps it, and the next panel starts at the fit. Bubbles can still be selected and dragged on a zoomed panel (their math is in screen pixels). Zoom only changes the view: the stored sketch keeps its size, 1024 px on the longer edge. The shared pieces are `useStageZoom` and `ZoomBar` (`use-stage-zoom.tsx`).
   - A panel that was never drawn (no versions) opens on its sketch.
   - A panel with any attempt (pending, failed or ready) opens on its picture.
   - **Sketch** in the header switches between the two.
   - **Generate** (named Regenerate once a panel has versions) goes back to the picture, so the attempt it starts is seen.
3. **The sketch is a reference.**
   - A generation sends the sketch as a reference image after the cast and item images and before the previous panel. A `[LAYOUT]` line asks the model to follow its composition (placement, poses, angle, framing) and never its linework or blank background.
   - Over the model's reference cap, the previous panel is dropped first, then the sketch with its line.
   - Edits (`edit_panel_image`) do not get the sketch, because they keep the image's own composition.
   - The consistency checker never sees the sketch.
4. **Free-text position.** A cast member's position is any text, such as `left`, `background` or `far right, half in shadow`, and it defaults to `center`.
   - The Cast picker has a text field where it had a select.
   - An empty position is left out of the prompt.
   - Bubbles go to the side the text names: `left` or `right` as a whole word, and the centre when it names both or neither.

## Storage

- `Panel.sketchPath?: string | null` holds the sketch's path, `panels/<pnlId>/sketch-<base36 ms><4 random>.png`. Old panel files parse unchanged.
- Every save writes a new file. Versions record the sketch in `referenceImagePaths`, so a version always points at the sketch it was drawn from. The file a save replaces is removed unless a version names it.
- A sketch with no ink is forgotten (`null`), not stored.
- IPC:
  - `panels:saveSketch {png: data URL | null}` checks for the PNG signature and a size of 8 MB at most.
  - `panels:readSketch` returns a data URL. The canvas cannot read back an image from a `webtoon-asset:` URL, because that is another origin and it would taint the canvas.
- Saves go through `panel-save-queue` (`queueSketchSave`), the same queue as the panel's field saves. Generate waits on `whenSaved`, so it always draws from the last stroke.

## Not done

- A blank panel that the user leaves untouched stays in the strip. Delete it from its card's toolbar.
- The sketch is not one of the visual fields, so changing it does not raise the "changed since this image was drawn" notice.
- The sketch has only black ink and outlined shapes: no colours and no fills.
- Zoom has no keyboard shortcuts. A zoomed panel moves with the scrollbars, the wheel, a middle-button drag or a drag with Space held (`useStagePan`).
