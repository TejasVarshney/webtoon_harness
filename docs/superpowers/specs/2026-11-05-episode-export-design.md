# Episode Export — Design Spec

Extends `2026-10-21-webtoon-ai-harness-design.md` and builds on the panel shapes (`2026-11-03-panel-shapes-design.md`, branch `feat/panel-shapes`). Everything not said here works as those say.

## 1. Requirement

User's words: "Add an export feature. User can export the episodes in pdf, jpeg and other format as well."

Uses, all four chosen in brainstorming: uploading to webtoon sites, reading or sharing as one file, comic reader apps, and print.

**Success:** from the episode bar, the user exports one or more episodes as webtoon JPEG slices, one long image, a reading PDF, a print PDF or a CBZ. Each output looks exactly like the strip, with its lettering, panel shapes, side-by-side rows, gaps and gutters. The editing controls are left out, and so are the panels that have no finished image.

## 2. Decisions taken in brainstorming

| Question | Decision |
|---|---|
| Scope of one export | One or more episodes. The episode on screen is ticked to start with. PDF and CBZ can combine them into one file. |
| Lettering | Lettered by default, exactly as the strip shows it. A **Without lettering** option exports the art alone. |
| Unfinished panels | The dialog lists them. **Export anyway** leaves them out. |
| How pixels are made | Approach A: render the real strip in an offscreen window and capture it. Rejected: redrawing on a canvas (a second copy of the lettering that would drift from the strip), and stacking the PNGs in main (cannot draw the lettering). |
| PDF | Built from the same JPEG slices as every other format, not `printToPDF`. Lettering is part of the picture. Print renders at 2×. |
| CBZ archive | A store-only ZIP written in-house with `zlib.crc32` (Node 22+). No new dependency. |

## 3. Probe findings (Electron 45, Windows 11, throwaway probe)

- A `show: false` window draws `clip-path` slants, `mask-image` fades, `cqw` sizes and fonts correctly. But it **produces no new frame after a scroll**, so its second `Page.captureScreenshot` hangs. `capturePage()` on it is sized by the screen and DPI (1002×1094 for an 800×1280 request) and includes scrollbars.
- `Page.captureScreenshot` with `captureBeyondViewport: true` kills the renderer.
- **What works:** `webPreferences.offscreen: true` plus the DevTools protocol:
  1. `Emulation.setScrollbarsHidden({hidden: true})`.
  2. Per slice: `Emulation.setDeviceMetricsOverride({width, height: sliceHeight, deviceScaleFactor: scale, mobile: false})`, then `scrollTo(0, top)`, then wait for paint, then `Page.captureScreenshot({format})`.
  
  This gives exact 800×1280 slices (1600×2560 at scale 2), with the short last slice sized to fit. Three slices plus a PDF took under a second.

## 4. Formats

All sizes are in CSS px of the export view, which is always **800 CSS px wide**. Output pixels are CSS px × scale. Scale is 1 for **Standard** and 2 for **High**.

| Preset | Output | Breaks | Page / slice height |
|---|---|---|---|
| `webtoon` | Folder per episode of `001.jpg`, `002.jpg`, … (or `.png`) | Anywhere | 1280 |
| `long-image` | One `.jpg`/`.png` per episode. Parts `-1`, `-2`, … when it is taller than 65,000 output px. | Anywhere (parts only) | ≤ 65,000 / scale |
| `pdf-reading` | One `.pdf`. Each page is the size of its slice at 0.75 pt per CSS px, with no margin. | Anywhere | 1280 |
| `pdf-print` | One `.pdf`, A4 or Letter, 36 pt margins, image top-aligned. Always scale 2. | Between rows | A4: 1177, Letter: 1067 (the 800px width fitted to the printable width) |
| `cbz` | One `.cbz`: `001.jpg`, … plus `ComicInfo.xml` | Between rows | 1280 |

- JPEG quality is 90. PNG is offered for `webtoon` and `long-image` only.
- **Between rows** means slices end at row bottoms, which includes the gap below each row, and each slice packs as many rows as fit. A row taller than the page is cut anywhere inside it.
- **Combine** (PDF and CBZ only): episodes are concatenated in episode-number order, and every episode starts on a new page. ComicInfo then describes the volume: `Series` is the project title, and `Title` is `Episodes 1–3`.
- ComicInfo for one episode has `Series` (project title), `Number` (episode number), `Title` (episode title), `Summary` (synopsis) and `PageCount`. All text is XML-escaped.
- File names: `<Project> - 03 - The Rooftop.pdf`, with a folder of the same name for `webtoon`. Combined outputs are named `<Project> - Episodes 1-3.pdf`. Names are made Windows-safe (§6.4).

Out of scope: WebP (`nativeImage` cannot encode it), EPUB, custom page sizes, watermarks, vector lettering.

## 5. The dialog (renderer)

An **Export** button in `EpisodeBar` opens `ExportDialog`. It is disabled while the project has no episodes.

- **Episodes**: a checklist, with the active episode ticked.
- **Format**: the five presets of §4.
- **Image type** (`webtoon`, `long-image`): JPEG or PNG.
- **Paper** (`pdf-print`): A4 or Letter.
- **Resolution**: Standard or High. Hidden for `pdf-print`, which is always High.
- **Combine into one file** (`pdf-*`, `cbz`, with two or more episodes ticked).
- **Without lettering**.
- **Unfinished panels**: when any ticked episode has some, a warning lists them ("Episode 2: panels 4, 7 (failed), 9 (generating)") with **Export anyway**. When no ticked episode has a finished panel, Export is disabled and says why.
- **While running**: "Episode 2 of 3, slice 14 of 31" and a **Cancel** button. When done: **Show in folder**. On failure: the error, and the dialog stays open.

## 6. Architecture

### 6.1 Flow

1. `export:inspect` with `{projectId, episodeIds}` → for each episode: `{episodeId, number, title, panelCount, finishedCount, unfinished: [{panelId, position, reason: 'none' | 'generating' | 'failed'}]}`. `position` is 1-based in strip order.
2. `export:start` with an `ExportRequest` → main shows the OS save dialog (a folder for `webtoon`, a file otherwise), starting in `<projectsRoot>/../Exports`, which it creates. Dismissing the dialog returns `{cancelled: true}`. Otherwise main **snapshots** the episodes' panels and the project's characters, starts the job, and returns `{jobId}`. A second start while a job runs is refused with "An export is already running".
3. For each episode, main loads `export.html` in the job's one offscreen window. It then calls `executeJavaScript('window.webtoonExport.render(<snapshot JSON>)')`. That call resolves once the view is drawn and painted (§6.3), with `{totalHeight, rows: [{top, bottom}]}`. Each row's `bottom` includes its gap. Or it rejects with the first image that failed to load.
4. Main plans the slices (§6.2), captures each one (§3), and hands the images to the writer for the preset.
5. Progress goes out as `{type: 'export.progress', jobId, stage: 'rendering' | 'capturing' | 'writing' | 'done' | 'failed' | 'cancelled', episodeIndex, episodeCount, slice, sliceCount, message?, outputs?}` on the existing event bus.
6. `export:cancel {jobId}` sets a flag that is checked between slices. `export:reveal {jobId}` calls `shell.showItemInFolder` on the job's first output. The renderer never passes a path to main.

**The export window has no preload and no IPC.** Main pushes the snapshot in with `executeJavaScript` and reads the layout back as the call's result. This is a change from the brainstorming sketch, which had an IPC pull. It removes the need to check which window a call comes from. The window is `offscreen`, `sandbox: true`, `contextIsolation: true` and `backgroundThrottling: false`, with the main window's `will-navigate` and window-open guards. It is closed when the job ends, however it ends.

### 6.2 Units

Pure units have no Electron and are tested with vitest, as with `ImageOps`:

- **`src/shared/strip-layout.ts`**: **moved** from `renderer/.../visualizer/strip-layout.ts`, unchanged, so main and both views share it. It adds `exportRows(panels): StripRow[]`:
  1. Run `layoutStrip` on the **full** list.
  2. Drop unfinished panels from their rows.
  3. Drop rows left empty.
  4. Recompute each row's `gapAfter` and `gutter` from its new last panel.
  
  `slants` stay as the full layout assigned them, so a slanted panel leans the same way as in the strip. Filtering first would wrongly move a `beside` panel, whose row-starter was dropped, into the row above.
- **`src/shared/export-status.ts`**: `isFinished(panel)` is true when the version `currentVersionId` points at has `status: 'ready'`, the same rule as `PanelArt`. A panel with a good image and a failed retry is finished. `unfinishedReason(panel)`.
- **`src/main/export/slice-plan.ts`**: `planSlices({totalHeight, rows, pageHeight, breaks: 'anywhere' | 'rows'}) → {top, height}[]`, in CSS px. A part limit for `long-image` is just a larger page height.
- **`src/main/export/zip-writer.ts`**: store-only ZIP (local headers, central directory, end record) with `zlib.crc32`, written as a stream to a file. Names are UTF-8 (general-purpose flag bit 11).
- **`src/main/export/pdf-writer.ts`**: a PDF with one page per JPEG: an `/XObject` with `/DCTDecode`, its width and height, `/DeviceRGB`, drawn with a `cm` matrix. Pages can be sized to the image (reading) or to the paper with margins (print). Correct `xref` offsets. Written as a stream so pages are not all held in memory.
- **`src/main/export/comic-info.ts`**: `comicInfoXml(meta)`, with escaping.
- **`src/main/export/file-names.ts`**: `safeFileName(text)`. It strips `<>:"/\|?*` and control characters, trims trailing dots and spaces, avoids `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`9` and `LPT1`–`9`, caps the length at 120, and falls back to `Untitled`. Also `outputName(project, episodes, preset)`.
- **`src/main/export/long-image.ts`**: stitches captured slices through `toBitmap()` and `createFromBitmap()`. It holds at most one part in memory, at most 1600 × 65,000 × 4 bytes.
- **`src/main/export/export-service.ts`**: the job: snapshot, progress, cancel, `.part` files renamed on success, clean-up. It depends on a `StripCapturer` interface (`open()`, `render(snapshot)`, `capture(top, height, scale, format)`, `close()`) and an `ImageEncoder` interface, so it is tested with fakes.

Electron-specific, with e2e tests:

- **`src/main/export/offscreen-capturer.ts`**: the `StripCapturer` of §3.
- **`src/main/ipc/handlers/export.ts`**: the four channels, with zod schemas in `shared/ipc.ts`.

Renderer:

- **`src/renderer/export.html`** and **`src/renderer/src/export-main.tsx`**: a second renderer entry (electron-vite `rollupOptions.input`), with the same CSP as `index.html`.
- **`ExportView.tsx`**: puts the snapshot into the app, characters and panels stores. Then it renders `WebtoonStrip` with `mode="export"` over `exportRows`.
- **`WebtoonStrip`** / **`PanelCard`** / **`PanelArt`** gain `mode: 'edit' | 'export'` (default `edit`). In `export` mode they draw no `InsertPanelButton`, empty placeholder, selection, toolbar, `panel-status`, Retry, "No image yet" or error line, and do not respond to clicks. Gap bands and gutter colours stay. `lettering: false` skips `DialogueOverlay`.
- **`export.css`** (export entry only): the strip is exactly 800px wide with no padding, the page background is the first row's gutter colour, and there is no app chrome.
- **`ExportDialog.tsx`** and an **Export** button in **`EpisodeBar.tsx`**.

### 6.3 When the view is ready

`render()` resolves only after all of these:

1. React has committed.
2. `document.fonts.ready`.
3. Every `<img>` has `decode()`d. The first rejection fails the render, naming the panel's position.
4. Two `requestAnimationFrame`s. Offscreen windows keep painting.

After each scroll during capture, main waits two frames again before `Page.captureScreenshot`.

## 7. Errors

| Case | Result |
|---|---|
| No ticked episode has a finished panel | Export disabled, with the reason. |
| An image is missing or corrupt at capture time | "Episode 2, panel 4: the image could not be loaded". The job fails and its files are removed. |
| The export window crashes (`render-process-gone`) or an episode times out (30 s + 2 s per panel) | The job fails with a plain message, and the window is closed. |
| A write fails (disk full, locked, no permission) | The job fails with the path and the OS reason, and the `.part` files are removed. |
| Cancel | Stops between slices, closes the window, removes partial files, and reports `cancelled`. |
| The app quits mid-export | The quit gate cancels the job and waits for its clean-up, which is capped at 5 s like the plugins. |
| The project is edited mid-export | Has no effect. The job works from its snapshot. |

Output is always written to `<name>.part`, or `<folder>.part/` for `webtoon`, and renamed on success. When the target exists, the save dialog has already asked to overwrite; for a folder, main replaces it only after a successful run.

## 8. Testing

- **Unit (vitest):**
  - `exportRows`: a dropped row-starter whose `beside` partner must not join the row above; a whole row dropped; gap and gutter taken from the new last panel; slants kept.
  - `isFinished`: ready current with a failed newest; pending; none; failed only.
  - `planSlices`: anywhere; rows; a row taller than the page; the short final slice; one-row and empty strips.
  - ZIP: read back by a small test parser of the central directory, checking each entry's bytes and CRC (against `zlib.crc32`) and its UTF-8 name.
  - PDF: page count, `MediaBox` sizes, xref offsets pointing at `n 0 obj`, and the JPEG bytes embedded verbatim.
  - `comicInfoXml` escaping; `safeFileName` reserved names, illegal characters and length.
  - `export-service` with a fake capturer: progress order, combine order, cancel mid-slice, `.part` clean-up on failure, snapshot isolation, and refusing a second job.
- **Component (testing-library):**
  - `ExportDialog`: the unfinished list, Export anyway, disabled states, which options each preset shows, progress, cancel and reveal.
  - `ExportView` / `WebtoonStrip mode="export"`: no "+", status, Retry or "No image yet"; gaps and gutters kept; lettering off draws no bubbles.
- **IPC:** `register.test` and the validation tests cover the new channels. `renderer-csp.test` also checks `export.html`.
- **E2E (Playwright, mock models):** an episode with a slanted panel, a `beside` pair, a black gutter and one failed panel. Export it as `webtoon` JPEG, `cbz` and `pdf-reading`, then assert that:
  - the slices are 800 wide and at most 1280 tall;
  - the CBZ lists the pages and `ComicInfo.xml`;
  - the PDF page count matches the slices;
  - the failed panel's absence shows in the total height;
  - one captured slice has the black gutter's pixels where the layout says.
